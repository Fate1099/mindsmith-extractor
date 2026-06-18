document.getElementById("btn").addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    // Send to ALL frames in the tab (Firefox broadcasts when frameId is omitted).
    // Whichever frame captured a lesson handles it; the rest ignore it.
    chrome.tabs.sendMessage(tabs[0].id, { type: "DOWNLOAD_MD" }, function () {
      void chrome.runtime.lastError; // swallow harmless "no receiver" noise
    });
    window.close();
  });
});
