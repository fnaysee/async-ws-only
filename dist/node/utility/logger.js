"use strict";

function LogLevel(logLevel) {
  var ll = logLevel || 2;
  switch (ll) {
    case 1:
      return {
        error: true,
        debug: false,
        info: false
      };
    case 2:
      return {
        error: true,
        debug: true,
        info: false
      };
    case 3:
      return {
        error: true,
        debug: true,
        info: true
      };
  }
}
if (typeof module !== 'undefined' && typeof module.exports != 'undefined') {
  module.exports = LogLevel;
} else {
  if (!window.POD) {
    window.POD = {};
  }
  window.POD.LogLevel = LogLevel;
}