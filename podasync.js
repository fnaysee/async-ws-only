(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
window.PodAsync = require('./src/network/async.js')

},{"./src/network/async.js":3}],2:[function(require,module,exports){
(function (global){
// https://github.com/maxogden/websocket-stream/blob/48dc3ddf943e5ada668c31ccd94e9186f02fafbd/ws-fallback.js

var ws = null

if (typeof WebSocket !== 'undefined') {
  ws = WebSocket
} else if (typeof MozWebSocket !== 'undefined') {
  ws = MozWebSocket
} else if (typeof global !== 'undefined') {
  ws = global.WebSocket || global.MozWebSocket
} else if (typeof window !== 'undefined') {
  ws = window.WebSocket || window.MozWebSocket
} else if (typeof self !== 'undefined') {
  ws = self.WebSocket || self.MozWebSocket
}

module.exports = ws

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(require,module,exports){
(function () {
    /*
     * Async module to handle async messaging
     * @module Async
     *
     * @param {Object} params
     */

    function Async(params) {

        /*******************************************************
         *          P R I V A T E   V A R I A B L E S          *
         *******************************************************/

        var PodSocketClass,
            PodUtility;

        if (typeof(require) !== 'undefined' && typeof(exports) !== 'undefined') {
            PodSocketClass = require('./socket.js');
            PodUtility = require('../utility/utility.js');
        }
        else {
            PodSocketClass = POD.Socket;
            PodUtility = POD.AsyncUtility;
        }

        var Utility = new PodUtility();

        var protocol = params.protocol || 'websocket',
            appId = params.appId || 'PodChat',
            deviceId = params.deviceId,
            eventCallbacks = {
                connect: {},
                disconnect: {},
                reconnect: {},
                message: {},
                asyncReady: {},
                stateChange: {},
                error: {}
            },
            ackCallback = {},
            socket,
            asyncMessageType = {
                PING: 0,
                SERVER_REGISTER: 1,
                DEVICE_REGISTER: 2,
                MESSAGE: 3,
                MESSAGE_ACK_NEEDED: 4,
                MESSAGE_SENDER_ACK_NEEDED: 5,
                ACK: 6,
                GET_REGISTERED_PEERS: 7,
                PEER_REMOVED: -3,
                REGISTER_QUEUE: -2,
                NOT_REGISTERED: -1,
                ERROR_MESSAGE: -99
            },
            socketStateType = {
                CONNECTING: 0, // The connection is not yet open.
                OPEN: 1, // The connection is open and ready to communicate.
                CLOSING: 2, // The connection is in the process of closing.
                CLOSED: 3 // The connection is closed or couldn't be opened.
            },
            isNode = Utility.isNode(),
            isSocketOpen = false,
            isDeviceRegister = false,
            isServerRegister = false,
            socketState = socketStateType.CONNECTING,
            asyncState = '',
            registerServerTimeoutId,
            registerDeviceTimeoutId,
            checkIfSocketHasOpennedTimeoutId,
            asyncReadyTimeoutId,
            pushSendDataQueue = [],
            oldPeerId,
            peerId = params.peerId,
            lastMessageId = 0,
            messageTtl = params.messageTtl || 86400,
            serverName = params.serverName || 'oauth-wire',
            serverRegisteration = (typeof params.serverRegisteration === 'boolean') ? params.serverRegisteration : true,
            connectionRetryInterval = params.connectionRetryInterval || 5000,
            socketReconnectRetryInterval,
            socketReconnectCheck,
            retryStep = 4,
            reconnectOnClose = (typeof params.reconnectOnClose === 'boolean') ? params.reconnectOnClose : true,
            asyncLogging = (params.asyncLogging && typeof params.asyncLogging.onFunction === 'boolean') ? params.asyncLogging.onFunction : false,
            onReceiveLogging = (params.asyncLogging && typeof params.asyncLogging.onMessageReceive === 'boolean')
                ? params.asyncLogging.onMessageReceive
                : false,
            onSendLogging = (params.asyncLogging && typeof params.asyncLogging.onMessageSend === 'boolean') ? params.asyncLogging.onMessageSend : false,
            workerId = (params.asyncLogging && typeof parseInt(params.asyncLogging.workerId) === 'number') ? params.asyncLogging.workerId : 0;

        /*******************************************************
         *            P R I V A T E   M E T H O D S            *
         *******************************************************/

        var init = function () {
                switch (protocol) {
                    case 'websocket':
                        initSocket();
                        break;
                }
            },

            asyncLogger = function (type, msg) {
                Utility.asyncLogger({
                    protocol: protocol,
                    workerId: workerId,
                    type: type,
                    msg: msg,
                    peerId: peerId,
                    deviceId: deviceId,
                    isSocketOpen: isSocketOpen,
                    isDeviceRegister: isDeviceRegister,
                    isServerRegister: isServerRegister,
                    socketState: socketState,
                    pushSendDataQueue: pushSendDataQueue
                });
            },

            initSocket = function () {
                socket = new PodSocketClass({
                    socketAddress: params.socketAddress,
                    wsConnectionWaitTime: params.wsConnectionWaitTime,
                    connectionCheckTimeout: params.connectionCheckTimeout,
                    connectionCheckTimeoutThreshold: params.connectionCheckTimeoutThreshold
                });

                checkIfSocketHasOpennedTimeoutId = setTimeout(function () {
                    if (!isSocketOpen) {
                        fireEvent('error', {
                            errorCode: 4001,
                            errorMessage: 'Can not open Socket!'
                        });
                    }
                }, 65000);

                socket.on('open', function () {
                    checkIfSocketHasOpennedTimeoutId && clearTimeout(checkIfSocketHasOpennedTimeoutId);
                    socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
                    socketReconnectCheck && clearTimeout(socketReconnectCheck);

                    isSocketOpen = true;
                    retryStep = 4;

                    socketState = socketStateType.OPEN;
                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });
                });

                socket.on('message', function (msg) {
                    handleSocketMessage(msg);
                    if (onReceiveLogging) {
                        asyncLogger('Receive', msg);
                    }
                });

                socket.on('close', function (event) {
                    isSocketOpen = false;
                    isDeviceRegister = false;
                    oldPeerId = peerId;

                    socketState = socketStateType.CLOSED;

                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });

                    fireEvent('disconnect', event);

                    if (reconnectOnClose) {
                        if (asyncLogging) {
                            if (workerId > 0) {
                                Utility.asyncStepLogger(workerId + '\t Reconnecting after ' + retryStep + 's');
                            }
                            else {
                                Utility.asyncStepLogger('Reconnecting after ' + retryStep + 's');
                            }
                        }

                        socketState = socketStateType.CLOSED;
                        fireEvent('stateChange', {
                            socketState: socketState,
                            timeUntilReconnect: 1000 * retryStep,
                            deviceRegister: isDeviceRegister,
                            serverRegister: isServerRegister,
                            peerId: peerId
                        });

                        socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);

                        socketReconnectRetryInterval = setTimeout(function () {
                            socket.connect();
                        }, 1000 * retryStep);

                        if (retryStep < 64) {
                            retryStep *= 2;
                        }

                        // socketReconnectCheck && clearTimeout(socketReconnectCheck);
                        //
                        // socketReconnectCheck = setTimeout(function() {
                        //   if (!isSocketOpen) {
                        //     fireEvent("error", {
                        //       errorCode: 4001,
                        //       errorMessage: "Can not open Socket!"
                        //     });
                        //
                        //     socketState = socketStateType.CLOSED;
                        //     fireEvent("stateChange", {
                        //       socketState: socketState,
                        //       deviceRegister: isDeviceRegister,
                        //       serverRegister: isServerRegister,
                        //       peerId: peerId
                        //     });
                        //   }
                        // }, 65000);

                    }
                    else {
                        socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
                        socketReconnectCheck && clearTimeout(socketReconnectCheck);
                        fireEvent('error', {
                            errorCode: 4005,
                            errorMessage: 'Socket Closed!'
                        });

                        socketState = socketStateType.CLOSED;
                        fireEvent('stateChange', {
                            socketState: socketState,
                            timeUntilReconnect: 0,
                            deviceRegister: isDeviceRegister,
                            serverRegister: isServerRegister,
                            peerId: peerId
                        });
                    }

                });

                socket.on('customError', function (error) {
                    fireEvent('error', {
                        errorCode: error.errorCode,
                        errorMessage: error.errorMessage,
                        errorEvent: error.errorEvent
                    });
                });

                socket.on('error', function (error) {
                    fireEvent('error', {
                        errorCode: '',
                        errorMessage: '',
                        errorEvent: error
                    });
                });
            },

            handleSocketMessage = function (msg) {
                var ack;

                if (msg.type === asyncMessageType.MESSAGE_ACK_NEEDED || msg.type === asyncMessageType.MESSAGE_SENDER_ACK_NEEDED) {
                    ack = function () {
                        pushSendData({
                            type: asyncMessageType.ACK,
                            content: {
                                messageId: msg.id
                            }
                        });
                    };
                }

                switch (msg.type) {
                    case asyncMessageType.PING:
                        handlePingMessage(msg);
                        break;

                    case asyncMessageType.SERVER_REGISTER:
                        handleServerRegisterMessage(msg);
                        break;

                    case asyncMessageType.DEVICE_REGISTER:
                        handleDeviceRegisterMessage(msg.content);
                        break;

                    case asyncMessageType.MESSAGE:
                        fireEvent('message', msg);
                        break;

                    case asyncMessageType.MESSAGE_ACK_NEEDED:
                    case asyncMessageType.MESSAGE_SENDER_ACK_NEEDED:
                        ack();
                        fireEvent('message', msg);
                        break;

                    case asyncMessageType.ACK:
                        fireEvent('message', msg);
                        if (ackCallback[msg.senderMessageId] == 'function') {
                            ackCallback[msg.senderMessageId]();
                            delete ackCallback[msg.senderMessageId];
                        }
                        break;

                    case asyncMessageType.ERROR_MESSAGE:
                        fireEvent('error', {
                            errorCode: 4002,
                            errorMessage: 'Async Error!',
                            errorEvent: msg
                        });
                        break;
                }
            },

            handlePingMessage = function (msg) {
                if (msg.content) {
                    if (deviceId === undefined) {
                        deviceId = msg.content;
                        registerDevice();
                    }
                    else {
                        registerDevice();
                    }
                }
                else {
                    if (onReceiveLogging) {
                        if (workerId > 0) {
                            Utility.asyncStepLogger(workerId + '\t Ping Response at (' + new Date() + ')');
                        }
                        else {
                            Utility.asyncStepLogger('Ping Response at (' + new Date() + ')');
                        }
                    }
                }
            },

            registerDevice = function (isRetry) {
                if (asyncLogging) {
                    if (workerId > 0) {
                        Utility.asyncStepLogger(workerId + '\t Registering Device');
                    }
                    else {
                        Utility.asyncStepLogger('Registering Device');
                    }
                }

                var content = {
                    appId: appId,
                    deviceId: deviceId
                };

                if (peerId !== undefined) {
                    content.refresh = true;
                }
                else {
                    content.renew = true;
                }

                pushSendData({
                    type: asyncMessageType.DEVICE_REGISTER,
                    content: content
                });
            },

            handleDeviceRegisterMessage = function (recievedPeerId) {
                if (!isDeviceRegister) {
                    if (registerDeviceTimeoutId) {
                        clearTimeout(registerDeviceTimeoutId);
                    }

                    isDeviceRegister = true;
                    peerId = recievedPeerId;
                }

                /**
                 * If serverRegisteration == true we have to register
                 * on server then make async status ready
                 */
                if (serverRegisteration) {
                    if (isServerRegister && peerId === oldPeerId) {
                        fireEvent('asyncReady');
                        isServerRegister = true;
                        pushSendDataQueueHandler();

                        socketState = socketStateType.OPEN;
                        fireEvent('stateChange', {
                            socketState: socketState,
                            timeUntilReconnect: 0,
                            deviceRegister: isDeviceRegister,
                            serverRegister: isServerRegister,
                            peerId: peerId
                        });
                    }
                    else {
                        socketState = socketStateType.OPEN;
                        fireEvent('stateChange', {
                            socketState: socketState,
                            timeUntilReconnect: 0,
                            deviceRegister: isDeviceRegister,
                            serverRegister: isServerRegister,
                            peerId: peerId
                        });

                        registerServer();
                    }
                }
                else {
                    fireEvent('asyncReady');
                    isServerRegister = 'Not Needed';
                    pushSendDataQueueHandler();

                    if (asyncLogging) {
                        if (workerId > 0) {
                            Utility.asyncStepLogger(workerId + '\t Async is Ready');
                        }
                        else {
                            Utility.asyncStepLogger('Async is Ready');
                        }
                    }

                    socketState = socketStateType.OPEN;
                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });
                }
            },

            registerServer = function () {

                if (asyncLogging) {
                    if (workerId > 0) {
                        Utility.asyncStepLogger(workerId + '\t Registering Server');
                    }
                    else {
                        Utility.asyncStepLogger('Registering Server');
                    }
                }

                var content = {
                    name: serverName
                };

                pushSendData({
                    type: asyncMessageType.SERVER_REGISTER,
                    content: content
                });

                registerServerTimeoutId = setTimeout(function () {
                    if (!isServerRegister) {
                        registerServer();
                    }
                }, connectionRetryInterval);
            },

            handleServerRegisterMessage = function (msg) {
                if (msg.senderName && msg.senderName === serverName) {
                    isServerRegister = true;

                    if (registerServerTimeoutId) {
                        clearTimeout(registerServerTimeoutId);
                    }

                    socketState = socketStateType.OPEN;
                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });
                    fireEvent('asyncReady');

                    pushSendDataQueueHandler();

                    if (asyncLogging) {
                        if (workerId > 0) {
                            Utility.asyncStepLogger(workerId + '\t Async is Ready');
                        }
                        else {
                            Utility.asyncStepLogger('Async is Ready');
                        }
                    }
                }
                else {
                    isServerRegister = false;
                }
            },

            pushSendData = function (msg) {
                if (onSendLogging) {
                    asyncLogger('Send', msg);
                }

                switch (protocol) {
                    case 'websocket':
                        if (socketState === socketStateType.OPEN) {
                            socket.emit(msg);
                        }
                        else {
                            pushSendDataQueue.push(msg);
                        }
                        break;
                }
            },

            clearTimeouts = function () {
                registerDeviceTimeoutId && clearTimeout(registerDeviceTimeoutId);
                registerServerTimeoutId && clearTimeout(registerServerTimeoutId);
                checkIfSocketHasOpennedTimeoutId && clearTimeout(checkIfSocketHasOpennedTimeoutId);
                socketReconnectCheck && clearTimeout(socketReconnectCheck);
            },

            pushSendDataQueueHandler = function () {
                while (pushSendDataQueue.length > 0 && socketState === socketStateType.OPEN) {
                    var msg = pushSendDataQueue.splice(0, 1)[0];
                    pushSendData(msg);
                }
            },

            fireEvent = function (eventName, param, ack) {
                try {
                    if (ack) {
                        for (var id in eventCallbacks[eventName]) {
                            eventCallbacks[eventName][id](param, ack);
                        }
                    }
                    else {
                        for (var id in eventCallbacks[eventName]) {
                            eventCallbacks[eventName][id](param);
                        }
                    }
                }
                catch (e) {
                    fireEvent('error', {
                        errorCode: 999,
                        errorMessage: 'Unknown ERROR!',
                        errorEvent: e
                    });
                }
            };

        /*******************************************************
         *             P U B L I C   M E T H O D S             *
         *******************************************************/

        this.on = function (eventName, callback) {
            if (eventCallbacks[eventName]) {
                var id = Utility.generateUUID();
                eventCallbacks[eventName][id] = callback;
                return id;
            }
            if (eventName === 'connect' && socketState === socketStateType.OPEN) {
                callback(peerId);
            }
        };

        this.send = function (params, callback) {
            var messageType = (typeof params.type === 'number')
                ? params.type
                : (callback)
                    ? asyncMessageType.MESSAGE_SENDER_ACK_NEEDED
                    : asyncMessageType.MESSAGE;

            var socketData = {
                type: messageType,
                content: params.content
            };

            if (params.trackerId) {
                socketData.trackerId = params.trackerId;
            }

            lastMessageId += 1;
            var messageId = lastMessageId;

            if (messageType === asyncMessageType.MESSAGE_SENDER_ACK_NEEDED || messageType === asyncMessageType.MESSAGE_ACK_NEEDED) {
                ackCallback[messageId] = function () {
                    callback && callback();
                };
            }

            socketData.content.messageId = messageId;
            socketData.content.ttl = messageTtl;

            pushSendData(socketData);
        };

        this.getAsyncState = function () {
            return socketState;
        };

        this.getSendQueue = function () {
            return pushSendDataQueue;
        };

        this.getPeerId = function () {
            return peerId;
        };

        this.getServerName = function () {
            return serverName;
        };

        this.setServerName = function (newServerName) {
            serverName = newServerName;
        };

        this.setDeviceId = function (newDeviceId) {
            deviceId = newDeviceId;
        };

        this.close = function () {
            oldPeerId = peerId;
            isDeviceRegister = false;
            isSocketOpen = false;
            clearTimeouts();

            switch (protocol) {
                case 'websocket':
                    socketState = socketStateType.CLOSED;
                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });

                    socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
                    socket.close();
                    break;
            }
        };

        this.logout = function () {
            oldPeerId = peerId;
            peerId = undefined;
            isServerRegister = false;
            isDeviceRegister = false;
            isSocketOpen = false;
            deviceId = undefined;
            pushSendDataQueue = [];
            ackCallback = {};
            clearTimeouts();

            switch (protocol) {
                case 'websocket':
                    socketState = socketStateType.CLOSED;
                    fireEvent('stateChange', {
                        socketState: socketState,
                        timeUntilReconnect: 0,
                        deviceRegister: isDeviceRegister,
                        serverRegister: isServerRegister,
                        peerId: peerId
                    });

                    reconnectOnClose = false;

                    socket.close();
                    break;
            }
        };

        this.reconnectSocket = function () {
            oldPeerId = peerId;
            isDeviceRegister = false;
            isSocketOpen = false;
            clearTimeouts();

            socketState = socketStateType.CLOSED;
            fireEvent('stateChange', {
                socketState: socketState,
                timeUntilReconnect: 0,
                deviceRegister: isDeviceRegister,
                serverRegister: isServerRegister,
                peerId: peerId
            });

            socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
            socket.close();

            socketReconnectRetryInterval = setTimeout(function () {
                retryStep = 4;
                socket.connect();
            }, 2000);
        };

        this.generateUUID = Utility.generateUUID;

        init();
    }

    if (typeof module !== 'undefined' && typeof module.exports != 'undefined') {
        module.exports = Async;
    }
    else {
        if (!window.POD) {
            window.POD = {};
        }
        window.POD.Async = Async;
    }
})();

},{"../utility/utility.js":5,"./socket.js":4}],4:[function(require,module,exports){
(function() {
  /*
   * Socket Module to connect and handle Socket functionalities
   * @module Socket
   *
   * @param {Object} params
   */

  function Socket(params) {

    if (typeof(WebSocket) === "undefined" && typeof(require) !== "undefined" && typeof(exports) !== "undefined") {
      WebSocket = require('isomorphic-ws');
    }

    /*******************************************************
     *          P R I V A T E   V A R I A B L E S          *
     *******************************************************/

    var address = params.socketAddress,
      wsConnectionWaitTime = params.wsConnectionWaitTime || 500,
      connectionCheckTimeout = params.connectionCheckTimeout || 10000,
      eventCallback = {},
      socket,
      waitForSocketToConnectTimeoutId,
      forceCloseSocket = false,
      forceCloseSocketTimeout,
      socketRealTimeStatusInterval,
      sendPingTimeout,
      socketCloseTimeout,
      forceCloseTimeout;

    /*******************************************************
     *            P R I V A T E   M E T H O D S            *
     *******************************************************/

    var init = function() {
        connect();
      },

      connect = function() {
        try {
          if (socket && socket.readyState == 1) {
            return;
          }

          socket = new WebSocket(address, []);

          socketRealTimeStatusInterval && clearInterval(socketRealTimeStatusInterval);
          socketRealTimeStatusInterval = setInterval(function() {
            switch (socket.readyState) {
              case 2:
                onCloseHandler(null);
                break;
              case 3:
                socketRealTimeStatusInterval && clearInterval(socketRealTimeStatusInterval);
                break;
            }
          }, 5000);

          socket.onopen = function(event) {
            waitForSocketToConnect(function() {
              eventCallback["open"]();
            });
          }

          socket.onmessage = function(event) {
            var messageData = JSON.parse(event.data);
            eventCallback["message"](messageData);

            /**
             * To avoid manually closing socket's connection
             */
            forceCloseSocket = false;

            socketCloseTimeout && clearTimeout(socketCloseTimeout);
            forceCloseTimeout && clearTimeout(forceCloseTimeout);

            socketCloseTimeout = setTimeout(function() {
              /**
               * If message's type is not 5, socket won't get any acknowledge packet,therefore
               * you may think that connection has been closed and you would force socket
               * to close, but before that you should make sure that connection is actually closed!
               * for that, you must send a ping message and if that message don't get any
               * responses too, you are allowed to manually kill socket connection.
               */
              ping();

              /**
               * We set forceCloseSocket as true so that if your ping's response don't make it
               * you close your socket
               */
              forceCloseSocket = true;

              /**
               * If type of messages are not 5, you won't get ant ACK packets
               * for that being said, we send a ping message to be sure of
               * socket connection's state. The ping message should have an
               * ACK, if not, you're allowed to close your socket after
               * 4 * [connectionCheckTimeout] seconds
               */
              forceCloseTimeout = setTimeout(function() {
                if (forceCloseSocket) {
                  socket.close();
                }
              }, connectionCheckTimeout);

            }, connectionCheckTimeout * 1.5);
          }

          socket.onclose = function(event) {
            onCloseHandler(event);
          }

          socket.onerror = function(event) {
            eventCallback["error"](event);
          }
        } catch (error) {
          eventCallback["customError"]({
            errorCode: 4000,
            errorMessage: "ERROR in WEBSOCKET!",
            errorEvent: error
          });
        }
      },

      onCloseHandler = function(event) {
        sendPingTimeout && clearTimeout(sendPingTimeout);
        socketCloseTimeout && clearTimeout(socketCloseTimeout);
        forceCloseTimeout && clearTimeout(forceCloseTimeout);
        eventCallback["close"](event);
      },

      ping = function() {
        sendData({
          type: 0
        });
      },

      waitForSocketToConnect = function(callback) {
        waitForSocketToConnectTimeoutId && clearTimeout(waitForSocketToConnectTimeoutId);

        if (socket.readyState === 1) {
          callback();
        } else {
          waitForSocketToConnectTimeoutId = setTimeout(function() {
            if (socket.readyState === 1) {
              callback();
            } else {
              waitForSocketToConnect(callback);
            }
          }, wsConnectionWaitTime);
        }
      },

      sendData = function(params) {
        var data = {
          type: params.type
        };

        if (params.trackerId) {
          data.trackerId = params.trackerId;
        }

        sendPingTimeout && clearTimeout(sendPingTimeout);
        sendPingTimeout = setTimeout(function() {
          ping();
        }, connectionCheckTimeout);

        try {
          if (params.content) {
            data.content = JSON.stringify(params.content);
          }

          if (socket.readyState === 1) {
            socket.send(JSON.stringify(data));
          }
        } catch (error) {
          eventCallback["customError"]({
            errorCode: 4004,
            errorMessage: "Error in Socket sendData!",
            errorEvent: error
          });
        }
      };

    /*******************************************************
     *             P U B L I C   M E T H O D S             *
     *******************************************************/

    this.on = function(messageName, callback) {
      eventCallback[messageName] = callback;
    }

    this.emit = sendData;

    this.connect = function() {
      connect();
    }

    this.close = function() {
      sendPingTimeout && clearTimeout(sendPingTimeout);
      socketCloseTimeout && clearTimeout(socketCloseTimeout);
      forceCloseTimeout && clearTimeout(forceCloseTimeout);
      socket.close();
    }

    init();
  }

  if (typeof module !== 'undefined' && typeof module.exports != "undefined") {
    module.exports = Socket;
  } else {
    if (!window.POD) {
      window.POD = {};
    }
    window.POD.Socket = Socket;
  }

})();

},{"isomorphic-ws":2}],5:[function(require,module,exports){
(function (global){
(function() {
  /**
   * General Utilities
   */
  function Utility() {
    /**
     * Checks if Client is using NodeJS or not
     * @return {boolean}
     */
    this.isNode = function() {
      // return (typeof module !== 'undefined' && typeof module.exports != "undefined");
      return (typeof global !== "undefined" && ({}).toString.call(global) === '[object global]');
    }

    /**
     * Generates Random String
     * @param   {int}     sectionCount
     * @return  {string}
     */
    this.generateUUID = function(sectionCount) {
      var d = new Date().getTime();
      var textData = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';

      if (sectionCount == 1) {
        textData = 'xxxxxxxx';
      }

      if (sectionCount == 2) {
        textData = 'xxxxxxxx-xxxx';
      }

      if (sectionCount == 3) {
        textData = 'xxxxxxxx-xxxx-4xxx';
      }

      if (sectionCount == 4) {
        textData = 'xxxxxxxx-xxxx-4xxx-yxxx';
      }

      var uuid = textData.replace(/[xy]/g, function(c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);

        return (
          c == 'x' ?
          r :
          (r & 0x7 | 0x8)).toString(16);
      });
      return uuid;
    };

    /**
     * Prints Socket Status on Both Browser and Linux Terminal
     * @param {object} params Socket status + current msg + send queue
     * @return
     */
    this.asyncLogger = function(params) {
      var type = params.type,
        msg = params.msg,
        peerId = params.peerId,
        deviceId = params.deviceId,
        isSocketOpen = params.isSocketOpen,
        isDeviceRegister = params.isDeviceRegister,
        isServerRegister = params.isServerRegister,
        socketState = params.socketState,
        pushSendDataQueue = params.pushSendDataQueue,
        workerId = params.workerId,
        protocol = params.protocol || "websocket",
        BgColor;

      switch (type) {
        case "Send":
          BgColor = 44;
          FgColor = 34;
          ColorCSS = "#4c8aff";
          break;

        case "Receive":
          BgColor = 45;
          FgColor = 35;
          ColorCSS = "#aa386d";
          break;

        case "Error":
          BgColor = 41;
          FgColor = 31;
          ColorCSS = "#ff0043";
          break;

        default:
          BgColor = 45;
          ColorCSS = "#212121";
          break;
      }

      switch (protocol) {
        case "websocket":
          if (typeof global !== "undefined" && ({}).toString.call(global) === '[object global]') {
            console.log("\n");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\x1b[" + BgColor + "m\x1b[8m##################\x1b[0m\x1b[37m\x1b[" + BgColor + "m S O C K E T    S T A T U S \x1b[0m\x1b[" + BgColor + "m\x1b[8m##################\x1b[0m");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t\t\t\t\t\t\t      \x1b[" + BgColor + "m\x1b[8m##\x1b[0m");
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " PEER ID\t\t", peerId);
            if (workerId > 0) {
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " WORKER ID\t\t", workerId);
            }
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " DEVICE ID\t\t", deviceId);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " IS SOCKET OPEN\t", isSocketOpen);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " DEVICE REGISTER\t", isDeviceRegister);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " SERVER REGISTER\t", isServerRegister);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " SOCKET STATE\t", socketState);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[" + FgColor + "m%s\x1b[0m ", " CURRENT MESSAGE\t", type);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");

            Object.keys(msg).forEach(function(key) {
              if (typeof msg[key] === 'object') {
                console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m-\x1b[0m \x1b[35m%s\x1b[0m", key);
                Object.keys(msg[key]).forEach(function(k) {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t   \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", k, msg[key][k]);
                });
              } else {
                console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", key, msg[key]);
              }
            });

            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");

            if (pushSendDataQueue.length > 0) {
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m", " SEND QUEUE");
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");
              Object.keys(pushSendDataQueue).forEach(function(key) {
                if (typeof pushSendDataQueue[key] === 'object') {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m-\x1b[0m \x1b[35m%s\x1b[0m", key);
                  Object.keys(pushSendDataQueue[key]).forEach(function(k) {
                    console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t   \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[36m%s\x1b[0m", k, JSON.stringify(pushSendDataQueue[key][k]));
                  });
                } else {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", key, pushSendDataQueue[key]);
                }
              });

            } else {
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m ", " SEND QUEUE\t\t", "Empty");
            }

            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t\t\t\t\t\t\t      \x1b[" + BgColor + "m\x1b[8m##\x1b[0m");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\n");
          } else {
            console.log("\n");
            console.log("%cS O C K E T    S T A T U S", 'background: ' + ColorCSS + '; padding: 10px 142px; font-weight: bold; font-size: 18px; color: #fff;');
            console.log("\n");
            console.log("%c   PEER ID\t\t %c" + peerId, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   DEVICE ID\t\t %c" + deviceId, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   IS SOCKET OPEN\t %c" + isSocketOpen, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   DEVICE REGISTER\t %c" + isDeviceRegister, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   SERVER REGISTER\t %c" + isServerRegister, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   SOCKET STATE\t\t %c" + socketState, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   CURRENT MESSAGE\t %c" + type, 'color: #444', 'color: #aa386d; font-weight: bold');
            console.log("\n");

            Object.keys(msg).forEach(function(key) {
              if (typeof msg[key] === 'object') {
                console.log("%c \t-" + key, 'color: #777');
                Object.keys(msg[key]).forEach(function(k) {
                  console.log("%c \t  •" + k + " : %c" + msg[key][k], 'color: #777', 'color: #f23; font-weight: bold');
                });
              } else {
                console.log("%c \t•" + key + " : %c" + msg[key], 'color: #777', 'color: #f23; font-weight: bold');
              }
            });

            console.log("\n");

            if (pushSendDataQueue.length > 0) {
              console.log("%c   SEND QUEUE", 'color: #444');
              console.log("\n");
              Object.keys(pushSendDataQueue).forEach(function(key) {
                if (typeof pushSendDataQueue[key] === 'object') {
                  console.log("%c \t-" + key, 'color: #777');
                  Object.keys(pushSendDataQueue[key]).forEach(function(k) {
                    console.log("%c \t  •" + k + " : %c" + JSON.stringify(pushSendDataQueue[key][k]), 'color: #777', 'color: #999; font-weight: bold');
                  });
                } else {
                  console.log("%c \t•" + key + " : %c" + pushSendDataQueue[key], 'color: #777', 'color: #999; font-weight: bold');
                }
              });

            } else {
              console.log("%c   SEND QUEUE\t\t %cEmpty", 'color: #444', 'color: #000; font-weight: bold');
            }

            console.log("\n");
            console.log("%c ", 'font-weight: bold; font-size: 3px; border-left: solid 540px ' + ColorCSS + ';');
            console.log("\n");
          }
          break;

        case "queue":
          if (typeof global !== "undefined" && ({}).toString.call(global) === '[object global]') {
            console.log("\n");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\x1b[" + BgColor + "m\x1b[8m##################\x1b[0m\x1b[37m\x1b[" + BgColor + "m Q U E U E      S T A T U S \x1b[0m\x1b[" + BgColor + "m\x1b[8m##################\x1b[0m");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t\t\t\t\t\t\t      \x1b[" + BgColor + "m\x1b[8m##\x1b[0m");

            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m", " QUEUE STATE\t\t", socketState);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[" + FgColor + "m%s\x1b[0m ", " CURRENT MESSAGE\t", type);
            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");

            Object.keys(msg).forEach(function(key) {
              if (typeof msg[key] === 'object') {
                console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m-\x1b[0m \x1b[35m%s\x1b[0m", key);
                Object.keys(msg[key]).forEach(function(k) {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t   \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", k, msg[key][k]);
                });
              } else {
                console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", key, msg[key]);
              }
            });

            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");

            if (pushSendDataQueue.length > 0) {
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m", " SEND QUEUE");
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m");
              Object.keys(pushSendDataQueue).forEach(function(key) {
                if (typeof pushSendDataQueue[key] === 'object') {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m-\x1b[0m \x1b[35m%s\x1b[0m", key);
                  Object.keys(pushSendDataQueue[key]).forEach(function(k) {
                    console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t   \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[36m%s\x1b[0m", k, JSON.stringify(pushSendDataQueue[key][k]));
                  });
                } else {
                  console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t \x1b[1m•\x1b[0m \x1b[35m%s\x1b[0m : \x1b[33m%s\x1b[0m", key, pushSendDataQueue[key]);
                }
              });

            } else {
              console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \x1b[2m%s\x1b[0m \x1b[1m%s\x1b[0m ", " SEND QUEUE\t\t", "Empty");
            }

            console.log("\x1b[" + BgColor + "m\x1b[8m##\x1b[0m \t\t\t\t\t\t\t      \x1b[" + BgColor + "m\x1b[8m##\x1b[0m");
            console.log("\x1b[" + BgColor + "m\x1b[8m%s\x1b[0m", "################################################################");
            console.log("\n");
          } else {
            console.log("\n");
            console.log("%cQ U E U E      S T A T U S", 'background: ' + ColorCSS + '; padding: 10px 142px; font-weight: bold; font-size: 18px; color: #fff;');
            console.log("\n");
            console.log("%c   QUEUE STATE\t\t %c" + socketState, 'color: #444', 'color: #ffac28; font-weight: bold');
            console.log("%c   CURRENT MESSAGE\t %c" + type, 'color: #444', 'color: #aa386d; font-weight: bold');
            console.log("\n");

            Object.keys(msg).forEach(function(key) {
              if (typeof msg[key] === 'object') {
                console.log("%c \t-" + key, 'color: #777');
                Object.keys(msg[key]).forEach(function(k) {
                  console.log("%c \t  •" + k + " : %c" + msg[key][k], 'color: #777', 'color: #f23; font-weight: bold');
                });
              } else {
                console.log("%c \t•" + key + " : %c" + msg[key], 'color: #777', 'color: #f23; font-weight: bold');
              }
            });

            console.log("\n");

            if (pushSendDataQueue.length > 0) {
              console.log("%c   SEND QUEUE", 'color: #444');
              console.log("\n");
              Object.keys(pushSendDataQueue).forEach(function(key) {
                if (typeof pushSendDataQueue[key] === 'object') {
                  console.log("%c \t-" + key, 'color: #777');
                  Object.keys(pushSendDataQueue[key]).forEach(function(k) {
                    console.log("%c \t  •" + k + " : %c" + JSON.stringify(pushSendDataQueue[key][k]), 'color: #777', 'color: #999; font-weight: bold');
                  });
                } else {
                  console.log("%c \t•" + key + " : %c" + pushSendDataQueue[key], 'color: #777', 'color: #999; font-weight: bold');
                }
              });

            } else {
              console.log("%c   SEND QUEUE\t\t %cEmpty", 'color: #444', 'color: #000; font-weight: bold');
            }

            console.log("\n");
            console.log("%c ", 'font-weight: bold; font-size: 3px; border-left: solid 540px ' + ColorCSS + ';');
            console.log("\n");
          }
          break;
      }
    }

    /**
     * Prints Custom Message in console
     * @param {string} message Message to be logged in terminal
     * @return
     */
    this.asyncStepLogger = function(message) {
      if (typeof navigator == "undefined") {
        console.log("\x1b[90m    ☰ \x1b[0m\x1b[90m%s\x1b[0m", message);
      } else {
        console.log("%c   " + message, 'border-left: solid #666 10px; color: #666;');
      }
    }
  }

  if (typeof module !== 'undefined' && typeof module.exports != "undefined") {
    module.exports = Utility;
  } else {
    if (!window.POD) {
      window.POD = {};
    }
    window.POD.AsyncUtility = Utility;
  }
})();

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}]},{},[1]);
