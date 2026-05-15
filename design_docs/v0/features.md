# v0 — Features and Agent Plan

This is the canonical design doc for v0 of Minerva. Future versions will live in `design_docs/v1/`, `v2/`, etc. and reference back to this one.

---

## Human feedback (verbatim)

- Let's add more shapes. Let's try to include all shapes present in google slides.
- let's add ability to have dropn down shadow, rounded vs non rounded rectangles.
- Let's have the ability to change layer of the element - bring forward, send backward etc.
- Let's include as many fonts for text as we can.
    - ability to change size, color, highlight, bold italics, superscript, subscript.

- export pdf doesn't quite work now. It prints a whole wierd version of the whole page. We need the slide only to be exported to pdf.

- Feel free to check this skill for poster slides and pdf export: https://github.com/ethanweber/posterskill if it is helpful.

---

## v0 feature spec

Status legend: ✅ implemented · 🟡 partial · ⬜ planned (this version) · ⏭ deferred to a later version.

### Editor — canvas & interactions
| Feature | Status | Notes |
|---|---|---|
| Konva-based slide canvas, fit-to-viewport | ✅ | `SlideCanvas.tsx` |
| Click to select, shift/cmd-click to multi-select | ✅ | |
| Drag to move | ✅ | Konva built-in |
| Resize handles (8 anchors) | ✅ | Konva `Transformer` |
| Rotate handle | ✅ | |
| Click empty area to deselect | ✅ | |
| Delete key removes selected | ✅ | |
| Undo / Redo (Cmd+Z, Cmd+Shift+Z) | ✅ | History stack, 100 entries |
| Snap-to-grid + smart guides (Figma-style) | ⏭ | Nice-to-have |
| Zoom in/out | ⬜ | Cmd+= / Cmd+- and scroll-wheel zoom |
| Pan with space-drag | ⬜ | |

### Elements — content types
| Feature | Status | Notes |
|---|---|---|
| Text element | ✅ | Plain text in v0; rich text below |
| Image element (upload, drag-drop, paste, URL) | ✅ | All 3 input methods → `/api/assets` |
| Group element (nested children) | ✅ | Schema only; UI for group/ungroup ⬜ |
| Shape: rectangle (with optional corner radius) | ✅ | |
| Shape: ellipse / circle | ✅ | |
| Shape: triangle | ✅ | |
| Shape: line / arrow with arrowheads | ✅ | Toggle `arrowStart` / `arrowEnd` in inspector |
| **Shape library expansion** (per feedback) | ✅ | 30 shapes via `shapes.ts` registry; categorized picker in toolbar |

#### Shape library
Target: cover the everyday Google Slides shape menu. Grouped for the toolbar's shape picker.

- **Basic:** rectangle, rounded rectangle, ellipse, triangle, right triangle, diamond, parallelogram, trapezoid, pentagon, hexagon, octagon, star (4/5/6 point), heart, cloud, plus
- **Arrows:** right-arrow, left-arrow, up-arrow, down-arrow, double-arrow, bent-arrow, curved-arrow, callout-arrow
- **Callouts:** speech-bubble (rect), speech-bubble (ellipse), thought-bubble
- **Flowchart:** process (rect), decision (diamond), terminator (rounded rect), document, data (parallelogram), connector (circle)
- **Lines:** straight line, arrow (with head), elbow connector, curved connector

Internally each shape is a `type: "shape"` element with `shapeKind: "<name>"`. The renderer keeps a registry mapping `shapeKind → Konva path/polygon`. New shape kinds extend the registry without touching the schema's element types.

### Element styling
| Feature | Status | Notes |
|---|---|---|
| Fill color (color picker) | ✅ | |
| Stroke color + width | ✅ | |
| Opacity | ✅ | |
| Rounded corners on rectangles | ✅ | Radius slider in inspector |
| **Drop shadow** (per feedback) | ✅ | offsetX/Y, blur, color, opacity in inspector |
| Gradient fill (linear/radial) | ⏭ | v1 |
| Pattern / image fill | ⏭ | v1 |
| **Layer ordering** (per feedback) | ✅ | Inspector buttons: send to back / backward / forward / to front |

### Text styling (per feedback)
Rich text in v0 is stored as a TipTap-style JSON doc but rendered single-style. v0 closes that gap.

| Feature | Status | Notes |
|---|---|---|
| Inline edit (double-click to edit) | ⬜ | HTML overlay with TipTap editor (deferred to M4 main) |
| Font family | ✅ | 45 Google Fonts; on-demand loader |
| Font size | ✅ | Numeric input in inspector |
| Bold / italic / underline / strikethrough | ✅ | Toolbar B/I/U/S; apply-to-all in v0 |
| Text color | ✅ | Color picker in inspector |
| **Highlight color** (per feedback) | 🟡 | Mark stored on doc; renderer ignores until M4 main (Konva can't natively highlight) |
| **Superscript / subscript** (per feedback) | 🟡 | Marks stored on doc; renderer ignores until M4 main |
| Lists (bulleted / numbered) | ⬜ | Mark in the doc; render as wrapped lines |
| Alignment (left/center/right/justify) | ✅ | Per element |
| Multi-run rendering (mixed styles in one box) | ⬜ | Deferred to M4 main |

**Font handling:** load fonts on demand from Google Fonts via the WebFont Loader. Maintain a curated list of ~60 fonts (Inter, Roboto, Open Sans, Lato, Montserrat, Playfair Display, Merriweather, Source Sans Pro, Fira Code, JetBrains Mono, …). Selected family is persisted on the text element's first run; renderer triggers a font-load before drawing.

### Slides — deck management
| Feature | Status | Notes |
|---|---|---|
| Slide thumbnails sidebar | ✅ | Text preview only — needs real thumbnail render |
| Add slide | ✅ | |
| Delete slide (right-click) | ✅ | Keyboard shortcut ⬜ |
| Reorder slides (drag) | ⬜ | Schema supports; UI ⬜ |
| Duplicate slide | ⬜ | |
| Slide background color | ✅ | Per-slide; UI in inspector ⬜ |
| Slide background image | ⬜ | |

### Human ↔ Claude collaboration
| Feature | Status | Notes |
|---|---|---|
| `deck.json` on disk, watched by chokidar | ✅ | Server broadcasts external edits |
| Websocket live-reload when Claude edits | ✅ | |
| Element-level last-write-wins on conflict | ✅ | Stable IDs in schema |
| `comments.json` schema (open/in_progress/resolved) | ✅ | API endpoints in place |
| **Inline "Ask Claude" UI** (anchored to selection) | ⬜ | Right-click element → "Ask Claude…"; writes to `comments.json` |
| Comments side-panel with status + resolve | ⬜ | |
| `MINERVA.md` guide for Claude in deck folder | ✅ | Written by `minerva init` |

### Export
| Feature | Status | Notes |
|---|---|---|
| Export to PDF (per feedback: must be slide-only, not page) | ✅ | Playwright-based `/api/export/pdf`; verified 2-page PDF at 960×540pt from a 1280×720 deck. See [PDF export](#pdf-export) below |
| Export to PNG (per slide) | ⏭ | v1 |
| Export to JSON (already on disk) | ✅ | Just copy `deck.json` |

#### PDF export
**Current bug:** the toolbar's "Export PDF" calls `window.print()`, which captures the entire app — toolbar, sidebar, inspector, dark theme, scrollbars.

**Fix (Playwright, following posterskill's pattern):**

1. Add a `/print/:slideId?` route in the web app that renders **only** the slide(s) at 1:1 scale, white background, no chrome. A `?range=1-3` query selects a range; default is all slides, one per PDF page.
2. Add a server route `GET /api/export/pdf` that:
   - Launches Playwright (headless Chromium, bundled)
   - Navigates to `http://localhost:<port>/print`
   - Sets viewport to `deck.size` (e.g. 1280×720)
   - Waits for fonts + images to load (`document.fonts.ready` + `<img>` `complete`)
   - Calls `page.pdf({ width, height, printBackground: true, preferCSSPageSize: true, pageRanges: ... })`
   - Streams the PDF back as `application/pdf`
3. The toolbar "Export PDF" button calls `GET /api/export/pdf` and triggers a download.

Slide size, fonts, and assets all come from the deck — output is pixel-accurate to what the user sees.

### CLI
| Command | Status | Notes |
|---|---|---|
| `minerva init [dir]` | ✅ | Scaffolds `deck.json`, `assets/`, `comments.json`, `MINERVA.md` |
| `minerva serve [dir] [--port N]` | ✅ | |
| `minerva export pdf [dir] [--out file.pdf]` | ⬜ | Headless mode of the same Playwright route, no browser needed |

### Schema (`@minerva/schema`)
Already in place; the work for v0 is *additive* — no breaking changes. New fields needed:

- `BaseStyle.shadow?: { offsetX, offsetY, blur, color, opacity }`
- `ShapeElement.shapeKind` expanded enum (see shape library list)
- `TextRunMark` new variants: `highlight`, `superscript`, `subscript`
- `Slide.background.image?: { src, fit, opacity }`

Versioning: bump `DECK_SCHEMA_VERSION` to `2` if any change is *not* backward-compatible. The above are all additive, so v0 stays on `version: 1`.

---

## Out of scope for v0 (parked for later versions)

- Animations and slide transitions (decided earlier — not in PDF anyway)
- Multi-user real-time collaboration / Yjs / CRDTs
- SaaS hosting (auth, DB, multi-tenant)
- MCP server for remote Claude integration
- PPTX import or export
- Themes / templates
- Slide notes
- Chart / table elements (separate first-class element types)
- Cloud asset storage; only local `assets/` for now

---

## Agent plan

This is the build plan to address all of the feedback above. Each milestone is sized so it can be completed and reviewed independently. Items are numbered M-N for traceability across versions.

### M1 — PDF export via Playwright
**Goal:** "Export PDF" produces a clean, slide-only PDF that matches the canvas.

- M1.1 Add Playwright dependency to `@minerva/server`.
- M1.2 New web route `/print` (separate React entry or query-flag) that renders the deck full-bleed, no chrome, white background, one slide per visual page.
- M1.3 New server route `GET /api/export/pdf` that drives Playwright through `/print`, waits for fonts + images, calls `page.pdf` with `deck.size` dimensions, returns the file.
- M1.4 Toolbar "Export PDF" → fetch the route and trigger download with `download=<deckTitle>.pdf`.
- M1.5 `minerva export pdf` CLI subcommand (reuses the same Playwright code, no running browser needed).
- **Done when:** running `minerva export pdf` on a deck with text+shape+image renders a faithful multi-page PDF.

### M2 — Shape library expansion
**Goal:** ship a usable Google-Slides-equivalent shape menu.

- M2.1 Extend `ShapeElement.shapeKind` enum to cover the [Shape library](#shape-library) list.
- M2.2 Build a shape registry in the web package: `shapeKind → (geometry, w, h) => Konva path/points/polygon`. Default fill/stroke styles per kind.
- M2.3 Replace the single "+ Shape" buttons with a shape picker dropdown grouped by category (Basic, Arrows, Callouts, Flowchart, Lines).
- M2.4 Add arrowheads (start/end) as `style.arrowStart` / `style.arrowEnd`.
- **Done when:** every shape in the spec inserts, drags, resizes, and round-trips through `deck.json`.

### M3 — Element styling polish
**Goal:** drop shadow + corner radius UI + layer ordering.

- M3.1 Add `BaseStyle.shadow` to the schema (additive).
- M3.2 Inspector section "Shadow": x/y offset, blur, color picker, opacity. Konva `shadow*` props pass through.
- M3.3 Inspector section "Corner radius" on rectangles (slider).
- M3.4 Toolbar actions: Bring Forward / Bring to Front / Send Backward / Send to Back (reorder within `slide.elements`). Right-click context menu mirrors these.
- M3.5 Keyboard shortcuts: `]` forward, `[` back, `Shift+]` to front, `Shift+[` to back.
- **Done when:** Drop shadow visible on shapes/text/images; layer order changes survive a reload.

### M4 — Text editing & typography
**Goal:** real rich-text editing with the formatting requested.

- M4.1 Add new marks to schema: `highlight { color }`, `superscript`, `subscript`.
- M4.2 TipTap integration: double-click a text element to enter edit mode in an HTML overlay positioned over the Konva node. TipTap extensions: Bold, Italic, Underline, Strike, TextStyle (color, fontFamily, fontSize), Highlight, Superscript, Subscript, BulletList, OrderedList.
- M4.3 Floating text toolbar (appears when text is in edit mode or selected): font picker, size, B/I/U/S, color, highlight, sup/sub, list buttons, alignment.
- M4.4 Multi-run rendering: replace single-style `Konva.Text` with either (a) per-run `Konva.Text` nodes positioned via measure, or (b) an `HTMLImage` snapshot of the TipTap-rendered HTML when not in edit mode. (a) is more interactive, (b) is simpler and good enough for v0 — recommend (b).
- M4.5 Font picker loads from a curated Google Fonts list via `webfontloader`. Loaded fonts cached per session.
- M4.6 Inspector text section becomes a thin mirror of the floating toolbar.
- **Done when:** A text box can hold a sentence with mixed bold/italic/colored/highlighted/super/subscript text and renders identically in the editor and the PDF.

### M5 — Inline comments / "Ask Claude" UI
**Goal:** humans can give Claude scoped feedback without leaving the editor.

- M5.1 Right-click on selection → "Ask Claude…" opens an inline popover with a text box. Submit writes a new entry to `comments.json` with `slideId`, `targetIds`, `request`, `status: open`.
- M5.2 Comments side-panel (collapsible) listing open/in-progress/resolved comments, scoped to current slide by default.
- M5.3 When Claude resolves a comment (sets `status: resolved` + `resolvedAt`), the UI shows a notification; the comment moves to a "Resolved" tab.
- M5.4 `MINERVA.md` updated to instruct Claude on the comment workflow.
- **Done when:** I can select a title, ask "make this bolder", Claude edits `deck.json`, sets status, and I see the change live with the comment marked resolved.

### M6 — Slide management polish
- M6.1 Real slide thumbnails (small Konva render of the slide, not just text).
- M6.2 Drag to reorder slides.
- M6.3 Duplicate slide (Cmd+D when sidebar has focus).
- M6.4 Slide-level inspector when nothing is selected: background color + image.

### M7 — Canvas usability
- M7.1 Zoom (Cmd+= / Cmd+-, scroll-wheel with modifier).
- M7.2 Pan (space + drag).
- M7.3 Alignment guides while dragging (snap to slide center, other element edges/centers).

### Execution order

M1 first — broken export is the most visible bug. Then M2 + M3 in parallel since they share the inspector. M4 is the largest and most complex; do it after the styling work so the text toolbar can reuse the inspector primitives. M5 unlocks the differentiating feature (human ↔ Claude loop) and should land before any external demos. M6 and M7 are polish; opportunistic.

---

## Pointers

- **posterskill** (ethanweber): inspiration for the Playwright-based PDF pipeline and the in-browser editing-then-config-export loop. https://github.com/ethanweber/posterskill
- **TipTap**: rich text editor framework used in step M4. https://tiptap.dev
- **Konva**: 2D canvas library underpinning the renderer. https://konvajs.org
- **Google Fonts WebFont Loader**: dynamic font loading. https://github.com/typekit/webfontloader
