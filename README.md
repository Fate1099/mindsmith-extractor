# Mindsmith Markdown Extractor

A Firefox extension that extracts Mindsmith AI lesson content to clean,
pandoc-compatible Markdown files.

## Why?

Mindsmith lessons are delivered as interactive web modules that can't be
easily reviewed offline, searched, or annotated. This extension lets you
save any lesson — including quizzes with correct answers, matching
exercises, flip cards, dialogue trees, and more — as a single Markdown
file you actually own.

## Features

- One-click extraction from any Mindsmith lesson page
- Works in both standalone tabs and embedded iframes (Moodle, Canvas, etc.)
- Converts all content types:
    - Text, headings, lists, accordions
    - Quizzes with [correct]/[wrong] answer markers and inline feedback
    - Matching exercises as pipe tables
    - Flip cards, dialogue trees, learning objectives
    - Images, videos, code blocks
- Pandoc-compatible output:
    - YAML front matter for proper PDF title metadata
    - No emojis (pdflatex / Latin Modern safe)
    - Pipe-escaped table cells, tight lists, single-block tables
    - Underlines rendered as pandoc-native spans
    - Hard breaks preserved, thematic breaks safe from setext collisions

## Install

### Option A — Pre-built signed extension (recommended)

1. Download the .xpi from the latest release
2. Drag it onto a Firefox window, or open about:addons -> gear icon ->
   Install Add-on From File
3. Approve the installation

### Option B — Temporary load (for development)

1. Clone or download this repo
2. Open about:debugging -> This Firefox -> Load Temporary Add-on
3. Select manifest.json from this folder
4. Note: the extension vanishes when Firefox restarts

## Usage

1. Open a Mindsmith lesson (standalone or embedded in your LMS)
2. A "Save as Markdown" button appears in the bottom-right corner
3. Click it — a .md file downloads automatically

You can also click the extension icon in the toolbar and press
"Download Current Lesson".

## Converting to PDF

Output is mostly Pandoc (with pdflatex) compatible, no config is needed.

## How It Works

The extension injects a script that intercepts the lesson data the page
already loads from Mindsmith's tRPC API. It then converts the structured
JSON (ProseMirror document format) to clean Markdown. No additional API
calls are made — it only reads data the page was going to receive anyway.

Key technical details:

- The injected script runs in the page's main world (not the content
  script's isolated world) so it can patch window.fetch before the
  Mindsmith app calls the API
- Data is relayed back to the content script via window.postMessage
- Download is handled via Blob + anchor click — no background script,
  no downloads API needed
- Content scripts are injected with run_at: document_start and
  all_frames: true to catch both direct tabs and LMS iframes

## Permissions

| Permission | Why |
|---|---|
| https://app.mindsmith.ai/* | Content script injection — only runs on Mindsmith pages |

No other permissions. No background scripts. No data collection.

## File Structure

mindsmith-extractor/
  manifest.json     Extension metadata and content script config
  content.js        Main logic: ProseMirror-to-Markdown converter + download
  inject.js         Page-world fetch/XHR interceptor
  popup.html        Toolbar popup UI
  popup.js          Popup button handler
  overlay.css       Styling for the in-page download button

    ## License

    MIT
