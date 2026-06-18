## SUMMARY.md

    # Mindsmith Markdown Extractor — Technical Summary

    This document describes the reverse-engineering process and technical
    architecture of the extension for reference.

    ## Discovery

    Mindsmith lessons use a public tRPC endpoint
    (learn.getPublicLesson) that requires no authentication. The "security"
    of these modules relies entirely on security through obscurity via the
    lesson ID. Lesson IDs are CUID v1 strings — not easily guessable, but
    once obtained (from any public link), the full content is trivially
    extractable as structured JSON.

    The JSON response contains:

    - lesson.title, lesson.project, lesson.organization — metadata
    - lesson.blocks — a dictionary of all content blocks keyed by ID
    - lesson.blockOrder — an ordered list of page/block IDs

    Each block has a type (textTile, questionTile, matchingTile, etc.)
    and a data object with type-specific fields. Rich text is stored as
    ProseMirror document nodes (nested type/content/text/marks structure).

    ## Architecture

    The extension has three layers:

    ### Layer 1: inject.js (page main world)

    Runs in the page's real JavaScript context by being appended as a
    script tag by the content script. Patches window.fetch and
    XMLHttpRequest.prototype.open/send to intercept any tRPC response
    whose URL contains "/api/trpc/" and "lesson". Captured data is sent
    to the content script via window.postMessage with a
    source: "MS_EXTRACTOR" marker.

    This layer is necessary because content scripts run in an isolated
    world with their own copy of window — patching fetch there has no
    effect on the page's actual network calls.

    ### Layer 2: content.js (content script world)

    Injects inject.js at document_start, listens for postMessage data,
    and contains the full ProseMirror-to-Markdown conversion engine.
    When data arrives or the user clicks the overlay/popup button, it
    builds the Markdown string and triggers a download via Blob +
    dynamically-created anchor element with the download attribute.
    No background script or downloads API is needed.

    Key rendering functions:

    - pmToMd(node, opts) — recursive ProseMirror node walker. Accepts
      an opts object with listDepth and inTable for context-aware output
      (e.g. hard breaks become spaces inside table cells, paragraphs
      join with spaces instead of blank lines).
    - asMd(value, opts) — polymorphic wrapper: ProseMirror objects go
      through pmToMd, primitives are stringified.
    - cell(value) — flattens content to a single line and escapes pipes,
      used for all table cell output.
    - inlineText(value) — like cell() but without pipe escaping, used
      for quiz feedback and flip card content.
    - asQuote(text) — prefixes every line with "> " for blockquotes.
    - renderBlock(blockId, blocks, visited) — walks the block graph
      recursively (tiledLayout -> experienceTile -> leaf tiles).
    - extractToMarkdown(data) — top-level entry point. Builds YAML
      front matter, iterates blockOrder pages, and post-processes
      the output (collapse consecutive rules, fix emphasis+colon
      spacing, normalize blank lines).

    ### Layer 3: popup.html + popup.js (browser action popup)

    Minimal UI. The "Download Current Lesson" button sends a DOWNLOAD_MD
    message to the active tab via chrome.tabs.sendMessage. The content
    script in whichever frame captured the data handles it; other frames
    ignore it. The popup also catches runtime.lastError to suppress
    harmless "no receiver" warnings.

    ## Pandoc Compatibility Design

    The output is specifically designed for pandoc -> pdflatex with
    Latin Modern fonts (no xelatex required):

    - No emojis: replaced with ASCII bracketed labels ([correct],
      [wrong], [Video], [Note], [Objective])
    - No raw HTML: underlines use pandoc-native [text]{.underline}
      spans instead of u tags (raw HTML is dropped by pandoc's
      LaTeX writer)
    - YAML front matter: provides title/subtitle metadata for proper
      PDF title block
    - header-includes: injects RaggedRight on section/subsection
      headings to prevent long-title overflow in justified text
    - Single-block tables: all rows joined with \n inside one string
      (blank lines between rows break pandoc pipe tables)
    - Pipe escaping: literal | in cell content becomes \|
    - Tight lists: items joined as one string to avoid loose-list
      spacing in PDF output
    - Thematic breaks: asterisks (* * *) instead of dashes (---),
      which pandoc could misread as setext H2 headings
    - Hard breaks: backslash-newline outside tables (pandoc renders
      as line break), space inside tables (no newlines in cells)
    - Page markers: HTML comments instead of headings to avoid
      inverted heading hierarchy breaking pandoc's TOC
    - Heading de-listification: when a list item is only a heading,
      the bullet prefix is stripped to avoid orphan bullet rendering

    ## Mindsmith Content Protection Assessment

    Mindsmith offers four delivery methods, in order of security:

    1. Public Link (weakest) — anyone with the URL gets full content
       via the unauthenticated API. This is what most schools use.
    2. SCORM Static Package — self-contained ZIP delivered by LMS.
       Content is local but copyable.
    3. SCORM Dynamic Package — LMS controls access, but Mindsmith
       still serves the content via API.
    4. LTI 1.3 (strongest) — cryptographic handshake between LMS
       and Mindsmith. No static lesson ID exposed. Session-scoped.

    The extension works against all delivery methods because it
    intercepts the data the browser is already receiving, regardless
    of how it was authenticated. Only LTI 1.3 prevents the
    unauthenticated API approach, but the page itself still loads
    the data.

    No web-delivered content can be truly copy-proof. The goal of
    stronger delivery methods is to prevent bulk automated access,
    not to stop an individual student from saving their own copy.

    ## Extension Signing and Distribution

    The extension is signed via Mozilla's AMO API (web-ext sign
    --channel=unlisted) and distributed as a pre-built .xpi on
    GitHub Releases. It is not publicly listed on AMO to reduce
    DMCA takedown risk. The source code is available for audit.

    Manifest V2 is used for Firefox compatibility. MV2 is still
    fully supported by Firefox and does not have the service-worker
    complexity of MV3.