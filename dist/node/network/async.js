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

    var PodSocketClass, WebRTCClass, PodUtility, LogLevel;
    if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
      PodSocketClass = require('./socket.js');
      WebRTCClass = require('./webrtc.js');
      PodUtility = require('../utility/utility.js');
      LogLevel = require('../utility/logger.js');
    } else {
      PodSocketClass = POD.Socket;
      PodUtility = POD.AsyncUtility;
      LogLevel = POD.LogLevel;
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
      webRTCClass,
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
        CONNECTING: 0,
        // The connection is not yet open.
        OPEN: 1,
        // The connection is open and ready to communicate.
        CLOSING: 2,
        // The connection is in the process of closing.
        CLOSED: 3 // The connection is closed or couldn't be opened.
      },
      logLevel = LogLevel(params.logLevel),
      // isNode = Utility.isNode(),
      isSocketOpen = false,
      isDeviceRegister = false,
      isServerRegister = false,
      socketState = socketStateType.CONNECTING,
      // asyncState = '',
      registerServerTimeoutId,
      registerDeviceTimeoutId,
      checkIfSocketHasOpennedTimeoutId,
      // asyncReadyTimeoutId,
      pushSendDataQueue = [],
      oldPeerId,
      peerId = params.peerId,
      lastMessageId = 0,
      messageTtl = params.messageTtl || 86400,
      serverName = params.serverName || 'oauth-wire',
      serverRegisteration = typeof params.serverRegisteration === 'boolean' ? params.serverRegisteration : true,
      connectionRetryInterval = params.connectionRetryInterval || 5000,
      socketReconnectRetryInterval,
      socketReconnectCheck,
      // retryStep = 4,
      reconnectOnClose = typeof params.reconnectOnClose === 'boolean' ? params.reconnectOnClose : true,
      asyncLogging = params.asyncLogging && typeof params.asyncLogging.onFunction === 'boolean' ? params.asyncLogging.onFunction : false,
      onReceiveLogging = params.asyncLogging && typeof params.asyncLogging.onMessageReceive === 'boolean' ? params.asyncLogging.onMessageReceive : false,
      onSendLogging = params.asyncLogging && typeof params.asyncLogging.onMessageSend === 'boolean' ? params.asyncLogging.onMessageSend : false,
      workerId = params.asyncLogging && typeof parseInt(params.asyncLogging.workerId) === 'number' ? params.asyncLogging.workerId : 0,
      webrtcConfig = params.webrtcConfig ? params.webrtcConfig : null;

    // function setRetryStep(val){
    //     console.log("new retryStep value:", val);
    //     retryStep = val;
    // }
    //
    // function getRetryStep() {
    //     return retryStep;
    // }

    const reconnOnClose = {
      value: 4,
      oldValue: 4,
      get() {
        return reconnOnClose.value;
      },
      set(val) {
        reconnOnClose.value = val;
      },
      getOld() {
        return reconnOnClose.oldValue;
      },
      setOld(val) {
        reconnOnClose.oldValue = val;
      }
    };
    reconnOnClose.set(reconnectOnClose);
    const retryStep = {
      value: 4,
      get() {
        return retryStep.value;
      },
      set(val) {
        logLevel.debug && console.debug("[Async][async.js] retryStep new value:", val);
        retryStep.value = val;
      }
    };

    /*******************************************************
     *            P R I V A T E   M E T H O D S            *
     *******************************************************/

    var init = function () {
        switch (protocol) {
          case 'websocket':
            initSocket();
            break;
          case 'webrtc':
            initWebrtc();
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
          connectionCheckTimeoutThreshold: params.connectionCheckTimeoutThreshold,
          logLevel: logLevel
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
          retryStep.set(4);
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
          console.log("on.close", reconnOnClose.get(), reconnOnClose.getOld());
          isSocketOpen = false;
          isDeviceRegister = false;
          oldPeerId = peerId;

          // socketState = socketStateType.CLOSED;
          //
          // fireEvent('stateChange', {
          //     socketState: socketState,
          //     timeUntilReconnect: 0,
          //     deviceRegister: isDeviceRegister,
          //     serverRegister: isServerRegister,
          //     peerId: peerId
          // });

          fireEvent('disconnect', event);
          if (reconnOnClose.get() || reconnOnClose.getOld()) {
            // reconnOnClose.set(reconnOnClose.getOld());
            if (asyncLogging) {
              if (workerId > 0) {
                Utility.asyncStepLogger(workerId + '\t Reconnecting after ' + retryStep.get() + 's');
              } else {
                Utility.asyncStepLogger('Reconnecting after ' + retryStep.get() + 's');
              }
            }
            logLevel.debug && console.debug("[Async][async.js] on socket close, retryStep:", retryStep.get());
            socketState = socketStateType.CLOSED;
            fireEvent('stateChange', {
              socketState: socketState,
              timeUntilReconnect: 1000 * retryStep.get(),
              deviceRegister: isDeviceRegister,
              serverRegister: isServerRegister,
              peerId: peerId
            });
            socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
            socketReconnectRetryInterval = setTimeout(function () {
              socket.connect();
            }, 1000 * retryStep.get());
            if (retryStep.get() < 64) {
              // retryStep += 3;
              retryStep.set(retryStep.get() + 3);
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
          } else {
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
      initWebrtc = function () {
        webRTCClass = new WebRTCClass({
          baseUrl: webrtcConfig ? webrtcConfig.baseUrl : null,
          configuration: webrtcConfig ? webrtcConfig.configuration : null,
          connectionCheckTimeout: params.connectionCheckTimeout,
          logLevel: logLevel
        });
        checkIfSocketHasOpennedTimeoutId = setTimeout(function () {
          if (!isSocketOpen) {
            fireEvent('error', {
              errorCode: 4001,
              errorMessage: 'Can not open Socket!'
            });
          }
        }, 65000);
        webRTCClass.on('open', function () {
          checkIfSocketHasOpennedTimeoutId && clearTimeout(checkIfSocketHasOpennedTimeoutId);
          socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
          socketReconnectCheck && clearTimeout(socketReconnectCheck);
          isSocketOpen = true;
          retryStep.set(4);
          socketState = socketStateType.OPEN;
          fireEvent('stateChange', {
            socketState: socketState,
            timeUntilReconnect: 0,
            deviceRegister: isDeviceRegister,
            serverRegister: isServerRegister,
            peerId: peerId
          });
        });
        webRTCClass.on('message', function (msg) {
          console.log({
            msg
          });
          handleSocketMessage(msg);
          if (onReceiveLogging) {
            asyncLogger('Receive', msg);
          }
        });
        webRTCClass.on('close', function (event) {
          isSocketOpen = false;
          isDeviceRegister = false;
          oldPeerId = peerId;
          fireEvent('disconnect', event);
          if (reconnOnClose.get()) {
            if (asyncLogging) {
              if (workerId > 0) {
                Utility.asyncStepLogger(workerId + '\t Reconnecting after ' + retryStep.get() + 's');
              } else {
                Utility.asyncStepLogger('Reconnecting after ' + retryStep.get() + 's');
              }
            }
            logLevel.debug && console.debug("[Async][async.js] on connection close, retryStep:", retryStep.get());
            socketState = socketStateType.CLOSED;
            fireEvent('stateChange', {
              socketState: socketState,
              timeUntilReconnect: 1000 * retryStep.get(),
              deviceRegister: isDeviceRegister,
              serverRegister: isServerRegister,
              peerId: peerId
            });
            socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
            socketReconnectRetryInterval = setTimeout(function () {
              webRTCClass.connect();
            }, 1000 * retryStep.get());
            if (retryStep.get() < 64) {
              // retryStep += 3;
              retryStep.set(retryStep.get() + 3);
            }
          } else {
            socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
            socketReconnectCheck && clearTimeout(socketReconnectCheck);
            fireEvent('error', {
              errorCode: 4005,
              errorMessage: 'Connection Closed!'
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
        webRTCClass.on('customError', function (error) {
          fireEvent('error', {
            errorCode: error.errorCode,
            errorMessage: error.errorMessage,
            errorEvent: error.errorEvent
          });
        });
        webRTCClass.on('error', function (error) {
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
          } else {
            registerDevice();
          }
        } else {
          if (onReceiveLogging) {
            if (workerId > 0) {
              Utility.asyncStepLogger(workerId + '\t Ping Response at (' + new Date() + ')');
            } else {
              Utility.asyncStepLogger('Ping Response at (' + new Date() + ')');
            }
          }
        }
      },
      registerDevice = function (isRetry) {
        if (asyncLogging) {
          if (workerId > 0) {
            Utility.asyncStepLogger(workerId + '\t Registering Device');
          } else {
            Utility.asyncStepLogger('Registering Device');
          }
        }
        var content = {
          appId: appId,
          deviceId: deviceId
        };
        if (peerId !== undefined) {
          content.refresh = true;
          content.renew = false;
        } else {
          content.renew = true;
          content.refresh = false;
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
          } else {
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
        } else {
          fireEvent('asyncReady');
          isServerRegister = 'Not Needed';
          pushSendDataQueueHandler();
          if (asyncLogging) {
            if (workerId > 0) {
              Utility.asyncStepLogger(workerId + '\t Async is Ready');
            } else {
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
          } else {
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
            } else {
              Utility.asyncStepLogger('Async is Ready');
            }
          }
        } else {
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
            } else {
              pushSendDataQueue.push(msg);
            }
            break;
          case 'webrtc':
            if (socketState === socketStateType.OPEN) {
              webRTCClass.emit(msg);
            } else {
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
        // try {
        if (ack) {
          for (var id in eventCallbacks[eventName]) {
            eventCallbacks[eventName][id](param, ack);
          }
        } else {
          for (var id in eventCallbacks[eventName]) {
            eventCallbacks[eventName][id](param);
          }
        }
        // }
        // catch (e) {
        //     fireEvent('error', {
        //         errorCode: 999,
        //         errorMessage: 'Unknown ERROR!',
        //         errorEvent: e
        //     });
        // }
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
      var messageType = typeof params.type === 'number' ? params.type : callback ? asyncMessageType.MESSAGE_SENDER_ACK_NEEDED : asyncMessageType.MESSAGE;
      var socketData = {
        type: messageType,
        uniqueId: params.uniqueId ? params.uniqueId : undefined,
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
        case 'webrtc':
          socketState = socketStateType.CLOSED;
          fireEvent('stateChange', {
            socketState: socketState,
            timeUntilReconnect: 0,
            deviceRegister: isDeviceRegister,
            serverRegister: isServerRegister,
            peerId: peerId
          });
          socketReconnectRetryInterval && clearTimeout(socketReconnectRetryInterval);
          webRTCClass.close();
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
          reconnOnClose.set(false);
          // reconnectOnClose = false;

          socket.close();
          break;
        case 'webrtc':
          socketState = socketStateType.CLOSED;
          fireEvent('stateChange', {
            socketState: socketState,
            timeUntilReconnect: 0,
            deviceRegister: isDeviceRegister,
            serverRegister: isServerRegister,
            peerId: peerId
          });
          reconnOnClose.set(false);
          // reconnectOnClose = false;
          webRTCClass.close();
          break;
      }
    };
    let reconnectSocketTimeout;
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
      if (protocol === "websocket") socket.close();else if (protocol == "webrtc") webRTCClass.close();

      // let tmpReconnectOnClose = reconnectOnClose;
      // reconnectOnClose = false;
      reconnOnClose.setOld(reconnOnClose.get());
      reconnOnClose.set(false);
      retryStep.set(0);
      if (protocol === "websocket") socket.connect();else if (protocol == "webrtc") webRTCClass.connect();
      reconnectSocketTimeout && clearTimeout(reconnectSocketTimeout);
      reconnectSocketTimeout = setTimeout(function () {
        // retryStep = 4;
        retryStep.set(0);
        // reconnectOnClose = tmpReconnectOnClose;
        reconnOnClose.set(reconnOnClose.getOld());
        if (socketState != socketStateType.OPEN) {
          if (protocol === "websocket") socket.connect();else if (protocol == "webrtc") webRTCClass.connect();
        }

        // if(protocol === "websocket")
        //     socket.connect();
        // else if(protocol == "webrtc")
        //     webRTCClass.connect()
      }, 4000);
    };
    this.generateUUID = Utility.generateUUID;
    init();
  }
  if (typeof module !== 'undefined' && typeof module.exports != 'undefined') {
    module.exports = Async;
  } else {
    if (!window.POD) {
      window.POD = {};
    }
    window.POD.Async = Async;
  }
})();