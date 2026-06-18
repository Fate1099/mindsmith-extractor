(function () {
  function tryCapture(text) {
    try {
      var data = JSON.parse(text);
      var entry = Array.isArray(data) ? data[0] : data;
      var json =
        (entry && entry.result && entry.result.data && entry.result.data.json) ||
        (entry && entry.result && entry.result.data) ||
        (entry && entry.data) ||
        entry;
      if (json && json.lesson) {
        window.postMessage({ source: "MS_EXTRACTOR", payload: json }, "*");
      }
    } catch (e) {}
  }

  function isLessonUrl(u) {
    u = (u || "").toLowerCase();
    return u.indexOf("/api/trpc/") !== -1 && u.indexOf("lesson") !== -1;
  }

  // Patch fetch (main world)
  var origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    return origFetch.apply(this, args).then(function (res) {
      try {
        var url = (typeof args[0] === "string") ? args[0] : (args[0] && args[0].url) || "";
        if (isLessonUrl(url)) res.clone().text().then(tryCapture).catch(function () {});
      } catch (e) {}
      return res;
    });
  };

  // Patch XHR too (some tRPC clients use it)
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__msUrl = url || "";
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    this.addEventListener("load", function () {
      try { if (isLessonUrl(xhr.__msUrl)) tryCapture(xhr.responseText); } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
