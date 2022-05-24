## Synopsis

**Fanap's POD** Async service (DIRANA) - Websocket Only

## Code Example

First you have to require PodAsync in your project.

```javascript
var Async = require('podasync-ws-only');
```

To be able to connect to async server, you should set some parameters. `Websockets`protocol is currently supported.

### Websocket protocol parameters

```javascript
var params = {
  socketAddress: "ws://chat-sandbox.pod.land/ws",
  serverName: "chat-server",
  reconnectOnClose: true,
  connectionCheckTimeout: 10000,
  asyncLogging: {
    onFunction: true,
    onMessageReceive: true,
    onMessageSend: true
  }
};
```

After setting parameters you can make a new connection to Async server.

```javascript
var asyncClient = new Async(params);
```

### Async Ready Event

After making a new connection, you should wait for asyncReady event to fire so you could be sure that the connection has been estabilished and you are ready to go

```javascript
asyncClient.on("asyncReady", function() {
  /**
  * Write your code inside asyncReady() function
  */
});
```

### Receive messages

In order to receive messages from Async server, you could listen to `message` event.

```javascript
/**
* Listening to responses came from DIRANA
*/
asyncClient.on("message", function(message, ack) {
  console.log(message);
});
```

### Send message

To send a new message to Async server you can use `send()` function.

```javascript
/**
* A Custom Message To be Send Through DIRANA
*/
var customMessage = {
  type: 3,
  content: {
    receivers: ["receiver1", "receiver2", "..."],
    content: "Hello Buddy!"
  }
};

/**
* Sending Message
*/
asyncClient.send(customMessage);
```

## Motivation

This module helps you to easily connect POD chat service.

## Installation

```javascript
npm install podasync --save
```

## API Reference

[API Docs from POD](http://www.fanapium.com)

## Tests

```javascript
npm test
```

## Contributors

You can send me your thoughts about making this repo great :)
[Email](masoudmanson@gmail.com)

## License

Under MIT License.
