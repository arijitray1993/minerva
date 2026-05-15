#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { emptyDeck } from "@minerva/schema";
import { startServer } from "./server.js";

function usage(): never {
  console.log(`minerva — Google Slides-like editor with a Claude collaborator

Usage:
  minerva init [dir]           Scaffold a new deck in [dir] (default: current dir)
  minerva serve [dir] [--port N]
                               Start the editor server on the deck in [dir]
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

## How you should edit

- Edit \`deck.json\` directly with your file tools. The running editor live-reloads.
- Every element has a stable \`id\`. Reuse existing ids when you edit; generate new
  short ids when you add elements (any unique string is fine).
- Keep the \`version\` field at 1.
- When you resolve a comment in \`comments.json\`, set its \`status\` to \`"resolved"\`
  and stamp \`resolvedAt\` with the current ISO time.

## Deck shape (summary)

\`\`\`
Deck { version: 1, title, size {w,h}, theme, slides: Slide[] }
Slide { id, background?, elements: Element[], notes? }
Element = TextElement | ShapeElement | ImageElement | GroupElement
\`\`\`

See \`packages/schema/src/index.ts\` for the full type definitions.
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
  console.error(`unknown command: ${cmd}`);
  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
