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

// ---- 5. Overlay button (emoji here is browser UI only, not file output) ----
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
//  Extraction logic  (v1.6 - pandoc / pdflatex friendly)
// ===================================================================

// Tier 1: central label map -- pure ASCII, no emojis in the output.
var LABEL = {
  correct:   "[correct]",
  wrong:     "[wrong]",
  video:     "[Video]",
  note:      "[Note]",
  objective: "[Objective]"
};

// v1.6: tiles we intentionally skip (navigation / layout only) -> no comment.
var IGNORE_TILES = { buttonsTile: 1, spacerTile: 1, dividerTile: 1 };

// Carry rendering context (list depth + whether we are inside a table cell).
function childOpts(opts, extra) {
  var o = { listDepth: opts.listDepth || 0, inTable: !!opts.inTable };
  if (extra) { for (var k in extra) o[k] = extra[k]; }
  return o;
}

function pmToMd(node, opts) {
  opts = opts || {};
  var listDepth = opts.listDepth || 0;
  var inTable = !!opts.inTable;
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
      else if (mt === "underline") text = "[" + text + "]{.underline}";
      else if (mt === "strike")    text = "~~" + text + "~~";
      else if (mt === "code")      text = "`" + text + "`";
      else if (mt === "link")      text = "[" + text + "](" + (ma.href || "") + ")";
    }
    return text;
  }

  var parts = content.map(function (c) { return pmToMd(c, opts); });

  if (t === "doc") {
    var sep = inTable ? " " : "\n\n";
    return parts.filter(function (p) { return p; }).join(sep).trim();
  }
  if (t === "paragraph")   return parts.join("");
  if (t === "heading")     return new Array((attrs.level || 2) + 1).join("#") + " " + parts.join("");
  if (t === "bulletList")  return parts.join("\n");
  if (t === "orderedList") return parts.map(function (p, i) { return (i + 1) + ". " + p.replace(/^[-\u2022]\s*/, ""); }).join("\n");
  if (t === "listItem") {
    var inner = pmToMd({ type: "doc", content: content }, childOpts(opts, { listDepth: listDepth + 1 }));
    // Tier 1 fix: a list item that is ONLY a heading -> emit the heading bare,
    // never "- ### ..." (that produced the orphan bullets + broken headings).
    if (/^#{1,6}\s/.test(inner)) return inner;
    var indent = new Array(listDepth + 1).join("  ");
    var lines = inner.split("\n");
    return indent + "- " + lines[0] + (lines.length > 1 ? "\n" + lines.slice(1).map(function (l) { return indent + "  " + l; }).join("\n") : "");
  }
  if (t === "hardBreak")      return inTable ? " " : "\\\n";
  if (t === "horizontalRule") return "* * *";
  if (t === "blockquote") {
    if (inTable) return parts.join(" ");
    return parts.join("\n\n").split("\n").map(function (l) { return "> " + l; }).join("\n");
  }
  if (t === "codeBlock")      return "```" + (attrs.language || "") + "\n" + parts.join("") + "\n```";
  return parts.join("");
}

function asMd(value, opts) {
  if (!value) return "";
  if (typeof value === "object") return pmToMd(value, opts);
  return String(value);
}

// Flatten any value to a single trimmed line (used for inline feedback etc.).
function inlineText(value) {
  return asMd(value, { inTable: true }).replace(/\s+/g, " ").trim();
}

// Tier 1/2: a table cell is always single-line, with pipes escaped.
function cell(value) {
  return inlineText(value).replace(/\|/g, "\\|");
}

// Prefix every line of a (possibly multi-line) string as a blockquote.
function asQuote(text) {
  return String(text).split("\n").map(function (l) { return "> " + l; }).join("\n");
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
    if (block.sectionDivider) out.push("* * *");
  } else if (btype === "experienceTile") {
    var rootId = (data.root || {}).id;
    if (rootId) out = out.concat(renderBlock(rootId, blocks, visited));
  } else if (btype === "textTile") {
    if (data.text) out.push(asMd(data.text));
  } else if (btype === "sectionCalloutTile") {
    // Tier 1 fix: was silently dropped. Capture its title + intro text.
    if (data.title) out.push("## " + inlineText(data.title));
    var sc = data.text || data.body || data.content || data.subtitle || data.description;
    if (sc) out.push(asMd(sc));
  } else if (btype === "imageTile") {
    var img = data.image || {};
    var src = img.source || img.url || "";
    var alt = img.altText || img.alt || "image";
    if (src) {
      out.push("![" + alt + "](" + src + ")");
      if (/\.(webp|svg)(\?|#|$)/i.test(src)) {
        out.push("<!-- note: image format may not embed in pdflatex; alt text preserved -->");
      }
    }
    if (data.caption) out.push("*" + data.caption + "*");
  } else if (btype === "videoTile") {
    var vurl = data.url || data.videoUrl || "";
    var vtitle = data.title || "Video";
    if (vurl) out.push(LABEL.video + " **[" + vtitle + "](" + vurl + ")**");
  } else if (btype === "listTile") {
    var liLines = [];
    (data.items || []).forEach(function (item) {
      var label = asMd(item.text);
      if (label && label.trim()) liLines.push("- " + label);
    });
    if (liLines.length) out.push(liLines.join("\n"));
  } else if (btype === "accordionTile") {
    if (data.title) out.push("### " + asMd(data.title));
    (data.items || []).forEach(function (item) {
      out.push("#### " + (item.header || item.title || ""));
      if (item.content || item.body) out.push(asMd(item.content || item.body));
    });
  } else if (btype === "calloutTile") {
    var ctext = data.text || data.body;
    if (ctext) out.push(asQuote(LABEL.note + " " + asMd(ctext)));
  } else if (btype === "objective") {
    out.push(asQuote(LABEL.objective + " **Learning Objective:** " + asMd(data.text)));
  } else if (btype === "questionTile") {
    if (data.question) out.push(asMd(data.question));
    out.push("*(" + (data.selectMultiple ? "Select all that apply" : "Select one") + ")*");
    var optLines = [];
    (data.options || []).forEach(function (opt) {
      var marker = (opt.correct || opt.isCorrect) ? LABEL.correct : LABEL.wrong;
      var line = "- " + marker + " " + inlineText(opt.text || {});
      // Tier 1 fix: feedback inline with em-dash (the nested ">" rendered
      // literally inside a tight list). Now it stays on the bullet line.
      var fb = inlineText(opt.feedback);
      if (fb) line += " \u2014 *" + fb + "*";
      optLines.push(line);
    });
    if (optLines.length) out.push(optLines.join("\n"));
    var cf = asMd(data.feedbackWhenCorrect);
    if (cf && cf.trim()) out.push(asQuote(LABEL.note + " **Correct:** " + cf));
  } else if (btype === "matchingTile") {
    if (data.title) out.push(asMd(data.title));
    var tbl = ["| Term | Match |", "|---|---|"];
    (data.items || []).forEach(function (item) {
      tbl.push("| " + cell(item.choice || "") + " | " + cell(item.match || "") + " |");
    });
    out.push(tbl.join("\n"));
  } else if (btype === "flipCardTile") {
    if (data.title) out.push("### " + data.title);
    var fcLines = [];
    (data.cards || []).forEach(function (card) {
      var front = inlineText(card.front || card.term || "");
      var back = inlineText(card.back || card.definition || "");
      if (front || back) fcLines.push("- **" + front + "** -> " + back);
    });
    if (fcLines.length) out.push(fcLines.join("\n"));
  } else if (IGNORE_TILES[btype]) {
    // Tier 2: intentionally skipped, emit nothing (no stray comment).
  } else {
    var fallback = ["title", "heading", "text", "body", "description", "question"]
      .map(function (k) { return asMd(data[k]); })
      .filter(function (p) { return p && p.trim(); });
    if (fallback.length) out = out.concat(fallback);
    else out.push("<!-- unhandled: " + btype + " -->");
  }
  return out;
}

// YAML metadata block must be the very first thing in the file.
function yamlEsc(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function extractToMarkdown(data) {
  var lesson = data.lesson;
  var blocks = lesson.blocks;
  var order = lesson.blockOrder;
  var projectName = (lesson.project || {}).name || "";
  var orgName = (lesson.organization || {}).name || "";

  var fm = ["---", "title: \"" + yamlEsc(lesson.title) + "\""];
  var subtitleBits = [];
  if (projectName) subtitleBits.push("Course: " + projectName);
  if (orgName) subtitleBits.push("Organisation: " + orgName);
  if (subtitleBits.length) {
    fm.push("subtitle: \"" + yamlEsc(subtitleBits.join(" \u00B7 ").trim()) + "\"");
  }
  fm.push("---");

  var lines = [
    fm.join("\n"),
    "<!-- lesson_id: " + lesson.id + " -->"
  ];

  var visited = new Set();
  order.forEach(function (pageId, i) {
    if (!blocks[pageId]) return;
    if (i > 0) lines.push("* * *");                 // visual divider between pages
    // Tier 2 fix: page marker is now a COMMENT, not "## Page N".
    // Content keeps its natural H1/H2/H3 -> no inverted heading hierarchy / clean TOC.
    lines.push("<!-- Page " + (i + 1) + " -->");
    lines = lines.concat(renderBlock(pageId, blocks, visited));
  });

  return lines.join("\n\n")
    // Tier 2: drop a stray space before a colon that follows emphasis ("** :" -> "**:").
    .replace(/(\S\*+) :/g, "$1:")
    // Tier 1 fix: collapse consecutive thematic breaks (page divider + sectionDivider).
    .replace(/(\* \* \*)(\n+\* \* \*)+/g, "* * *")
    .replace(/\n{4,}/g, "\n\n\n");
}

function sanitizeFilename(title) {
  return (title || "lesson").replace(/[^a-z0-9\-_ ]/gi, "_").trim().substring(0, 80);
}
