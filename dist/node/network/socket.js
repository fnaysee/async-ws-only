"use strict";

(function () {
  /*
   * Socket Module to connect and handle Socket functionalities
   * @module Socket
   *
   * @param {Object} params
   */

  function Socket(params) {
    if (typeof WebSocket === "undefined" && typeof require !== "undefined" && typeof exports !== "undefined") {
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
      logLevel = params.logLevel,
      pingController = new PingManager({
        waitTime: connectionCheckTimeout
      }),
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
        }
      },
      msgLogCallback = params.msgLogCallback;
    function PingManager(params) {
      var config = {
        normalWaitTime: params.waitTime,
        lastRequestTimeoutId: null,
        lastReceivedMessageTime: 0,
        totalNoMessageCount: 0,
        timeoutIds: {
          first: null,
          second: null,
          third: null
          //fourth: null
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
                logLevel.debug && console.debug("[Async][Socket.js] Force closing socket.");
                onCloseHandler(null);
                // socket && socket.close();
                closeTheSocket(closeCodes.PING_FAILED);
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

    /*******************************************************
     *            P R I V A T E   M E T H O D S            *
     *******************************************************/

    var connect = function connect() {
        try {
          if (socket && socket.readyState == 1) {
            return;
          }
          socket = new WebSocket(address, []);

          // socketRealTimeStatusInterval && clearInterval(socketRealTimeStatusInterval);
          // socketRealTimeStatusInterval = setInterval(function() {
          //   switch (socket.readyState) {
          //     case 2:
          //       onCloseHandler(null);
          //       socketRealTimeStatusInterval && clearInterval(socketRealTimeStatusInterval);
          //       break;
          //     case 3:
          //
          //       break;
          //   }
          // }, 5000);

          /**
           * Watches the socket to make sure it's state changes to 1 in 5 seconds
           */
          socketWatchTimeout && clearTimeout(socketWatchTimeout);
          socketWatchTimeout = setTimeout(function () {
            // if(socket.readyState !== 1) {
            logLevel.debug && console.debug("[Async][Socket.js] socketWatchTimeout triggered.");
            onCloseHandler(null);
            // socket && socket.close();
            closeTheSocket(closeCodes.CONNECTION_OPEN_TIMEOUT);
            // }
          }, 5000);
          socket.onopen = function (event) {
            if (eventCallback["message"]) {
              waitForSocketToConnect(function () {
                pingController.resetPingLoop();
                eventCallback["open"]();
                socketWatchTimeout && clearTimeout(socketWatchTimeout);
              });
            } else {
              onCloseHandler();
              closeTheSocket();
            }
          };
          socket.onmessage = function (event) {
            msgLogCallback({
              msg: event.data,
              direction: "receive",
              time: new Date().getTime()
            });
            if (eventCallback["message"]) {
              pingController.resetPingLoop();
              var messageData = JSON.parse(event.data);
              eventCallback["message"](messageData);
            } else {
              onCloseHandler();
              closeTheSocket();
            }
          };
          socket.onclose = function (event) {
            pingController.stopPingLoop();
            logLevel.debug && console.debug("[Async][Socket.js] socket.onclose happened. EventData:", event);
            onCloseHandler(event);
            closeTheSocket();
            socketWatchTimeout && clearTimeout(socketWatchTimeout);
          };
          socket.onerror = function (event) {
            logLevel.debug && console.debug("[Async][Socket.js] socket.onerror happened. EventData:", event);
            if (eventCallback["error"]) {
              eventCallback["error"](event);
              onCloseHandler();
              closeTheSocket();
              socketWatchTimeout && clearTimeout(socketWatchTimeout);
            }
          };
        } catch (error) {
          eventCallback["customError"]({
            errorCode: 4000,
            errorMessage: "ERROR in WEBSOCKET!",
            errorEvent: error
          });
        }
      },
      onCloseHandler = function onCloseHandler(event) {
        pingController.stopPingLoop();
        if (socket) {
          socket.onclose = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onopen = null;
          socket = null;
        }
      },
      ping = function ping() {
        sendData({
          type: 0
        });
      },
      waitForSocketToConnect = function waitForSocketToConnect(callback) {
        waitForSocketToConnectTimeoutId && clearTimeout(waitForSocketToConnectTimeoutId);
        if (socket.readyState === 1) {
          callback();
        } else {
          waitForSocketToConnectTimeoutId = setTimeout(function () {
            if (socket.readyState === 1) {
              callback();
            } else {
              waitForSocketToConnect(callback);
            }
          }, wsConnectionWaitTime);
        }
      },
      sendData = function sendData(params) {
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
            var stringData = JSON.stringify(data);
            msgLogCallback({
              msg: stringData,
              direction: "send",
              time: new Date().getTime()
            });
            socket.send(stringData);
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

    this.on = function (messageName, callback) {
      eventCallback[messageName] = callback;
    };
    this.emit = sendData;
    this.connect = function () {
      connect();
    };
    this.close = function () {
      logLevel.debug && console.debug("[Async][Socket.js] Closing socket by call to this.close");
      // socket && socket.close();
      onCloseHandler(null);
      closeTheSocket(closeCodes.REQUEST_FROM_ASYNC_CLASS);
      socketWatchTimeout && clearTimeout(socketWatchTimeout);
    };
    this.destroy = function () {
      isDestroyed = true;
      for (var i in eventCallback) {
        eventCallback[i] = undefined;
      }
    };
    function closeTheSocket(reason) {
      if (socket) {
        var socketCloseErrorHandler = function socketCloseErrorHandler(err) {
          console.error('Socket Close Error: ', err);
        };
        socket.on('error', socketCloseErrorHandler);
        setTimeout(function () {
          if (socket) {
            if (reason) socket.close(reason.code, reason.reason);else socket.close();
            socket.off("error", socketCloseErrorHandler);
          }
        }, 20);
      }
      if (!isDestroyed && eventCallback["close"]) {
        eventCallback["close"]();
      }
    }
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