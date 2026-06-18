// ---- 1. Inject page-world interceptor at document_start ----
(function () {
  try {
    var s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

var lessonData = null;

// ---- 2. Receive captured data from the page world ----
window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  var msg = event.data;
  if (!msg || msg.source !== "MS_EXTRACTOR") return;
  lessonData = msg.payload;
  showOverlay();
});

// ---- 3. Popup asks THIS frame to download ----
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "DOWNLOAD_MD") doDownload();
});

// ---- 4. Self-contained download (no background, no downloads API) ----
function doDownload() {
  if (!lessonData) return; // this frame captured nothing -> ignore quietly
  var md = extractToMarkdown(lessonData);
  var title = (lessonData.lesson && lessonData.lesson.title) || "lesson";
  var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFilename(title) + ".md";
  (document.body || document.documentElement).appendChild(a);
  a.click();
  setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// ---- 5. Overlay button ----
function showOverlay() {
  if (!document.body || document.getElementById("ms-extractor-overlay")) return;
  var div = document.createElement("div");
  div.id = "ms-extractor-overlay";
  div.innerHTML = "<span>\uD83D\uDCC4 Save as Markdown</span>";
  div.addEventListener("click", function () {
    doDownload();
    div.innerHTML = "<span>\u2705 Downloading...</span>";
    setTimeout(function () { div.remove(); }, 3000);
  });
  document.body.appendChild(div);
}

// ===================================================================
//  Extraction logic (moved verbatim from background.js)
// ===================================================================
function pmToMd(node, listDepth) {
  listDepth = listDepth || 0;
  if (!node) return "";
  var t = node.type || "";
  var content = node.content || [];
  var text = node.text || "";
  var marks = node.marks || [];
  var attrs = node.attrs || {};

  if (t === "text") {
    for (var i = 0; i < marks.length; i++) {
      var mt = marks[i].type || "";
      var ma = marks[i].attrs || {};
      if (mt === "bold")           text = "**" + text + "**";
      else if (mt === "italic")    text = "*" + text + "*";
      else if (mt === "underline") text = "<u>" + text + "</u>";
      else if (mt === "strike")    text = "~~" + text + "~~";
      else if (mt === "code")      text = "`" + text + "`";
      else if (mt === "link")      text = "[" + text + "](" + (ma.href || "") + ")";
    }
    return text;
  }

  var parts = content.map(function (c) { return pmToMd(c, listDepth); });

  if (t === "doc")         return parts.filter(function (p) { return p; }).join("\n\n").trim();
  if (t === "paragraph")   return parts.join("");
  if (t === "heading")     return new Array((attrs.level || 2) + 1).join("#") + " " + parts.join("");
  if (t === "bulletList")  return parts.join("\n");
  if (t === "orderedList") return parts.map(function (p, i) { return (i + 1) + ". " + p.replace(/^[-\u2022]\s*/, ""); }).join("\n");
  if (t === "listItem") {
    var indent = new Array(listDepth + 1).join("  ");
    var inner = pmToMd({ type: "doc", content: content }, listDepth + 1);
    var lines = inner.split("\n");
    return indent + "- " + lines[0] + (lines.length > 1 ? "\n" + lines.slice(1).map(function (l) { return indent + "  " + l; }).join("\n") : "");
  }
  if (t === "hardBreak")      return "\n";
  if (t === "horizontalRule") return "---";
  if (t === "blockquote")     return parts.join("\n\n").split("\n").map(function (l) { return "> " + l; }).join("\n");
  if (t === "codeBlock")      return "```&quot; + (attrs.language || &quot;&quot;) + &quot;\n&quot; + parts.join(&quot;&quot;) + &quot;\n```";
  return parts.join("");
}

function asMd(value) {
  if (!value) return "";
  if (typeof value === "object") return pmToMd(value);
  return String(value);
}

function renderBlock(blockId, blocks, visited) {
  if (visited.has(blockId) || !blocks[blockId]) return [];
  visited.add(blockId);

  var block = blocks[blockId];
  var btype = block.type || "";
  var data = block.data || {};
  var out = [];

  if (btype === "tiledLayout") {
    var rows = (block.layout || {}).rows || [];
    for (var r = 0; r < rows.length; r++) {
      var tiles = rows[r].tiles || [];
      for (var ti = 0; ti < tiles.length; ti++) {
        out = out.concat(renderBlock(tiles[ti].tileId, blocks, visited));
      }
    }
    if (block.sectionDivider) out.push("\n---\n");
  } else if (btype === "experienceTile") {
    var rootId = (data.root || {}).id;
    if (rootId) out = out.concat(renderBlock(rootId, blocks, visited));
  } else if (btype === "textTile") {
    if (data.text) out.push(asMd(data.text));
  } else if (btype === "imageTile") {
    var img = data.image || {};
    var src = img.source || img.url || "";
    var alt = img.altText || img.alt || "image";
    if (src) out.push("![" + alt + "](" + src + ")");
    if (data.caption) out.push("*" + data.caption + "*");
  } else if (btype === "videoTile") {
    var vurl = data.url || data.videoUrl || "";
    var vtitle = data.title || "Video";
    if (vurl) out.push("\uD83C\uDFAC **[" + vtitle + "](" + vurl + ")**");
  } else if (btype === "listTile") {
    (data.items || []).forEach(function (item) {
      var label = asMd(item.text);
      if (label) out.push("- " + label);
    });
  } else if (btype === "accordionTile") {
    if (data.title) out.push("### " + asMd(data.title));
    (data.items || []).forEach(function (item) {
      out.push("\n#### " + (item.header || item.title || ""));
      if (item.content || item.body) out.push(asMd(item.content || item.body));
    });
  } else if (btype === "calloutTile") {
    var ctext = data.text || data.body;
    if (ctext) out.push("> \uD83D\uDCA1 " + asMd(ctext));
  } else if (btype === "objective") {
    out.push("> \uD83C\uDFAF **Learning Objective:** " + (data.text || ""));
  } else if (btype === "questionTile") {
    if (data.question) out.push(asMd(data.question));
    out.push("*(" + (data.selectMultiple ? "Select all that apply" : "Select one") + ")*\n");
    (data.options || []).forEach(function (opt) {
      var marker = (opt.correct || opt.isCorrect) ? "\u2705" : "\u274C";
      var line = "- " + marker + " " + asMd(opt.text || {});
      var fb = asMd(opt.feedback);
      if (fb) line += "\n  > *" + fb + "*";
      out.push(line);
    });
    var cf = asMd(data.feedbackWhenCorrect);
    if (cf && cf.trim()) out.push("\n> \uD83D\uDCA1 **Correct:** " + cf);
  } else if (btype === "matchingTile") {
    if (data.title) out.push(asMd(data.title));
    out.push("\n| Term | Match |\n|---|---|");
    (data.items || []).forEach(function (item) {
      out.push("| " + (item.choice || "") + " | " + (item.match || "") + " |");
    });
  } else if (btype === "flipCardTile") {
    if (data.title) out.push("### " + data.title);
    (data.cards || []).forEach(function (card) {
      out.push("- **" + asMd(card.front || card.term || "") + "** -> " + asMd(card.back || card.definition || ""));
    });
  } else {
    var fallback = ["title", "heading", "text", "body", "description", "question"]
      .map(function (k) { return asMd(data[k]); })
      .filter(function (p) { return p && p.trim(); });
    if (fallback.length) out = out.concat(fallback);
    else out.push("<!-- unhandled: " + btype + " -->");
  }
  return out;
}

function extractToMarkdown(data) {
  var lesson = data.lesson;
  var blocks = lesson.blocks;
  var order = lesson.blockOrder;
  var projectName = (lesson.project || {}).name || "";
  var orgName = (lesson.organization || {}).name || "";

  var lines = [
    "# " + lesson.title,
    "*Course: " + projectName + " \u00B7 Organisation: " + orgName + "*\n",
    "<!-- lesson_id: " + lesson.id + " -->\n"
  ];

  var visited = new Set();
  order.forEach(function (pageId, i) {
    if (!blocks[pageId]) return;
    lines.push("\n---\n\n## Page " + (i + 1) + "\n");
    lines = lines.concat(renderBlock(pageId, blocks, visited));
  });

  return lines.join("\n\n").replace(/\n{4,}/g, "\n\n\n");
}

function sanitizeFilename(title) {
  return (title || "lesson").replace(/[^a-z0-9\-_ ]/gi, "_").trim().substring(0, 80);
}
