let defaultConfig = {
    baseUrl: "http://109.201.0.97/webrtc/",
    registerEndpoint: "register/",
    addICEEndpoint: "add-ice/",
    getICEEndpoint: "get-ice/?",
    configuration: {
      bundlePolicy: "balanced",
      iceTransportPolicy: "relay",
      iceServers: [{
        "urls": "turn:turnsandbox.podstream.ir:3478",
        "username": "mkhorrami",
        "credential": "mkh_123456"
      }]
    },
    connectionCheckTimeout: 10000,
    logLevel: null
  },
  variables = {
    peerConnection: null,
    dataChannel: null,
    pingController: new PingManager({
      waitTime: defaultConfig.connectionCheckTimeout
    }),
    candidatesQueue: [],
    // candidatesSendQueue: [],
    candidateManager: new CandidatesSendQueueManager(),
    clientId: null,
    deviceId: null,
    apiCallRetries: {
      register: 3,
      getIce: 3,
      addIce: 5
    }
  };
function CandidatesSendQueueManager() {
  let config = {
    candidatesToSend: [],
    alreadyReceivedServerCandidates: false,
    reCheckTimeout: null
  };
  function trySendingCandidates() {
    timoutCallback();
    function timoutCallback() {
      if (variables.peerConnection.signalingState === 'stable') {
        config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
        if (config.candidatesToSend.length) {
          let entry = config.candidatesToSend.shift();
          handshakingFunctions.sendCandidate(entry).then(function (result) {
            if (result.length) {
              addServerCandidates(result);
              config.alreadyReceivedServerCandidates = true;
            }
            trySendingCandidates();
          });
        } else if (!config.alreadyReceivedServerCandidates) {
          handshakingFunctions.getCandidates(variables.clientId).then(function (result) {
            addServerCandidates(result);
          }).catch();
        }
      } else {
        config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
        config.reCheckTimeout = setTimeout(timoutCallback, 1000);
      }
    }
  }
  function addServerCandidates(candidates) {
    for (let i in candidates) {
      webrtcFunctions.putCandidateToQueue(candidates[i]);
    }
  }
  return {
    add: function (candidate) {
      config.candidatesToSend.push(candidate);
      trySendingCandidates();
    },
    destroy: function () {
      config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
    }
  };
}
function PingManager(params) {
  const config = {
    normalWaitTime: params.waitTime,
    lastRequestTimeoutId: null,
    lastReceivedMessageTime: 0,
    totalNoMessageCount: 0,
    timeoutIds: {
      first: null,
      second: null,
      third: null,
      fourth: null
    }
  };
  return {
    resetPingLoop() {
      this.stopPingLoop();
      this.setPingTimeout();
    },
    setPingTimeout() {
      config.timeoutIds.first = setTimeout(() => {
        ping();
        config.timeoutIds.second = setTimeout(() => {
          ping();
          config.timeoutIds.third = setTimeout(() => {
            defaultConfig.logLevel.debug && console.debug("[Async][Webrtc.js] Force closing connection.");
            publicized.close();
          }, 2000);
        }, 2000);
      }, 8000);
    },
    stopPingLoop() {
      clearTimeout(config.timeoutIds.first);
      clearTimeout(config.timeoutIds.second);
      clearTimeout(config.timeoutIds.third);
      // clearTimeout(config.timeoutIds.fourth);
    }
  };
}

function connect() {
  webrtcFunctions.createPeerConnection();
  webrtcFunctions.createDataChannel();
  webrtcFunctions.generateSdpOffer().then(sendOfferToServer);
  function sendOfferToServer(offer) {
    handshakingFunctions.register(offer.sdp).then(processRegisterResult).catch();
    variables.peerConnection.setLocalDescription(offer).catch(error => console.error(error));
  }
  function processRegisterResult(result) {
    variables.clientId = result.clientId;
    variables.deviceId = result.deviceId;
    webrtcFunctions.processAnswer(result.sdpAnswer);
  }
}
let webrtcFunctions = {
  createPeerConnection: function () {
    variables.peerConnection = new RTCPeerConnection(defaultConfig.configuration);
    variables.peerConnection.addEventListener('signalingstatechange', webrtcFunctions.signalingStateChangeCallback);
    variables.peerConnection.onicecandidate = function (event) {
      if (event.candidate) {
        variables.candidateManager.add(event.candidate);
        webrtcFunctions.putCandidateToQueue(event.candidate);
      }
    };
  },
  signalingStateChangeCallback: function () {
    if (variables.peerConnection.signalingState === 'stable') {
      // handshakingFunctions.getCandidates().catch()
      webrtcFunctions.addTheCandidates();
    }
  },
  createDataChannel: function () {
    variables.dataChannel = variables.peerConnection.createDataChannel("dataChannel", {
      ordered: false
    });
    variables.dataChannel.onopen = dataChannelCallbacks.onopen;
    variables.dataChannel.onmessage = dataChannelCallbacks.onmessage;
    variables.dataChannel.onerror = dataChannelCallbacks.onerror;
    variables.dataChannel.onclose = dataChannelCallbacks.onclose;
  },
  generateSdpOffer: function () {
    return new Promise(function (resolve, reject) {
      variables.peerConnection.createOffer(function (offer) {
        resolve(offer);
      }, function (error) {
        reject(error);
        console.error(error);
      }).then(r => console.log(r));
    });
  },
  processAnswer: function (answer) {
    let remoteDesc = {
      type: "answer",
      sdp: answer
    };
    variables.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc)).catch(function (error) {
      console.error(error);
    });
  },
  addTheCandidates: function () {
    while (variables.candidatesQueue.length) {
      let entry = variables.candidatesQueue.shift();
      variables.peerConnection.addIceCandidate(entry.candidate);
    }
  },
  putCandidateToQueue: function (candidate) {
    variables.candidatesQueue.push({
      candidate: new RTCIceCandidate(candidate)
    });
    if (variables.peerConnection.signalingState === 'stable') {
      webrtcFunctions.addTheCandidates();
    }
  },
  sendData: function (params) {
    if (!variables.dataChannel) {
      console.error("Connection is closed, do not send messages.");
      return;
    }
    var data = {
      type: params.type,
      uniqueId: params.uniqueId
    };
    if (params.trackerId) {
      data.trackerId = params.trackerId;
    }
    try {
      if (params.content) {
        data.content = JSON.stringify(params.content);
      }
      if (variables.peerConnection.signalingState === 'stable') {
        //defaultConfig.logLevel.debug &&
        console.log("[Async][WebRTC] Send ", data);
        variables.dataChannel.send(JSON.stringify(data));
      }
    } catch (error) {
      eventCallback["customError"]({
        errorCode: 4004,
        errorMessage: "Error in Socket sendData!",
        errorEvent: error
      });
    }
  }
};
let dataChannelCallbacks = {
  onopen: function (event) {
    console.log("********* dataChannel open *********");
    variables.pingController.resetPingLoop();
    eventCallback["open"]();
    const deviceRegister = {
      "type": "2",
      "content": {
        "deviceId": variables.deviceId,
        "appId": "PodChat",
        "refresh": false,
        "renew": true
      }
    };
    deviceRegister.content = JSON.stringify(deviceRegister.content);
    variables.dataChannel.send(JSON.stringify(deviceRegister));
  },
  onmessage: function (event) {
    variables.pingController.resetPingLoop();
    decompressResponse(event.data).then(result => {
      var messageData = JSON.parse(result);
      console.log("[Async][WebRTC] Receive ", result);
      eventCallback["message"](messageData);
    });
  },
  onerror: function (error) {
    logLevel.debug && console.debug("[Async][Socket.js] dataChannel.onerror happened. EventData:", event);
    eventCallback["error"](event);
  },
  onclose: function (event) {
    resetVariables();
    eventCallback["close"](event);
  }
};
let handshakingFunctions = {
  register: function (offer) {
    let retries = variables.apiCallRetries.register;
    return new Promise(promiseHandler);
    function promiseHandler(resolve, reject) {
      let registerEndPoint = defaultConfig.baseUrl + defaultConfig.registerEndpoint;
      fetch(registerEndPoint, {
        method: "POST",
        body: JSON.stringify({
          offer: offer
        }),
        headers: {
          "Content-Type": "application/json"
          // 'Content-Type': 'application/x-www-form-urlencoded',
        }
      }).then(function (response) {
        if (response.ok) return response.json();else if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else reject();
      }).then(result => resolve(result)).catch(err => {
        if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else {
          publicized.close();
        }
        console.error(err);
      });
    }
    function retryTheRequest(resolve, reject) {
      setTimeout(function () {
        promiseHandler(resolve, reject);
      }, 1000);
    }
  },
  getCandidates: function (clientId) {
    let addIceCandidateEndPoint = defaultConfig.baseUrl + defaultConfig.getICEEndpoint;
    addIceCandidateEndPoint += "clientId=" + clientId;
    let retries = variables.apiCallRetries.getIce;
    return new Promise(promiseHandler);
    function promiseHandler(resolve, reject) {
      fetch(addIceCandidateEndPoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
          // 'Content-Type': 'application/x-www-form-urlencoded',
        }
      }).then(function (response) {
        if (response.ok) return response.json();else if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else reject();
      }).then(function (result) {
        resolve(result.iceCandidates);
        // if(result.iceCandidates && result.iceCandidates.length) {
        //     // result.iceCandidates.forEach((item) => {
        //     //     webrtcFunctions.putCandidateToQueue(item);
        //     // });
        //     resolve(result.iceCandidates)
        // }
        // else {
        //     if(retries){
        //         retryTheRequest(resolve, reject);
        //         retries--;
        //     } else reject();
        // }
      }).catch(function (err) {
        if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else reject(err);
        console.error(err);
      });
    }
    function retryTheRequest(resolve, reject) {
      setTimeout(function () {
        promiseHandler(resolve, reject);
      }, 1000);
    }
  },
  sendCandidate: function (candidate) {
    let addIceCandidateEndPoint = defaultConfig.baseUrl + defaultConfig.addICEEndpoint,
      retries = variables.apiCallRetries.addIce;
    return new Promise(promiseHandler);
    function promiseHandler(resolve, reject) {
      fetch(addIceCandidateEndPoint, {
        method: "POST",
        body: JSON.stringify({
          "clientId": variables.clientId,
          "candidate": candidate
        }),
        headers: {
          "Content-Type": "application/json"
          // 'Content-Type': 'application/x-www-form-urlencoded',
        }
      }).then(function (response) {
        if (response.ok) return response.json();else if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else reject();
      }).then(function (result) {
        resolve(result.iceCandidates);
      }).catch(err => {
        if (retries) {
          retryTheRequest(resolve, reject);
          retries--;
        } else reject(err);
        console.error(err);
      });
    }
    function retryTheRequest(resolve, reject) {
      setTimeout(function () {
        promiseHandler(resolve, reject);
      }, 2000);
    }
  }
};
eventCallback = {};
function resetVariables() {
  console.log("resetVariables");
  eventCallback["close"]();
  variables.pingController.stopPingLoop();
  variables.dataChannel.close();
  variables.dataChannel = null;
  variables.peerConnection.close();
  variables.peerConnection = null;
  variables.candidatesQueue = [];
  variables.clientId = null;
  variables.deviceId = null;
  variables.candidateManager.destroy();
  variables.candidateManager = new CandidatesSendQueueManager();
}
function ping() {
  webrtcFunctions.sendData({
    type: 0
  });
}
function removeCallbacks() {
  if (variables.peerConnection) variables.peerConnection.onicecandidate = null;
  if (variables.dataChannel) {
    variables.dataChannel.onclose = null;
    variables.dataChannel.onmessage = null;
    variables.dataChannel.onerror = null;
    variables.dataChannel.onopen = null;
  }
}
function WebRTCClass({
  baseUrl,
  configuration,
  connectionCheckTimeout = 10000,
  logLevel
}) {
  let config = {};
  if (baseUrl) config.baseUrl = baseUrl;
  if (configuration) config.configuration = configuration;
  if (connectionCheckTimeout) config.connectionCheckTimeout = connectionCheckTimeout;
  if (logLevel) config.logLevel = logLevel;
  defaultConfig = Object.assign(defaultConfig, config);
  connect();
  return publicized;
}
let publicized = {
  on: function (messageName, callback) {
    eventCallback[messageName] = callback;
  },
  emit: webrtcFunctions.sendData,
  connect: connect,
  close: function () {
    removeCallbacks();
    resetVariables();
  }
};

/**
 * Decompress results
 */
function decompress(byteArray, encoding) {
  const cs = new DecompressionStream(encoding);
  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  return new Response(cs.readable).arrayBuffer().then(function (arrayBuffer) {
    return new TextDecoder().decode(arrayBuffer);
  });
}
async function decompressResponse(compressedData) {
  return await decompress(_base64UrlToArrayBuffer(compressedData), 'gzip');
}

//utility

/**
 * Array buffer to base64Url string
 * - arrBuff->byte[]->biStr->b64->b64u
 * @param arrayBuffer
 * @returns {string}
 * @private
 */
function _arrayBufferToBase64Url(arrayBuffer) {
  console.log('base64Url from array buffer:', arrayBuffer);
  let base64Url = window.btoa(String.fromCodePoint(...new Uint8Array(arrayBuffer)));
  base64Url = base64Url.replaceAll('+', '-');
  base64Url = base64Url.replaceAll('/', '_');
  console.log('base64Url:', base64Url);
  return base64Url;
}

/**
 * Base64Url string to array buffer
 * - b64u->b64->biStr->byte[]->arrBuff
 * @param base64Url
 * @returns {ArrayBufferLike}
 * @private
 */
function _base64UrlToArrayBuffer(base64) {
  console.log('array buffer from base64Url:', base64);
  const binaryString = window.atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log('array buffer:', bytes.buffer);
  return bytes.buffer;
}
module.exports = WebRTCClass;