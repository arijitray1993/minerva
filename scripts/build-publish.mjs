#!/usr/bin/env node
// Build the publishable layout for `minerva-slides`:
//
//   dist/cli.js     — esbuild bundle of the server CLI (schema + zod inlined,
//                     heavy/native deps externalized to root node_modules)
//   web-dist/       — built Vite app, served as static files by the CLI
//
// The workspace package.jsons stay as the source of truth for dev; this script
// just stitches their build outputs into a single npm-installable tree.

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync, chmodSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function step(msg) {
  process.stdout.write(`• ${msg}\n`);
}

step("building workspaces (tsc + vite)");
execSync("npm run build --workspaces --if-present", { stdio: "inherit", cwd: ROOT });

const webDistSrc = resolve(ROOT, "packages/web/dist");
if (!existsSync(webDistSrc)) {
  throw new Error(`expected ${webDistSrc} after workspace build`);
}

step("bundling CLI with esbuild");
const distDir = resolve(ROOT, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [resolve(ROOT, "packages/server/src/cli.ts")],
  outfile: resolve(distDir, "cli.js"),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  // Externalize anything with native bindings or non-trivial install behavior.
  // zod is bundled (pure JS, small) so users don't need it transitively.
  external: ["express", "multer", "chokidar", "ws", "playwright-core", "open"],
  // cli.ts source already begins with a hashbang; esbuild preserves it.
  logLevel: "info",
});

chmodSync(resolve(distDir, "cli.js"), 0o755);

step("copying web build to web-dist/");
const webDistDest = resolve(ROOT, "web-dist");
rmSync(webDistDest, { recursive: true, force: true });
cpSync(webDistSrc, webDistDest, { recursive: true });

step("publishable layout:");
process.stdout.write("    dist/cli.js\n");
process.stdout.write("    web-dist/\n");
