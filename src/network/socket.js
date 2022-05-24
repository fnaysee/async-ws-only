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
      socketRealTimeStatusInterval,
      //sendPingTimeout,
      socketCloseTimeout,
      forceCloseTimeout,
      logLevel = params.logLevel,
      pingController = new PingManager({waitTime: connectionCheckTimeout});


    function PingManager(params) {
      const config = {
        normalWaitTime: params.waitTime,

        lastRequestTimeoutId: null,
        lastReceivedMessageTime: 0,
      }

      return {
        setPingTimeout() {
          config.lastRequestTimeoutId = setInterval(()=>{
            ping();
            //this.watchForPingResponse();
          }, config.normalWaitTime)
        },
        resetPingLoop() {
          this.updateLastReceivedMessageTime();
          this.stopPingLoop();
          this.setPingTimeout();
          // this.retries = 0;
        },
        stopPingLoop(){
          // config.retries = 0;
          clearInterval(config.lastRequestTimeoutId);
          // clearTimeout(config.responseTimeoutId)
        },
        updateLastReceivedMessageTime() {
          config.lastReceivedMessageTime = new Date().getTime();
        },
      }
    }

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
              pingController.resetPingLoop();
              eventCallback["open"]();
            });
          }

          socket.onmessage = function(event) {
            pingController.resetPingLoop();

            var messageData = JSON.parse(event.data);
            eventCallback["message"](messageData);
          }

          socket.onclose = function(event) {
            pingController.stopPingLoop();
            logLevel.debug && console.debug("[Async][Socket.js] socket.onclose happened. EventData:", event);
            onCloseHandler(event);
          }

          socket.onerror = function(event) {
            logLevel.debug && console.debug("[Async][Socket.js] socket.onerror happened. EventData:", event);
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
        pingController.stopPingLoop();
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
      logLevel.debug && console.debug("[Async][Socket.js] Closing socket by call to this.close");
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
