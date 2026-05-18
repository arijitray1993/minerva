# Minerva

**A Google Slides-like editor that humans and Claude edit together.**

Slides live as a portable JSON file (`deck.json`) in a project folder. Humans drag, type, and style in a WYSIWYG canvas. Claude Code, running in the same folder, edits the same file — and uses the editor's renderer (not its own HTML mock-up) as ground truth for what the slide actually looks like.

```
  ┌──────────────┐         deck.json         ┌──────────────┐
  │  Browser UI  │  ←──────  watch + ws ─────→  │  Claude Code │
  │  (Konva)     │                              │  in terminal │
  └──────────────┘                              └──────────────┘
```

## One-line setup

Minerva is a single npm package. To start a new deck, pick whichever flow fits how you work:

### A. Paste into Claude Code (recommended)

```text
mkdir my-deck && cd my-deck
claude

> Run `npx -y minerva-slides@latest start` in the background, then read MINERVA.md and follow it.
```

Claude starts the server, opens the editor in your browser, reads the `MINERVA.md` guide that just got created, and waits for your next request.

### B. Run it yourself, then open Claude

```bash
mkdir my-deck && cd my-deck
npx -y minerva-slides@latest start
# in another terminal:
claude
```

Either way, you end up with this in `my-deck/`:

```
deck.json       slide content (live-reloaded on edit)
assets/         images (drop files here or paste/upload in the UI)
comments.json   feedback you leave for Claude from the editor
MINERVA.md      the rules Claude follows when editing this deck
.minerva/       Claude's per-slide PNG previews
```

The editor runs at <http://localhost:5174>.

## What this gives you

- **A real WYSIWYG editor.** 30 shapes, rich text (font, size, color, bold/italic/underline/strike, super/sub, highlight, alignment), tables, images via drag-drop / paste / upload, drop shadows, corner radius, opacity, layer ordering, group/ungroup, zoom + pan, undo/redo, format painter.
- **Claude as a competent collaborator.** Right-click any element → "Leave Claude comment…" to scope a request. Claude reads `comments.json` on session start, edits `deck.json`, renders the slide to PNG, looks at the PNG, and iterates against the actual rendered output — not a hallucinated HTML preview.
- **One file is the whole deck.** `deck.json` is portable. Diff it, commit it, copy it between machines. No database, no SaaS account, no lock-in.
- **PDF export that looks like the canvas.** Playwright drives the same `/print` route to produce a faithful, slide-only PDF.

## How the human ↔ Claude loop works

1. You select something in the editor, right-click, and pick **"Leave Claude comment…"**.
2. The editor writes an entry to `comments.json` with the slide id, the selected element ids, and your request.
3. Claude reads `comments.json` (the rules in `MINERVA.md` tell it to read this on every session) and finds those elements in `deck.json` by id.
4. Claude edits `deck.json`. The editor live-reloads via WebSocket so you see the change instantly.
5. Claude runs `minerva render <slide-id>` to write a PNG to `.minerva/`, opens the PNG, and verifies the result before marking the comment resolved.

The visual feedback loop is the important part. Claude is **explicitly told not to invent its own HTML/CSS preview** — those would measure text differently, fall back to different fonts, and lie about layout. The only acceptable preview is the PNG rendered by the actual editor.

## Requirements

- **Node 18 or newer.**
- A Chromium build, used by PDF export and PNG rendering. Minerva looks for one in this order:
  1. `$MINERVA_CHROMIUM` env var
  2. Playwright's cache (`~/.cache/ms-playwright/chromium-*`)
  3. System Chrome / Chromium (`/Applications/Google Chrome.app`, `/usr/bin/google-chrome`, etc.)

  If none of these resolve, install one with:

  ```bash
  npx playwright install chromium
  ```

## CLI

```text
minerva start [dir] [--port N] [--no-open]
    Scaffold (if needed) and start the editor. The one-command setup.

minerva init [dir]
    Scaffold a new deck folder: deck.json, assets/, comments.json, MINERVA.md.

minerva serve [dir] [--port N] [--no-open]
    Start the editor on an existing deck folder.

minerva render <slide-id|all> [--port N] [--out file.png] [--dir D]
    Render slide(s) to PNG. Used by Claude to "look at" a slide.
    Requires `minerva serve` or `minerva start` running. Default output:
    .minerva/preview-<slide-id>.png
```

## Develop locally

```bash
git clone <this repo>
cd minerva
npm install
npm run build              # builds workspaces + the publishable bundle
npm run minerva -- start ../some-deck-folder
```

Source layout:

- `packages/schema` — Zod schema + types for `deck.json` and `comments.json`. This is the source of truth for the deck format.
- `packages/server` — Express + chokidar + ws + Playwright. Watches the deck, serves the UI, exports PDF, renders PNG previews.
- `packages/web` — Vite + React + Konva. The WYSIWYG editor.
- `scripts/build-publish.mjs` — bundles the CLI with esbuild and stages `web-dist/` for the npm tarball.

## License

MIT.
