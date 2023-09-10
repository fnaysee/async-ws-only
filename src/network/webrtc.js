import * as fflate from "fflate"
import * as logServer from "./logServer"
function WebRTCClass(
    {
        baseUrl,
        basePath,
        configuration,
        connectionCheckTimeout = 10000,
        logLevel,
        msgLogCallback,
        connectionOpenWaitTime,
        onOpen,
        onMessage,
        onError,
        onCustomError,
        onClose,
        asyncLogCallback
    }
) {
    let defaultConfig = {
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
                    "urls": "turn:turnsandbox.podstream.ir:3478", "username": "mkhorrami", "credential": "mkh_123456"
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
            pingController: new PingManager({waitTime: defaultConfig.connectionCheckTimeout}),
            candidatesQueue: [],
            // candidatesSendQueue: [],
            candidateManager: new CandidatesSendQueueManager(),
            clientId: null,
            deviceId: null,
            apiCallRetries: {
                register: 2,
                getIce: 3,
                addIce: 5
            },
            eventCallback: {},
            subdomain: null,
            isDestroyed: false,
            dataChannelOpenTimeout: null,
            isDataChannelOpened: false,
            controller: new AbortController()
        };


    let config = {}
    if (baseUrl)
        config.baseUrl = baseUrl;
    if (basePath)
        config.basePath = basePath;

    if (configuration)
        config.configuration = configuration;
    if (connectionCheckTimeout)
        config.connectionCheckTimeout = connectionCheckTimeout;
    if (logLevel)
        config.logLevel = logLevel;
    if(connectionOpenWaitTime)
        config.connectionOpenWaitTime = connectionOpenWaitTime;

    defaultConfig = Object.assign(defaultConfig, config);
    defaultConfig.msgLogCallback = msgLogCallback;



    function isDataChannelOpened(){
        return variables.isDataChannelOpened
    }

    function CandidatesSendQueueManager() {
        let config = {
            candidatesToSend: [],
            alreadyReceivedServerCandidates: false,
            reCheckTimeout: null
        }

        function trySendingCandidates() {
            timoutCallback();
            function timoutCallback() {
                if(variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
                    config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
                    if (config.candidatesToSend.length) {
                        let entry = config.candidatesToSend.shift();
                        handshakingFunctions
                            .sendCandidate(entry)
                            .then(function (result) {
                                if (result.length) {
                                    addServerCandidates(result);

                                    config.alreadyReceivedServerCandidates = true;
                                }
                                trySendingCandidates();
                            });

                    } else if (!config.alreadyReceivedServerCandidates) {
                        handshakingFunctions.getCandidates(variables.clientId).then(function (result) {
                            addServerCandidates(result)
                        }).catch();
                    }
                } else {
                    config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
                    config.reCheckTimeout = setTimeout(timoutCallback, 1000);
                }
            }
        }

        function addServerCandidates(candidates) {
            for(let i in candidates) {
                webrtcFunctions.putCandidateToQueue(candidates[i]);
            }
        }

        return {
            add: function (candidate) {
                config.candidatesToSend.push(candidate);
                trySendingCandidates();
            },
            destroy: function (){
                config.reCheckTimeout && clearTimeout(config.reCheckTimeout);
            }
        }
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
        }

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
                            console.log("[Async][webrtc] Closing because of ping timeout.");
                            defaultConfig.logLevel.debug && console.debug("[Async][Webrtc.js] Force closing connection.");
                            asyncLogCallback && asyncLogCallback("webrtc", "setPingTimeout", "closing");
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
            },
        }
    }

    function connect() {
        variables.isDestroyed = false;
        webrtcFunctions.createPeerConnection();
        // console.log("[Async][webrtc] defaultConfig.connectionOpenWaitTime", defaultConfig.connectionOpenWaitTime);
    }

    function waitForConnectionToOpen(){
        variables.dataChannelOpenTimeout = setTimeout(() => {
            if(!isDataChannelOpened()) {
                console.log("[Async][webrtc] Closing because of wait timeout.");
                asyncLogCallback && asyncLogCallback("webrtc", "dataChannelOpenTimeout", "closing");
                publicized.close();
            }
        }, defaultConfig.connectionOpenWaitTime);
    }

    let webrtcFunctions = {
        createPeerConnection: function () {
            try {
                variables.peerConnection = new RTCPeerConnection(defaultConfig.configuration);
                console.log("[Async][webrtc] Created peer connection.");
            } catch (error) {
                asyncLogCallback && asyncLogCallback("webrtc", "createPeerConnection", "closing");
                publicized.close();
                console.error("[Async][webrtc] Webrtc Peer Create Error: ", error.message);
                return
            }

            variables.peerConnection.onconnectionstatechange = function (event) {
                asyncLogCallback && asyncLogCallback("webrtc", "onconnectionstatechange", variables.peerConnection.connectionState);
            };
            variables.peerConnection.oniceconnectionstatechange = function (event) {
                asyncLogCallback && asyncLogCallback("webrtc", "oniceconnectionstatechange", variables.peerConnection.connectionState);
            };

            variables.peerConnection.addEventListener('signalingstatechange', webrtcFunctions.signalingStateChangeCallback);
            variables.peerConnection.onicecandidate = function (event) {
                if (event.candidate) {
                    variables.candidateManager.add(event.candidate);
                    webrtcFunctions.putCandidateToQueue(event.candidate);
                }
            };

            webrtcFunctions.createDataChannel();
            webrtcFunctions.generateSdpOffer()
                .then(sendOfferToServer);

            function sendOfferToServer(offer) {
                handshakingFunctions
                    .register(offer.sdp)
                    .then(processRegisterResult).catch();

                variables
                    .peerConnection.setLocalDescription(offer)
                    .catch(error => console.error(error));
            }

            function processRegisterResult(result) {
                variables.clientId = result.clientId;
                variables.deviceId = result.deviceId;
                variables.subdomain = result.subDomain;
                webrtcFunctions.processAnswer(result.sdpAnswer);
            }
        },
        signalingStateChangeCallback: function (signalingStateEvent) {
            asyncLogCallback && asyncLogCallback("webrtc", "signalingStateChangeCallback", variables.peerConnection.signalingState);
            if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
                // handshakingFunctions.getCandidates().catch()
                webrtcFunctions.addTheCandidates();
            }
        },
        createDataChannel: function () {
            variables.dataChannel = variables.peerConnection.createDataChannel("dataChannel", {ordered: false});
            variables.dataChannel.onopen = dataChannelCallbacks.onopen;
            variables.dataChannel.onmessage = dataChannelCallbacks.onmessage;
            variables.dataChannel.onerror = dataChannelCallbacks.onerror;
            variables.dataChannel.onclose = dataChannelCallbacks.onclose;
        },
        generateSdpOffer: function () {
            return new Promise(function (resolve, reject) {
                variables.peerConnection.createOffer(function (offer) {
                    resolve(offer)
                }, function (error) {
                    reject(error);
                    console.error(error);
                }).then(r => {
                    console.log(r)
                    if(r) {
                        resolve(r);
                    }
                });
            })
        },
        processAnswer: function (answer) {
            let remoteDesc = {
                type: "answer", sdp: answer
            };
            variables
                .peerConnection
                .setRemoteDescription(new RTCSessionDescription(remoteDesc))
                .catch(function (error) {
                    console.error(error)
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
            if (variables.peerConnection && variables.peerConnection.signalingState === 'stable') {
                webrtcFunctions.addTheCandidates();
            }
        },
        sendData: function(params) {
            if(!variables.dataChannel) {
                console.error("Connection is closed, do not send messages.")
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
                    let stringData = JSON.stringify(data);
                    defaultConfig.msgLogCallback && defaultConfig.msgLogCallback({
                        msg: stringData,
                        direction: "send",
                        time: new Date().getTime()
                    });
                    variables.dataChannel.send(stringData);
                }
            } catch (error) {
                asyncLogCallback && asyncLogCallback("webrtc", "webrtcFunctions.sendData.catch", error);
                onCustomError({
                    errorCode: 4004,
                    errorMessage: "Error in channel send message!",
                    errorEvent: error
                });
            }
        }
    }

    let dataChannelCallbacks = {
        onopen: function (event) {
            asyncLogCallback && asyncLogCallback("webrtc", "dataChannel.onopen", event);
            console.log("[Async][webrtc] dataChannel open");
            variables.isDataChannelOpened = true;
            variables.pingController.resetPingLoop();
            onOpen(variables.deviceId);
        },

        onmessage: function (event) {
            variables.pingController.resetPingLoop();
            decompressResponse(event.data).then(result => {
                defaultConfig.msgLogCallback && defaultConfig.msgLogCallback({
                    msg: result,
                    direction: "receive",
                    time: new Date().getTime()
                });
                let messageData = JSON.parse(result);
                // console.log("[Async][WebRTC] Receive ", result);
                onMessage(messageData);
            });
        },

        onerror: function (error) {
            asyncLogCallback && asyncLogCallback("webrtc", "dataChannel.onerror", error);

            console.log("[Async][webrtc] dataChannel.onerror happened. EventData:", error);
            defaultConfig.logLevel.debug && console.debug("[Async][webrtc] dataChannel.onerror happened. EventData:", error);
            onError();
            publicized.close();
        },
        onclose: function (event) {
            asyncLogCallback && asyncLogCallback("webrtc", "dataChannel.onclose", event);
            console.log("[Async][webrtc] dataChannel.onclose happened. EventData:", event);
            publicized.close();
        }
    }

    function getApiUrl() {
        return (variables.subdomain ? variables.subdomain : defaultConfig.protocol + "://" + defaultConfig.baseUrl) + defaultConfig.basePath;
    }

    let handshakingFunctions = {
        register: function (offer) {
            let retries = variables.apiCallRetries.register;
            return new Promise(promiseHandler);
            function promiseHandler(resolve, reject) {
                if(variables.isDestroyed)
                    return;

                let registerEndPoint = getApiUrl() + defaultConfig.registerEndpoint

                let controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2500);
                console.log("[webrtc] register()")
                logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'register', message: 'send register request'})
                fetch(registerEndPoint, {
                    method: "POST",
                    body: JSON.stringify({
                        offer: offer
                    }),
                    headers: {
                        "Content-Type": "application/json",
                        // 'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    signal: controller.signal
                })
                    .then(function (response) {
                        clearTimeout(timeoutId);
                        if(response.ok) {
                            logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'register', message: ' register success, result: ' + JSON.stringify(response.json()) })
                            console.log("[webrtc] register().success")
                            waitForConnectionToOpen();
                            return response.json();
                        } else if(retries) {
                            console.log("[webrtc] register().failed", {response});
                            logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'register', message: ' register failed'})
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else reject();
                    })
                    .then(result => resolve(result))
                    .catch(err => {
                        logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'register', message: ' register catch.failed' + JSON.stringify(err)})
                        console.log("[webrtc] register().catch.failed", {err})
                        clearTimeout(timeoutId);
                        if(retries){
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else {
                            console.log("[webrtc] register().catch.failed.closing", {err})
                            logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'register', message: ' register catch.failed' + JSON.stringify(err)});
                            asyncLogCallback && asyncLogCallback("webrtc", "register.catch", "closing");
                            publicized.close();
                        }
                        console.error(err);
                    });
            }
            function retryTheRequest(resolve, reject){
                setTimeout(function (){promiseHandler(resolve, reject)}, 1000);
            }
        },
        getCandidates: function (clientId) {
            let getIceCandidateEndPoint = getApiUrl() + defaultConfig.getICEEndpoint
            getIceCandidateEndPoint += "clientId=" + clientId;

            let retries = variables.apiCallRetries.getIce;
            return new Promise(promiseHandler);
            function promiseHandler(resolve, reject) {
                if(variables.isDestroyed)
                    return;

                fetch(getIceCandidateEndPoint, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        // 'Content-Type': 'application/x-www-form-urlencoded',
                    },
                })
                    .then(function (response) {
                        if(response.ok)
                            return response.json();
                        else if(retries){
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else reject();
                    })
                    .then(function (result) {
                        resolve(result.iceCandidates)
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
                    })
                    .catch(function (err) {
                        if(retries){
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else reject(err);
                        console.error(err);
                    });
            }

            function retryTheRequest(resolve, reject){
                setTimeout(function (){promiseHandler(resolve, reject)}, 1000);
            }

        },
        sendCandidate: function (candidate) {
            let addIceCandidateEndPoint = getApiUrl() + defaultConfig.addICEEndpoint
                , retries = variables.apiCallRetries.addIce;

            return new Promise(promiseHandler);
            function promiseHandler(resolve, reject) {
                if(variables.isDestroyed)
                    return;

                logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'addIce', message: 'send addIce request' })
                fetch(addIceCandidateEndPoint, {
                    method: "POST",
                    body: JSON.stringify({
                        "clientId": variables.clientId,
                        "candidate": candidate
                    }),
                    headers: {
                        "Content-Type": "application/json",
                        // 'Content-Type': 'application/x-www-form-urlencoded',
                    },
                })
                    .then(function (response) {
                        if(response.ok){
                            logServer.log({time: new Date().toLocaleString(),module: 'webrtc', method: 'addIce', message: 'addIce success, result: ' + JSON.stringify(response.json()) })
                            return response.json();
                        }
                        else if(retries){
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else reject();
                    })
                    .then(function (result) {
                        resolve(result.iceCandidates);
                    })
                    .catch(err => {
                        if(retries){
                            retryTheRequest(resolve, reject);
                            retries--;
                        } else reject(err);
                        console.error(err);
                    });
            }

            function retryTheRequest(resolve, reject){
                setTimeout(function (){promiseHandler(resolve, reject)}, 2000);
            }
        }
    }

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
        if(!variables.isDestroyed && onClose){
            onClose();
        }
    }

    function ping() {
        webrtcFunctions.sendData({
            type: 0
        });
    }
    function removeCallbacks(){
        if(variables.peerConnection)
            variables.peerConnection.onicecandidate = null;
        if(variables.dataChannel) {
            variables.dataChannel.onclose = null;
            variables.dataChannel.onmessage = null;
            variables.dataChannel.onerror = null;
            variables.dataChannel.onopen = null;
        }
    }



    const publicized = {};
    // publicized.on: function (messageName, callback) {
    //         variables.eventCallback[messageName] = callback;
    //     },
    publicized.emit = webrtcFunctions.sendData;
    publicized.connect = connect;
    publicized.close = function () {
        asyncLogCallback && asyncLogCallback("webrtc", "publicized.close", "closing");
        removeCallbacks();
        resetVariables();
    }
    publicized.destroy = function () {
        variables.isDestroyed = true;
        asyncLogCallback && asyncLogCallback("webrtc", "publicized.destroy", "closing")
        publicized.close();
        onOpen = null;
        onClose = null;
        onMessage = null;
        onError = null;
        onCustomError = null;
        // for (let i in variables.eventCallback) {
        //     delete variables.eventCallback[i];
        // }
    }


    /**
     * Decompress results
     */
    async function decompress(byteArray, encoding) {
        const result = fflate.decompressSync(new Uint8Array(byteArray));
        const res = new TextDecoder().decode(result)
        return res;
    }

    async function decompressResponse(compressedData) {
        return await decompress(_base64UrlToArrayBuffer(compressedData), 'gzip');
    }

//utility

    /**
     * Base64Url string to array buffer
     * - b64u->b64->biStr->byte[]->arrBuff
     * @param base64Url
     * @returns {ArrayBufferLike}
     * @private
     */
    function _base64UrlToArrayBuffer(base64) {
        // console.log('array buffer from base64Url:', base64);
        const binaryString = window.atob(base64);
        const length = binaryString.length;
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        // console.log('array buffer:', bytes.buffer);
        return bytes.buffer;
    }


    return publicized;
}


module.exports = WebRTCClass;