"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
var _typeof = require("@babel/runtime/helpers/typeof");
var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));
var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));
var fflate = _interopRequireWildcard(require("fflate"));
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj["default"] = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
function WebRTCClass(_ref) {
  var baseUrl = _ref.baseUrl,
    basePath = _ref.basePath,
    configuration = _ref.configuration,
    _ref$connectionCheckT = _ref.connectionCheckTimeout,
    connectionCheckTimeout = _ref$connectionCheckT === void 0 ? 10000 : _ref$connectionCheckT,
    logLevel = _ref.logLevel,
    msgLogCallback = _ref.msgLogCallback,
    connectionOpenWaitTime = _ref.connectionOpenWaitTime,
    onOpen = _ref.onOpen,
    onMessage = _ref.onMessage,
    onError = _ref.onError,
    onCustomError = _ref.onCustomError,
    onClose = _ref.onClose;
  var defaultConfig = {
      protocol: "https",
      baseUrl: "109.201.0.97",
      basePath: "/webrtc/",
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
      logLevel: null,
      msgLogCallback: null,
      connectionOpenWaitTime: 7000
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
      },
      eventCallback: {},
      subdomain: null,
      isDestroyed: false,
      dataChannelOpenTimeout: null,
      isDataChannelOpened: false
    };
  var config = {};
  if (baseUrl) config.baseUrl = baseUrl;
  if (basePath) config.basePath = basePath;
  if (configuration) config.configuration = configuration;
  if (connectionCheckTimeout) config.connectionCheckTimeout = connectionCheckTimeout;
  if (logLevel) config.logLevel = logLevel;
  if (connectionOpenWaitTime) config.connectionOpenWaitTime = connectionOpenWaitTime;
  defaultConfig = Object.assign(defaultConfig, config);
  defaultConfig.msgLogCallback = msgLogCallback;
  function isDataChannelOpened() {
    return variables.isDataChannelOpened;
  }
  function CandidatesSendQueueManager() {
    var config = {
      candidatesToSend: [],
      alreadyReceivedServerCandidates: false,
      reCheckTimeout: null
    };
    function trySendingCandidates() {
      timoutCallback();
      function timoutCallback() {
        if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
          config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
          if (config.candidatesToSend.length) {
            var entry = config.candidatesToSend.shift();
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
            })["catch"]();
          }
        } else {
          config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
          config.reCheckTimeout = setTimeout(timoutCallback, 1000);
        }
      }
    }
    function addServerCandidates(candidates) {
      for (var i in candidates) {
        webrtcFunctions.putCandidateToQueue(candidates[i]);
      }
    }
    return {
      add: function add(candidate) {
        config.candidatesToSend.push(candidate);
        trySendingCandidates();
      },
      destroy: function destroy() {
        config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
      }
    };
  }
  function PingManager(params) {
    var config = {
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
      resetPingLoop: function resetPingLoop() {
        this.stopPingLoop();
        this.setPingTimeout();
      },
      setPingTimeout: function setPingTimeout() {
        config.timeoutIds.first = setTimeout(function () {
          ping();
          config.timeoutIds.second = setTimeout(function () {
            ping();
            config.timeoutIds.third = setTimeout(function () {
              console.log("[Async][webrtc] Closing because of ping timeout.");
              defaultConfig.logLevel.debug && console.debug("[Async][Webrtc.js] Force closing connection.");
              publicized.close();
            }, 2000);
          }, 2000);
        }, 8000);
      },
      stopPingLoop: function stopPingLoop() {
        clearTimeout(config.timeoutIds.first);
        clearTimeout(config.timeoutIds.second);
        clearTimeout(config.timeoutIds.third);
        // clearTimeout(config.timeoutIds.fourth);
      }
    };
  }

  function connect() {
    variables.isDestroyed = false;
    webrtcFunctions.createPeerConnection();
    console.log("[Async][webrtc] defaultConfig.connectionOpenWaitTime", defaultConfig.connectionOpenWaitTime);
    variables.dataChannelOpenTimeout = setTimeout(function () {
      if (!isDataChannelOpened()) {
        console.log("[Async][webrtc] Closing because of wait timeout.");
        publicized.close();
      }
    }, defaultConfig.connectionOpenWaitTime);
  }
  var webrtcFunctions = {
    createPeerConnection: function createPeerConnection() {
      try {
        variables.peerConnection = new RTCPeerConnection(defaultConfig.configuration);
        console.log("[Async][webrtc] Created peer connection.");
      } catch (error) {
        publicized.close();
        console.error("[Async][webrtc] Webrtc Peer Create Error: ", error.message);
        return;
      }
      variables.peerConnection.addEventListener('signalingstatechange', webrtcFunctions.signalingStateChangeCallback);
      variables.peerConnection.onicecandidate = function (event) {
        if (event.candidate) {
          variables.candidateManager.add(event.candidate);
          webrtcFunctions.putCandidateToQueue(event.candidate);
        }
      };
      webrtcFunctions.createDataChannel();
      webrtcFunctions.generateSdpOffer().then(sendOfferToServer);
      function sendOfferToServer(offer) {
        handshakingFunctions.register(offer.sdp).then(processRegisterResult)["catch"]();
        variables.peerConnection.setLocalDescription(offer)["catch"](function (error) {
          return console.error(error);
        });
      }
      function processRegisterResult(result) {
        variables.clientId = result.clientId;
        variables.deviceId = result.deviceId;
        variables.subdomain = result.subDomain;
        webrtcFunctions.processAnswer(result.sdpAnswer);
      }
    },
    signalingStateChangeCallback: function signalingStateChangeCallback() {
      if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
        // handshakingFunctions.getCandidates().catch()
        webrtcFunctions.addTheCandidates();
      }
    },
    createDataChannel: function createDataChannel() {
      variables.dataChannel = variables.peerConnection.createDataChannel("dataChannel", {
        ordered: false
      });
      variables.dataChannel.onopen = dataChannelCallbacks.onopen;
      variables.dataChannel.onmessage = dataChannelCallbacks.onmessage;
      variables.dataChannel.onerror = dataChannelCallbacks.onerror;
      variables.dataChannel.onclose = dataChannelCallbacks.onclose;
    },
    generateSdpOffer: function generateSdpOffer() {
      return new Promise(function (resolve, reject) {
        variables.peerConnection.createOffer(function (offer) {
          resolve(offer);
        }, function (error) {
          reject(error);
          console.error(error);
        }).then(function (r) {
          console.log(r);
          if (r) {
            resolve(r);
          }
        });
      });
    },
    processAnswer: function processAnswer(answer) {
      var remoteDesc = {
        type: "answer",
        sdp: answer
      };
      variables.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc))["catch"](function (error) {
        console.error(error);
      });
    },
    addTheCandidates: function addTheCandidates() {
      while (variables.candidatesQueue.length) {
        var entry = variables.candidatesQueue.shift();
        variables.peerConnection.addIceCandidate(entry.candidate);
      }
    },
    putCandidateToQueue: function putCandidateToQueue(candidate) {
      variables.candidatesQueue.push({
        candidate: new RTCIceCandidate(candidate)
      });
      if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
        webrtcFunctions.addTheCandidates();
      }
    },
    sendData: function sendData(params) {
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
        if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
          //defaultConfig.logLevel.debug &&
          // console.log("[Async][WebRTC] Send ", data);
          var stringData = JSON.stringify(data);
          defaultConfig.msgLogCallback && defaultConfig.msgLogCallback({
            msg: stringData,
            direction: "send",
            time: new Date().getTime()
          });
          variables.dataChannel.send(stringData);
        }
      } catch (error) {
        onCustomError({
          errorCode: 4004,
          errorMessage: "Error in channel send message!",
          errorEvent: error
        });
      }
    }
  };
  var dataChannelCallbacks = {
    onopen: function onopen(event) {
      console.log("[Async][webrtc] dataChannel open");
      variables.isDataChannelOpened = true;
      variables.pingController.resetPingLoop();
      onOpen();
      var deviceRegister = {
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
    onmessage: function onmessage(event) {
      variables.pingController.resetPingLoop();
      decompressResponse(event.data).then(function (result) {
        defaultConfig.msgLogCallback && defaultConfig.msgLogCallback({
          msg: result,
          direction: "receive",
          time: new Date().getTime()
        });
        var messageData = JSON.parse(result);
        // console.log("[Async][WebRTC] Receive ", result);
        onMessage(messageData);
      });
    },
    onerror: function onerror(error) {
      console.log("[Async][webrtc] dataChannel.onerror happened. EventData:", error);
      defaultConfig.logLevel.debug && console.debug("[Async][webrtc] dataChannel.onerror happened. EventData:", error);
      onError();
      publicized.close();
    },
    onclose: function onclose(event) {
      console.log("[Async][webrtc] dataChannel.onclose happened. EventData:", event);
      publicized.close();
    }
  };
  function getApiUrl() {
    return (variables.subdomain ? variables.subdomain : defaultConfig.protocol + "://" + defaultConfig.baseUrl) + defaultConfig.basePath;
  }
  var handshakingFunctions = {
    register: function register(offer) {
      var retries = variables.apiCallRetries.register;
      return new Promise(promiseHandler);
      function promiseHandler(resolve, reject) {
        if (variables.isDestroyed) return;
        var registerEndPoint = getApiUrl() + defaultConfig.registerEndpoint;
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
        }).then(function (result) {
          return resolve(result);
        })["catch"](function (err) {
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
    getCandidates: function getCandidates(clientId) {
      var getIceCandidateEndPoint = getApiUrl() + defaultConfig.getICEEndpoint;
      getIceCandidateEndPoint += "clientId=" + clientId;
      var retries = variables.apiCallRetries.getIce;
      return new Promise(promiseHandler);
      function promiseHandler(resolve, reject) {
        if (variables.isDestroyed) return;
        fetch(getIceCandidateEndPoint, {
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
        })["catch"](function (err) {
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
    sendCandidate: function sendCandidate(candidate) {
      var addIceCandidateEndPoint = getApiUrl() + defaultConfig.addICEEndpoint,
        retries = variables.apiCallRetries.addIce;
      return new Promise(promiseHandler);
      function promiseHandler(resolve, reject) {
        if (variables.isDestroyed) return;
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
        })["catch"](function (err) {
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
  function resetVariables() {
    variables.subdomain = null;
    variables.pingController.stopPingLoop();
    variables.dataChannel && variables.dataChannel.close();
    variables.dataChannel = null;
    variables.peerConnection && variables.peerConnection.close();
    variables.peerConnection = null;
    variables.candidatesQueue = [];
    variables.clientId = null;
    variables.deviceId = null;
    variables.candidateManager.destroy();
    variables.candidateManager = new CandidatesSendQueueManager();
    variables.isDataChannelOpened = false;
    clearTimeout(variables.dataChannelOpenTimeout);
    // variables.isDestroyed = false;
    if (!variables.isDestroyed && onClose) {
      onClose();
    }
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
  var publicized = {};
  // publicized.on: function (messageName, callback) {
  //         variables.eventCallback[messageName] = callback;
  //     },
  publicized.emit = webrtcFunctions.sendData;
  publicized.connect = connect;
  publicized.close = function () {
    removeCallbacks();
    resetVariables();
  };
  publicized.destroy = function () {
    variables.isDestroyed = true;
    publicized.close();
    onOpen = null;
    onClose = null;
    onMessage = null;
    onError = null;
    onCustomError = null;
    // for (let i in variables.eventCallback) {
    //     delete variables.eventCallback[i];
    // }
  };

  /**
   * Decompress results
   */
  function decompress(_x, _x2) {
    return _decompress.apply(this, arguments);
  }
  function _decompress() {
    _decompress = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee(byteArray, encoding) {
      var result, res;
      return _regenerator["default"].wrap(function _callee$(_context) {
        while (1) switch (_context.prev = _context.next) {
          case 0:
            result = fflate.decompressSync(new Uint8Array(byteArray));
            res = new TextDecoder().decode(result);
            return _context.abrupt("return", res);
          case 3:
          case "end":
            return _context.stop();
        }
      }, _callee);
    }));
    return _decompress.apply(this, arguments);
  }
  function decompressResponse(_x3) {
    return _decompressResponse.apply(this, arguments);
  } //utility
  /**
   * Base64Url string to array buffer
   * - b64u->b64->biStr->byte[]->arrBuff
   * @param base64Url
   * @returns {ArrayBufferLike}
   * @private
   */
  function _decompressResponse() {
    _decompressResponse = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee2(compressedData) {
      return _regenerator["default"].wrap(function _callee2$(_context2) {
        while (1) switch (_context2.prev = _context2.next) {
          case 0:
            _context2.next = 2;
            return decompress(_base64UrlToArrayBuffer(compressedData), 'gzip');
          case 2:
            return _context2.abrupt("return", _context2.sent);
          case 3:
          case "end":
            return _context2.stop();
        }
      }, _callee2);
    }));
    return _decompressResponse.apply(this, arguments);
  }
  function _base64UrlToArrayBuffer(base64) {
    // console.log('array buffer from base64Url:', base64);
    var binaryString = window.atob(base64);
    var length = binaryString.length;
    var bytes = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    // console.log('array buffer:', bytes.buffer);
    return bytes.buffer;
  }
  return publicized;
}
module.exports = WebRTCClass;