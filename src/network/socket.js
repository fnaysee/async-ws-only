
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
      socket,
      waitForSocketToConnectTimeoutId,
      socketRealTimeStatusInterval,
      logLevel = params.logLevel,
      pingController = new PingManager({waitTime: connectionCheckTimeout}),
      socketWatchTimeout,
      isDestroyed = false,
      closeCodes = {
          PING_FAILED: {
            code: 4900,
            reason: "Ping with server failed"
          },
          REQUEST_FROM_ASYNC_CLASS: {
            code: 4901,
            reason: "Close by sdk"
          },
        CONNECTION_OPEN_TIMEOUT: {
          code: 4902,
          reason: "Connection didn't open after a long time"
        },

      },
      msgLogCallback = params.msgLogCallback,
      onOpen = params.onOpen,
      onClose = params.onClose,
      onMessage = params.onMessage,
      onCustomError = params.onCustomError,
      onError = params.onError;


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
        //fourth: null
      }
    }

    return {
      resetPingLoop() {
        this.stopPingLoop();
        this.setPingTimeout();
      },
      setPingTimeout() {
        config.timeoutIds.first = setTimeout(()=>{
          ping();
          config.timeoutIds.second = setTimeout(()=>{
            ping();
            config.timeoutIds.third = setTimeout(()=>{
              logLevel.debug && console.debug("[Async][Socket.js] Force closing socket.");
              onCloseHandler(null);
              // socket && socket.close();
              closeTheSocket(closeCodes.PING_FAILED);
            }, 2000);
          }, 2000);
        }, 8000);
      },
      stopPingLoop(){
        clearTimeout(config.timeoutIds.first);
        clearTimeout(config.timeoutIds.second);
        clearTimeout(config.timeoutIds.third);
        // clearTimeout(config.timeoutIds.fourth);
      },
    }
  }

  /*******************************************************
   *            P R I V A T E   M E T H O D S            *
   *******************************************************/

  var connect = function() {
        try {
          if (socket && socket.readyState == 1) {
            return;
          }

          socket = new WebSocket(address, []);

          /**
           * Watches the socket to make sure it's state changes to 1 in 5 seconds
           */
          socketWatchTimeout && clearTimeout(socketWatchTimeout);
          socketWatchTimeout = setTimeout(() => {
            // if(socket.readyState !== 1) {
            logLevel.debug && console.debug("[Async][Socket.js] socketWatchTimeout triggered.");
            onCloseHandler(null);
            // socket && socket.close();
            closeTheSocket(closeCodes.CONNECTION_OPEN_TIMEOUT);
            // }
          }, 5000);

          socket.onopen = function(event) {
            if(onOpen) {
              waitForSocketToConnect(function () {
                pingController.resetPingLoop();
                onOpen();
                socketWatchTimeout && clearTimeout(socketWatchTimeout);
              });
            } else {
              onCloseHandler();
              closeTheSocket();

            }
          }

          socket.onmessage = function(event) {
            msgLogCallback({
              msg: event.data,
              direction: "receive",
              time: new Date().getTime()
            });
            if(onMessage) {
              pingController.resetPingLoop();

              var messageData = JSON.parse(event.data);
              onMessage(messageData);
            } else {
              onCloseHandler();
              closeTheSocket();

            }
          }

          socket.onclose = function(event) {
            pingController.stopPingLoop();
            logLevel.debug && console.debug("[Async][Socket.js] socket.onclose happened. EventData:", event);
            onCloseHandler(event);
            closeTheSocket();
            socketWatchTimeout && clearTimeout(socketWatchTimeout);
          }

          socket.onerror = function(event) {
            logLevel.debug && console.debug("[Async][Socket.js] socket.onerror happened. EventData:", event);
            if(onError){
              onError(event);
              onCloseHandler();
              closeTheSocket();
              socketWatchTimeout && clearTimeout(socketWatchTimeout);
            }
          }
        } catch (error) {
          onCustomError({
            errorCode: 4000,
            errorMessage: "ERROR in WEBSOCKET!",
            errorEvent: error
          });
        }
      },

      onCloseHandler = function(event) {
        pingController.stopPingLoop();
        if(socket) {
          socket.onclose = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onopen = null;
          socket = null;
        }
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

          if (socket.readyState === 1) {
            let stringData = JSON.stringify(data);
            msgLogCallback({
              msg: stringData,
              direction: "send",
              time: new Date().getTime()
            });
            socket.send(stringData);
          }
        } catch (error) {
          onCustomError({
            errorCode: 4004,
            errorMessage: "Error in Socket sendData!",
            errorEvent: error
          });
        }
      };

  /*******************************************************
   *             P U B L I C   M E T H O D S             *
   *******************************************************/
  const publicized = {};
  publicized.emit = sendData;

  publicized.connect = function() {
    connect();
  }

  publicized.close = function() {
    logLevel.debug && console.debug("[Async][Socket.js] Closing socket by call to this.close");
    // socket && socket.close();
    onCloseHandler(null);
    closeTheSocket(closeCodes.REQUEST_FROM_ASYNC_CLASS);
    socketWatchTimeout && clearTimeout(socketWatchTimeout);
  }

  publicized.destroy = function (){
    isDestroyed = true;
    publicized.close();
    onClose = null;
    onOpen = null;
    onMessage = null;
    onCustomError = null;
  }

  function closeTheSocket(reason) {
    if(socket) {
      function socketCloseErrorHandler(err) {
        console.error('Socket Close Error: ', err);
      }

      socket.on('error', socketCloseErrorHandler);
      setTimeout(()=> {
        if(socket) {
          if(reason)
            socket.close(reason.code, reason.reason);
          else
            socket.close();

          socket.off("error", socketCloseErrorHandler)
        }
      }, 20);
    }

    if(!isDestroyed && onClose){
      onClose();
    }
  }

  return publicized;
}

module.exports = Socket;
export {Socket}