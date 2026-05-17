#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { emptyDeck, Deck } from "@minerva/schema";
import { startServer } from "./server.js";

function usage(): never {
  console.log(`minerva — Google Slides-like editor with a Claude collaborator

Usage:
  minerva init [dir]           Scaffold a new deck in [dir] (default: current dir)
  minerva serve [dir] [--port N]
                               Start the editor server on the deck in [dir]
  minerva render <slide-id|all> [--port N] [--out path.png] [--dir D]
                               Render slide(s) to PNG via the running editor.
                               Default output: .minerva/preview-<slide>.png
`);
  process.exit(0);
}

function cmdInit(dir: string) {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });

  const deckPath = join(root, "deck.json");
  if (existsSync(deckPath)) {
    console.error(`refusing to overwrite existing deck.json at ${deckPath}`);
    process.exit(1);
  }
  writeFileSync(deckPath, JSON.stringify(emptyDeck(), null, 2) + "\n", "utf8");

  const commentsPath = join(root, "comments.json");
  if (!existsSync(commentsPath)) {
    writeFileSync(commentsPath, JSON.stringify({ comments: [] }, null, 2) + "\n", "utf8");
  }

  const readmePath = join(root, "MINERVA.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, claudeInstructions(), "utf8");
  }

  console.log(`initialized minerva deck at ${root}`);
  console.log(`  deck.json      ← slides`);
  console.log(`  assets/        ← images (hashed filenames)`);
  console.log(`  comments.json  ← inline requests for Claude`);
  console.log(`  MINERVA.md     ← guide for Claude in this folder`);
  console.log(`\nnext: minerva serve`);
}

function claudeInstructions(): string {
  return `# Minerva deck — guide for Claude

This folder holds a Minerva slide deck. Slides live in \`deck.json\` (validated against
the \`@minerva/schema\` Zod schema). Images are in \`assets/\`. Human-authored feedback
arrives in \`comments.json\`.

## How you must work — the render loop

The Minerva editor (Konva on canvas) is the **only** ground truth for how slides look.
HTML preview files you create yourself will measure text differently, use different
font fallbacks, and lie to you about layout. Do not invent your own previews.

After any visible change to \`deck.json\`, run:

\`\`\`
minerva render <slide-id>          # writes .minerva/preview-<slide-id>.png
minerva render all                 # all slides
\`\`\`

Then **open the PNG with your Read tool** to see exactly what the human sees, and
iterate against that image. This is your visual feedback loop.

The CLI requires \`minerva serve\` to be running in this folder (default port 5174).
If you need a different port: \`minerva render <id> --port 5175\`.

## Hard rules

- **Do not create \`*.html\`, \`*.htm\`, \`*.css\`, or any other "preview" / "mockup" /
  "render" files in this folder.** The only acceptable preview is the PNG produced
  by \`minerva render\`.
- **Do not modify any file outside this deck folder.** The renderer code lives in
  the Minerva repo, not here, and tuning it to match your mental model breaks the
  human's view. If layout is wrong, fix the deck, not the renderer.
- **Always re-render and re-view after a change** before claiming it's done.

## Comments from the human (start here every session)

The human leaves scoped requests in \`comments.json\` by right-clicking an element
in the editor and selecting "Leave Claude comment…". The file is structured as:

\`\`\`
{ "comments": [
  { "id": "...", "slideId": "slide-1", "targetIds": ["text-title-main"],
    "author": "human", "request": "make this bolder",
    "status": "open" | "in_progress" | "resolved",
    "createdAt": "2026-...", "resolvedAt": "2026-..." }
] }
\`\`\`

**On every session start, read \`comments.json\` and address every entry with
\`status: "open"\`.** Each comment's \`targetIds\` lists the element \`id\`s in
\`deck.json\` that the human had selected — find those in \`deck.json\` by id and
make the requested change. Then update the comment entry:

- Set \`status\` to \`"resolved"\` (or \`"in_progress"\` if you're partway through).
- Stamp \`resolvedAt\` with the current ISO 8601 timestamp.
- Leave the rest of the entry alone — the human reads it to verify.

Don't delete resolved comments; the human reviews them.

## Editing the deck

- Edit \`deck.json\` directly with your file tools. The running editor live-reloads.
- Every element has a stable \`id\`. Reuse existing ids when you edit; generate new
  short ids when you add elements (any unique string is fine).
- Keep the \`version\` field at 1.

## Deck shape (summary)

\`\`\`
Deck { version: 1, title, size {w,h}, theme, slides: Slide[] }
Slide { id, background?, elements: Element[], notes? }
Element = TextElement | ShapeElement | ImageElement | GroupElement
\`\`\`

See the Minerva repo's \`packages/schema/src/index.ts\` for the full type definitions.
`;
}

async function cmdServe(dir: string, port: number) {
  const root = resolve(dir);
  if (!existsSync(join(root, "deck.json"))) {
    console.error(`no deck.json found in ${root}. run 'minerva init' first.`);
    process.exit(1);
  }
  await startServer({ root, port });
}

async function cmdRender(target: string, dir: string, port: number, outOverride: string | null) {
  const root = resolve(dir);
  const deckPath = join(root, "deck.json");
  if (!existsSync(deckPath)) {
    console.error(`no deck.json found in ${root}`);
    process.exit(1);
  }
  const deck = Deck.parse(JSON.parse(readFileSync(deckPath, "utf8")));
  const slideIds =
    target === "all"
      ? deck.slides.map((s) => s.id)
      : [target];

  for (const id of slideIds) {
    if (!deck.slides.some((s) => s.id === id)) {
      console.error(`no slide with id "${id}". slides: ${deck.slides.map((s) => s.id).join(", ")}`);
      process.exit(1);
    }
  }

  const previewDir = join(root, ".minerva");
  mkdirSync(previewDir, { recursive: true });

  for (const id of slideIds) {
    const url = `http://localhost:${port}/api/render/png?slide=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      console.error(`render failed for "${id}" (${res.status}): ${body}`);
      console.error(`is 'minerva serve' running on port ${port}?`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const out =
      outOverride && slideIds.length === 1
        ? resolve(outOverride)
        : join(previewDir, `preview-${id}.png`);
    await writeFile(out, buf);
    console.log(out);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h") usage();

  if (cmd === "init") {
    cmdInit(argv[1] ?? ".");
    return;
  }
  if (cmd === "serve") {
    let port = 5174;
    let dir = ".";
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--port") {
        port = parseInt(argv[++i] ?? "5174", 10);
      } else if (!a.startsWith("--")) {
        dir = a;
      }
    }
    await cmdServe(dir, port);
    return;
  }
  if (cmd === "render") {
    let port = 5174;
    let dir = ".";
    let out: string | null = null;
    let target: string | null = null;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--port") port = parseInt(argv[++i] ?? "5174", 10);
      else if (a === "--out") out = argv[++i] ?? null;
      else if (a === "--dir") dir = argv[++i] ?? ".";
      else if (!a.startsWith("--") && target === null) target = a;
    }
    if (!target) {
      console.error("usage: minerva render <slide-id|all> [--port N] [--out path.png] [--dir D]");
      process.exit(1);
    }
    await cmdRender(target, dir, port, out);
    return;
  }
  console.error(`unknown command: ${cmd}`);
  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
