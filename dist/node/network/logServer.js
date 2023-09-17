"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.log = log;
var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));
var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));
function log(_x) {
  return _log.apply(this, arguments);
}
function _log() {
  _log = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee(errObject) {
    var formdata, formBody, encodedKey, encodedValue, requestOptions, error;
    return _regenerator["default"].wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          formdata = new FormData();
          console.log("logServer: ", errObject);
          formdata.append("error", JSON.stringify(errObject));
          // formdata.append("token", token);
          formBody = []; // for (var property in errObject) {
          //     var encodedKey = encodeURIComponent(property);
          //     var encodedValue = encodeURIComponent(errObject[property]);
          //     formBody.push(encodedKey + "=" + encodedValue);
          // }
          encodedKey = encodeURIComponent('sdkLog');
          encodedValue = encodeURIComponent(JSON.stringify(errObject));
          formBody.push(encodedKey + "=" + encodedValue);
          formBody = formBody.join("&");
          requestOptions = {
            method: 'POST',
            headers: {
              "Content-Type": 'application/x-www-form-urlencoded;charset=UTF-8'
              // "Authorization": "Basic " + btoa("async" + ":" + "JHaSD#df435ds73dd")
            },

            body: formBody
          };
          _context.next = 11;
          return fetch("https://talkotp-d.fanapsoft.ir/log/logSdk", requestOptions).then(function (response) {
            return response.text();
          }).then(function (result) {
            return console.log(result);
          })["catch"](function (error) {
            return console.log('logServer', error);
          });
        case 11:
          error = _context.sent;
          return _context.abrupt("return", error);
        case 13:
        case "end":
          return _context.stop();
      }
    }, _callee);
  }));
  return _log.apply(this, arguments);
}