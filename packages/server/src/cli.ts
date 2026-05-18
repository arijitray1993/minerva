#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { emptyDeck, Deck } from "@minerva/schema";
import { startServer } from "./server.js";

function usage(): never {
  console.log(`minerva — Google Slides-like editor with a Claude collaborator

Usage:
  minerva start [dir] [--port N] [--no-open]
                               Scaffold (if needed) and start the editor.
                               This is the one-command setup.
  minerva init [dir]           Scaffold a new deck in [dir] (default: current dir)
  minerva serve [dir] [--port N] [--no-open]
                               Start the editor server on the deck in [dir]
  minerva render <slide-id|all> [--port N] [--out path.png] [--dir D]
                               Render slide(s) to PNG via the running editor.
                               Default output: .minerva/preview-<slide>.png
`);
  process.exit(0);
}

type InitOptions = {
  /** If true, do not error when deck.json already exists; just ensure the
   *  surrounding scaffolding is up to date. Used by `minerva start`. */
  idempotent?: boolean;
  /** Always rewrite MINERVA.md, so guidance updates propagate to existing decks. */
  refreshGuide?: boolean;
};

function cmdInit(dir: string, opts: InitOptions = {}) {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });

  const deckPath = join(root, "deck.json");
  const deckExisted = existsSync(deckPath);
  if (deckExisted && !opts.idempotent) {
    console.error(`refusing to overwrite existing deck.json at ${deckPath}`);
    process.exit(1);
  }
  if (!deckExisted) {
    writeFileSync(deckPath, JSON.stringify(emptyDeck(), null, 2) + "\n", "utf8");
  }

  const commentsPath = join(root, "comments.json");
  if (!existsSync(commentsPath)) {
    writeFileSync(commentsPath, JSON.stringify({ comments: [] }, null, 2) + "\n", "utf8");
  }

  const guidePath = join(root, "MINERVA.md");
  if (!existsSync(guidePath) || opts.refreshGuide) {
    writeFileSync(guidePath, claudeInstructions(), "utf8");
  }

  if (!deckExisted) {
    console.log(`initialized minerva deck at ${root}`);
    console.log(`  deck.json      ← slides`);
    console.log(`  assets/        ← images (hashed filenames)`);
    console.log(`  comments.json  ← inline requests for Claude`);
    console.log(`  MINERVA.md     ← guide for Claude in this folder`);
  }
}

function claudeInstructions(): string {
  return `# Minerva deck — guide for Claude

This folder holds a Minerva slide deck. Slides live in \`deck.json\`, validated by a
Zod schema. Images are in \`assets/\`. Human feedback arrives in \`comments.json\`.

## Ground rule — use the editor, don't reinvent it

The Minerva editor (Konva on canvas) is the **only** ground truth for how slides
look. A handwritten HTML preview will measure text differently, fall back to
different fonts, and lie to you about layout. **Do not build your own renderer**
under any circumstances.

Concretely, this means:

- **Do not create \`*.html\`, \`*.htm\`, \`*.css\`, \`*.svg\`, or any "preview" /
  "mockup" / "render" file in this folder.** The PNG written by \`minerva render\`
  is the only acceptable preview.
- **Do not invent new element \`type\`s or \`shapeKind\`s.** The schema's whitelist
  (below) is exhaustive. If a shape isn't listed, compose it from the ones that
  are, or render it as text.
- **Do not modify any file outside this deck folder.** The renderer lives in the
  installed \`minerva-slides\` package, not here. Tuning it to match your mental
  model breaks the human's live view.

## Your render loop

After any visible change to \`deck.json\`:

\`\`\`
minerva render <slide-id>          # writes .minerva/preview-<slide-id>.png
minerva render all                 # all slides
\`\`\`

Then **open the PNG with your Read tool** and iterate against that image. This is
your visual feedback loop. \`minerva serve\` (or \`minerva start\`) must be running
in this folder for renders to succeed.

## Comments from the human (read these first, every session)

The human leaves scoped requests in \`comments.json\` by right-clicking an element
in the editor and selecting "Leave Claude comment…". Schema:

\`\`\`
{ "comments": [
  { "id": "...", "slideId": "slide-1", "targetIds": ["text-title-main"],
    "author": "human", "request": "make this bolder",
    "status": "open" | "in_progress" | "resolved",
    "createdAt": "2026-...", "resolvedAt": "2026-..." }
] }
\`\`\`

**On every session start, read \`comments.json\` and address every \`status: "open"\`
entry.** Each comment's \`targetIds\` lists the element \`id\`s the human had
selected — find those in \`deck.json\` and make the requested change. Then update
the comment:

- Set \`status\` to \`"resolved"\` (or \`"in_progress"\` if mid-task).
- Stamp \`resolvedAt\` with the current ISO 8601 timestamp.
- Leave the rest of the entry alone; the human reads it to verify.

Don't delete resolved comments — the human reviews them.

## The deck schema (what you may put in \`deck.json\`)

\`\`\`
Deck {
  version: 1                       // always 1
  title: string
  size: { w: number, h: number }   // pixels; default 1280×720
  theme: { fontFamily: string, palette: Record<string,Color> }
  slides: Slide[]
}

Slide {
  id: string                       // stable across edits
  title?: string
  background?: { fill?: Color }
  elements: Element[]              // z-order = array order (first = back)
  notes?: string
}

Element = TextElement | ShapeElement | ImageElement | TableElement | GroupElement

Geometry (on every element): { x, y, w, h, rotation? }  // pixels, deck coords
BaseStyle: { fill?, stroke?, strokeWidth?, opacity?,
             shadow?: { offsetX, offsetY, blur, color, opacity } }
\`\`\`

### Allowed element \`type\` values
\`text\` · \`shape\` · \`image\` · \`table\` · \`group\` — **nothing else.**

### Allowed \`shapeKind\` values (on \`type: "shape"\`)

- **Basic:** \`rect\`, \`roundedRect\`, \`ellipse\`, \`triangle\`, \`rightTriangle\`,
  \`diamond\`, \`parallelogram\`, \`trapezoid\`, \`pentagon\`, \`hexagon\`, \`octagon\`,
  \`star4\`, \`star5\`, \`star6\`, \`heart\`, \`cloud\`, \`plus\`
- **Arrows:** \`arrowRight\`, \`arrowLeft\`, \`arrowUp\`, \`arrowDown\`, \`arrowDouble\`
- **Callouts:** \`speechRect\`, \`speechEllipse\`
- **Flowchart:** \`flowProcess\`, \`flowDecision\`, \`flowTerminator\`, \`flowData\`
- **Lines:** \`line\`, \`arrow\`, \`curveQuad\`

For lines/arrows, end-caps come from \`style.arrowStart\` / \`style.arrowEnd\`.
For \`curveQuad\`, the bend is \`style.controlX\` / \`style.controlY\`.
For \`roundedRect\` and images, corner rounding is \`style.radius\`.

### Text elements

\`content\` is a TipTap-style doc:

\`\`\`
{ type: "doc",
  content: [
    { type: "paragraph",
      content: [
        { type: "text", text: "Hello ",
          marks: [{ type: "bold" }] },
        { type: "text", text: "world",
          marks: [{ type: "textStyle",
                    attrs: { color: "#FF0066", fontSize: 48,
                             fontFamily: "Inter", fontWeight: 700 } }] }
      ]
    }
  ]
}
\`\`\`

Allowed mark types: \`bold\`, \`italic\`, \`underline\`, \`strike\`, \`code\`,
\`superscript\`, \`subscript\`, \`textStyle\` (color/font/size/weight/line-height/
letter-spacing), \`highlight\` (color).

\`style.align\`: \`left\` | \`center\` | \`right\` | \`justify\`.
\`style.verticalAlign\`: \`top\` | \`middle\` | \`bottom\`.

### Image elements
\`src\` is either a path under \`assets/\` (e.g. \`"assets/abc.png"\`) or an
absolute URL. \`fit\`: \`contain\` | \`cover\` | \`fill\`. To add a new image,
drop the file into \`assets/\` and reference it.

### Table elements
\`rows\`, \`cols\`, and a \`cells: TextCell[rows][cols]\` matrix. Each cell's
\`content\` follows the same TipTap doc shape as text elements.

## Editing rules

- Edit \`deck.json\` directly with your file tools. The running editor live-reloads.
- Every element has a stable \`id\`. **Reuse existing ids when you edit;** generate
  a new short id (any unique string) when you add an element. Don't renumber.
- Z-order is array order in \`slide.elements\` — first element is at the back.
- Keep \`version: 1\`.

## The "definition of done" for any visual change

1. Edit \`deck.json\`.
2. Run \`minerva render <slide-id>\`.
3. Read the PNG.
4. If it doesn't match the human's request, revise and repeat.

Don't claim a change is done before step 3.
`;
}

async function cmdServe(dir: string, port: number, openBrowser: boolean) {
  const root = resolve(dir);
  if (!existsSync(join(root, "deck.json"))) {
    console.error(`no deck.json found in ${root}. run 'minerva init' or 'minerva start' first.`);
    process.exit(1);
  }
  await startServer({ root, port });
  if (openBrowser) await openInBrowser(`http://localhost:${port}`);
}

async function cmdStart(dir: string, port: number, openBrowser: boolean) {
  cmdInit(dir, { idempotent: true, refreshGuide: true });
  await cmdServe(dir, port, openBrowser);
}

async function openInBrowser(url: string) {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    /* opening is best-effort; the URL is already logged */
  }
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

type ServeArgs = { dir: string; port: number; openBrowser: boolean };

function parseServeArgs(argv: string[], from: number): ServeArgs {
  let port = 5174;
  let dir = ".";
  let openBrowser = true;
  for (let i = from; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") port = parseInt(argv[++i] ?? "5174", 10);
    else if (a === "--no-open") openBrowser = false;
    else if (a === "--open") openBrowser = true;
    else if (!a.startsWith("--")) dir = a;
  }
  return { dir, port, openBrowser };
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
    const { dir, port, openBrowser } = parseServeArgs(argv, 1);
    await cmdServe(dir, port, openBrowser);
    return;
  }
  if (cmd === "start") {
    const { dir, port, openBrowser } = parseServeArgs(argv, 1);
    await cmdStart(dir, port, openBrowser);
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
