# Minerva

A Google Slides-like editor that both humans and Claude can edit. Slides live as a portable JSON file (`deck.json`) in a project folder; Claude Code, running in the same folder, edits the file directly while humans interact with a WYSIWYG editor in the browser.

## Status

v0 — under active construction. See `packages/schema` for the deck format and `packages/server` for the local CLI.

## Quick start (once built)

```bash
npm install
npm run build

# In a fresh project folder:
npx minerva init       # scaffolds deck.json + assets/
npx minerva serve      # opens the editor at http://localhost:5174
```

Then open Claude Code in the same folder and ask it to edit slides.

## Architecture

- `packages/schema` — shared TypeScript types + Zod validators for `deck.json`.
- `packages/server` — Node + Express + chokidar + ws. Watches `deck.json`, broadcasts changes, serves the UI, exports PDF (later).
- `packages/web` — Vite + React + Konva WYSIWYG editor.

The file system is the integration point between human and Claude. No MCP server in v0.
