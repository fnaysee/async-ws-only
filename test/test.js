var assert = require('assert');
var WebSocket = require('ws');
var PODSocket = require('../src/network/socket.js');
var Async = require('../src/network/async.js');

var DEVICE_IDS = {
  DEVICEID_1: "208bf7f8671eef0759bca69621835e3b", // Zamani
  DEVICEID_2: "3d943476a879dcf609f79a5ec736bedc", // Barzegar
  DEVICEID_3: "cbebc89039c39036045984eabd79ca27" // Felfeli
}

var params = {
  socketAddress: "ws://172.16.106.26:8003/ws",
  serverName: "chat-server",
  deviceId: DEVICE_IDS.DEVICEID_1,
  reconnectOnClose: false,
  consoleLogging: {
    // onFunction: true,
    // onMessageReceive: true,
    // onMessageSend: true
  }
};

var params2 = Object.assign({}, params);
var params3 = Object.assign({}, params);

params2.deviceId = DEVICE_IDS.DEVICEID_2;
params3.deviceId = DEVICE_IDS.DEVICEID_3;

/**
* Websocket Protocol
*/
describe('Web Socket Protocol', function() {
  var client;

  beforeEach(() => {
    client = new WebSocket(params.socketAddress, []);
  });

  afterEach(() => {
    client.close();
  });

  it("Should Connect to " + params.socketAddress, function(done) {
    client.on("open", function() {
      assert.equal(client.readyState, 1);
      done();
    });
  });

  it("Should Receive Messages", function(done) {
    client.on("message", function(msg) {
      done();
    });
  });

  it("Should Send Empty Message ({type:0, content:\"\"})", function(done) {
    let data = {
      type: 0
    };

    client.on("open", function() {
      try {
        client.send(JSON.stringify(data));
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it("Should Close Socket Connection", function(done) {

    client.on("open", function() {
      client.close();
    });

    client.on("close", function() {
      done();
    });
  });
});

/**
* POD Socket Class
*/
describe("POD Socket Class", function() {
  var socket;

  beforeEach(() => {
    socket = new PODSocket(params);
    socket.on("open", function() {});
    socket.on("message", function() {});
    socket.on("error", function() {});
    socket.on("close", function() {});
  });

  afterEach(() => {
    socket.close();
  });

  it("Should Connect to WebSocket Through POD Socket Class", function(done) {
    socket.on("open", function() {
      done();
    });
  });

  it("Should Receive Messages Through POD Socket Class", function(done) {
    socket.on("message", function(msg) {
      done();
    });
  });

  it("Should Send Empty Message ({type:0, content:\"\"}) Through POD Socket Class", function(done) {
    socket.on("open", function() {
      try {
        socket.emit({type: 0, content: ""});
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it("Should Close Socket Connection", function(done) {
    socket.on("open", function() {
      socket.close();
    });

    socket.on("close", function() {
      done();
    });
  });
});

/**
* POD Async Class Connecting
*/
describe("POD Async Class Connecting", function() {
  this.timeout(5000);

  var asyncClient1,
    asyncClient2,
    peerId;

  beforeEach(() => {
    asyncClient1 = new Async(params);
    asyncClient2 = new Async(params2);
  });

  afterEach(() => {
    asyncClient1.logout();
    asyncClient2.logout();
  });

  it("Should Connect to Async and Get Ready", function(done) {
    asyncClient1.on("asyncReady", function() {
      done();
    });
  });

  it("Should Connect to Async and Get Client's PeerID", function(done) {
    asyncClient2.on("asyncReady", function() {
      peerId = asyncClient2.getPeerId();
      if (peerId) {
        done();
      }
    });
  });
});

/**
* POD Async Sending & Receiving Type 3
*/
describe("POD Async Sending & Receiving Type 3", function() {
  this.timeout(5000);

  var asyncClient1,
    asyncClient2,
    peerId1,
    peerId2;

  beforeEach(() => {
    asyncClient1 = new Async(params);
    asyncClient2 = new Async(params2);
  });

  afterEach(() => {
    asyncClient1.logout();
    asyncClient2.logout();
  });

  it("Should be Able to Send Type 3 Message from Client1 to Client2", function(done) {
    var msg = "";
    asyncClient1.on("asyncReady", function recursive() {
      peerId1 = asyncClient1.getPeerId();
      if (msg.type !== undefined) {
        asyncClient1.send(msg);
      } else {
        setTimeout(function() {
          recursive();
        }, 10);
      }
    });

    asyncClient2.on("asyncReady", function() {
      peerId2 = asyncClient2.getPeerId();

      msg = {
        type: 3,
        content: {
          receivers: [peerId2],
          content: "Hello"
        }
      };
    });

    asyncClient2.on("message", function(msg, ack) {
      if (msg.senderId == peerId1) {
        done();
      }
    });
  });

  it("Should be Able to Send Type 3 Message from Client2 to Client1", function(done) {
    var msg = "";
    asyncClient2.on("asyncReady", function recursive() {
      peerId2 = asyncClient2.getPeerId();
      if (msg.type !== undefined) {
        asyncClient2.send(msg);
      } else {
        setTimeout(function() {
          recursive();
        }, 10);
      }
    });

    asyncClient1.on("asyncReady", function() {
      peerId1 = asyncClient1.getPeerId();

      msg = {
        type: 3,
        content: {
          receivers: [peerId1],
          content: "Hello"
        }
      };
    });

    asyncClient1.on("message", function(msg, ack) {
      if (msg.senderId == peerId2) {
        done();
      }
    });
  });
});

/**
* POD Async Sending & Receiving Type 5
*/
describe("POD Async Sending & Receiving Type 5 (SENDER ACK NEEDED)", function() {
  this.timeout(50000);

  var asyncClient1,
    asyncClient2,
    peerId1,
    peerId2;

  beforeEach(() => {
    asyncClient1 = new Async(params);
    asyncClient2 = new Async(params2);
  });

  afterEach(() => {
    asyncClient1.logout();
    asyncClient2.logout();
  });

  it("Should be Able to Send Type 5 Message from Client1 to Client2 and Receive ACK", function(done) {
    var msg = "";
    asyncClient1.on("asyncReady", function recursive() {
      peerId1 = asyncClient1.getPeerId();
      if (msg.type !== undefined) {
        asyncClient1.send(msg);
      } else {
        setTimeout(function() {
          recursive();
        }, 10);
      }
    });

    asyncClient2.on("asyncReady", function() {
      peerId2 = asyncClient2.getPeerId();

      msg = {
        type: 5,
        content: {
          receivers: [peerId2],
          content: "Hello"
        }
      };
    });

    asyncClient2.on("message", function(msg) {
    });

    asyncClient1.on("message", function(msg) {
      if (msg.senderId == peerId2) {
        done();
      }
    });
  });
});

/**
* POD Async Sending & Receiving Type 5
*/
describe("POD Async Sending & Receiving Type 5 (SENDER ACK NEEDED) And Invoking Callback Function", function() {
  this.timeout(5000);

  var asyncClient1,
    asyncClient2,
    peerId1,
    peerId2;

  beforeEach(() => {
    asyncClient1 = new Async(params);
    asyncClient2 = new Async(params2);
  });

  afterEach(() => {
    asyncClient1.logout();
    asyncClient2.logout();
  });

  it("Should be Able to Send Type 5 Message from Client1 to Client2 and Receive ACK", function(done) {
    var msg = "";
    asyncClient1.on("asyncReady", function recursive() {
      peerId1 = asyncClient1.getPeerId();
      if (msg.type !== undefined) {
        asyncClient1.send(msg, console.log("    ✴ \x1b[33m%s\x1b[0m", "ACK CallBack Function Invoked Successfully"));
      } else {
        setTimeout(function() {
          recursive();
        }, 10);
      }
    });

    asyncClient2.on("asyncReady", function() {
      peerId2 = asyncClient2.getPeerId();

      msg = {
        type: 5,
        content: {
          receivers: [peerId2],
          content: "Hello"
        }
      };
    });

    asyncClient2.on("message", function(msg, ack) {});

    asyncClient1.on("message", function(msg, ack) {
      if (msg.senderId == peerId2) {
        done();
      }
    });
  });
});
