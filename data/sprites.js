(function (root) {
  "use strict";

  const api = {};

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerSprites = Object.assign(root.BreakerSprites || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
