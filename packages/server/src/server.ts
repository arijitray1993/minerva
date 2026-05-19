import express, { type Request, type Response } from "express";
import { createServer } from "node:http";
import net from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import multer from "multer";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodePty from "node-pty";
import { Deck, Comments } from "@minerva/schema";
import { exportDeckPdf, renderSlidePng } from "./pdf.js";

/** node-pty 1.x ships a `spawn-helper` binary that npm sometimes extracts
 *  without the executable bit on macOS, which makes `posix_spawnp failed` on
 *  the first `pty.spawn`. Re-chmod it ourselves so a fresh clone-install just
 *  works without "now also run chmod ...". Idempotent and silent if missing. */
function ensurePtyHelperExecutable() {
  try {
    // Resolve relative to node-pty's package.json so monorepo hoisting and
    // global installs both land us in the right tree. We're in ESM so we
    // synthesize a require to use require.resolve.
    const req = createRequire(import.meta.url);
    const ptyPkg = req.resolve("node-pty/package.json");
    const ptyDir = ptyPkg.replace(/\/package\.json$/, "");
    for (const arch of ["darwin-arm64", "darwin-x64"]) {
      try { chmodSync(`${ptyDir}/prebuilds/${arch}/spawn-helper`, 0o755); } catch { /* not present on this platform */ }
    }
  } catch { /* node-pty not installed for some reason — terminal will be disabled */ }
}

/**
 * Find the first port at or after `start` that nothing is currently bound to.
 * Used so two decks can run side-by-side without the second one failing on
 * EADDRINUSE — the second instance just walks past 5174 to 5175, etc.
 */
export async function findFreePort(start: number, maxTries = 50): Promise<number> {
  // Bind without a host so the probe matches http.listen()'s default
  // (dual-stack on Node). Probing only 127.0.0.1 here gives false positives
  // when another process is bound to :: on the same port.
  for (let p = start; p < start + maxTries; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p);
    });
    if (free) return p;
  }
  throw new Error(`no free port found in [${start}, ${start + maxTries})`);
}

type ServerOptions = {
  root: string;
  /** Port to listen on. If `strictPort` is false (the default), this is just
   *  the starting point — the server walks forward until it finds a free port. */
  port: number;
  /** If true, fail rather than walk forward. Used when the user passed --port. */
  strictPort?: boolean;
};

export async function startServer({ root, port, strictPort = false }: ServerOptions): Promise<number> {
  ensurePtyHelperExecutable();
  // Resolve the actual port up front so route handlers (PDF, PNG render) can
  // capture it in their closures and use the same baseUrl the browser uses.
  const chosenPort = strictPort ? port : await findFreePort(port);

  const deckPath = join(root, "deck.json");
  const commentsPath = join(root, "comments.json");
  const assetsDir = join(root, "assets");
  await mkdir(assetsDir, { recursive: true });

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // --- API: deck read/write ---------------------------------------------------
  app.get("/api/deck", async (_req, res) => {
    const raw = await readFile(deckPath, "utf8");
    // Belt-and-suspenders: the deck file changes on every edit; we don't want
    // a browser to ever serve a stale cached copy on refresh, since that
    // looks identical to "the edit wasn't saved" from the user's side.
    res.set("Cache-Control", "no-store");
    res.type("application/json").send(raw);
  });

  // Track the last hash we wrote so we can suppress our own watcher echo.
  let lastWrittenHash = "";
  function hash(s: string) {
    return createHash("sha256").update(s).digest("hex");
  }

  app.put("/api/deck", async (req: Request, res: Response) => {
    const parsed = Deck.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid deck", issues: parsed.error.issues });
      return;
    }
    const out = JSON.stringify(parsed.data, null, 2) + "\n";
    lastWrittenHash = hash(out);
    await writeFile(deckPath, out, "utf8");
    res.json({ ok: true });
    broadcast({ kind: "deck", source: "human" });
  });

  // --- API: comments ----------------------------------------------------------
  app.get("/api/comments", async (_req, res) => {
    if (!existsSync(commentsPath)) {
      res.json({ comments: [] });
      return;
    }
    const raw = await readFile(commentsPath, "utf8");
    res.type("application/json").send(raw);
  });

  app.put("/api/comments", async (req, res) => {
    const parsed = Comments.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid comments", issues: parsed.error.issues });
      return;
    }
    const out = JSON.stringify(parsed.data, null, 2) + "\n";
    lastCommentsHash = hash(out);
    await writeFile(commentsPath, out, "utf8");
    res.json({ ok: true });
    broadcast({ kind: "comments", source: "human" });
  });

  // --- API: assets (upload + paste + drag-drop converge here) ----------------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  app.post("/api/assets", upload.single("file"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "no file uploaded" });
      return;
    }
    const buf = req.file.buffer;
    const ext = extOfMime(req.file.mimetype) ?? (req.file.originalname ? extname(req.file.originalname) : ".bin");
    const h = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const filename = `${h}${ext}`;
    const dest = join(assetsDir, filename);
    if (!existsSync(dest)) {
      await writeFile(dest, buf);
    }
    res.json({ path: `assets/${filename}`, url: `/assets/${filename}` });
  });

  app.use("/assets", express.static(assetsDir));

  // --- API: PDF export -------------------------------------------------------
  app.get("/api/export/pdf", async (_req, res) => {
    try {
      const raw = await readFile(deckPath, "utf8");
      const deck = Deck.parse(JSON.parse(raw));
      const pdf = await exportDeckPdf({
        baseUrl: `http://localhost:${chosenPort}`,
        deckSize: deck.size,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${(deck.title || "deck").replace(/[^a-z0-9-_ ]/gi, "")}.pdf"`);
      res.send(pdf);
    } catch (err) {
      console.error("pdf export failed", err);
      res.status(500).type("text/plain").send((err as Error).message);
    }
  });

  // --- API: PNG render (Claude's visual feedback loop) ----------------------
  app.get("/api/render/png", async (req, res) => {
    try {
      const raw = await readFile(deckPath, "utf8");
      const deck = Deck.parse(JSON.parse(raw));
      const slideId = typeof req.query.slide === "string" ? req.query.slide : deck.slides[0]?.id;
      if (!slideId || !deck.slides.some((s) => s.id === slideId)) {
        res.status(404).type("text/plain").send(`no slide with id "${slideId}"`);
        return;
      }
      const png = await renderSlidePng({
        baseUrl: `http://localhost:${chosenPort}`,
        deckSize: deck.size,
        slideId,
      });
      res.setHeader("Content-Type", "image/png");
      res.send(png);
    } catch (err) {
      console.error("png render failed", err);
      res.status(500).type("text/plain").send((err as Error).message);
    }
  });

  // --- Static UI (served from the built web package) -------------------------
  // Search in both layouts:
  //   - Bundled (npm-installed):  <pkg>/dist/cli.js  →  <pkg>/web-dist
  //   - Monorepo dev:             <repo>/packages/server/dist/cli.js
  //                                       →  <repo>/packages/web/dist
  const here = __dirnameSafe();
  const candidates = [
    resolve(here, "../web-dist"),
    resolve(here, "../../web/dist"),
    resolve(here, "../../../packages/web/dist"),
  ];
  const staticDir = candidates.find((p) => existsSync(p)) ?? null;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get("*", (_req, res) => res.sendFile(join(staticDir, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res
        .type("text/plain")
        .send("Minerva UI bundle not found. If you're developing locally, run `npm run build` from the repo root.")
    );
  }

  // --- HTTP + WebSocket -------------------------------------------------------
  // Two WS endpoints share the same HTTP server: /ws for deck/comment broadcasts
  // and /term for the embedded pty. The `ws` library only lets one
  // WebSocketServer auto-claim upgrades from a given HTTP server, so we use
  // noServer:true on both and route upgrades manually by request URL.
  const http = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const termWss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url === "/ws" || url.startsWith("/ws?")) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else if (url === "/term" || url.startsWith("/term?")) {
      termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  function broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(s);
    }
  }

  // --- Terminal WebSocket ----------------------------------------------------
  // Embedded shell so the user doesn't have to alt-tab to a real terminal to
  // run `claude`. Each connection spawns its own pty rooted in the deck folder.
  // Protocol:
  //   server → client: raw bytes from the pty (sent as a binary frame so we
  //     don't have to escape anything).
  //   client → server: JSON frames {kind:"data", data: string}
  //                                {kind:"resize", cols, rows}
  // Routed by the shared upgrade dispatcher above (noServer:true).
  termWss.on("connection", (ws) => {
    const shell = process.env.SHELL || "/bin/bash";
    let pty: nodePty.IPty;
    try {
      pty = nodePty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: root,
        // Pass the live env so the user's PATH / aliases / Claude API key are
        // there. We deliberately don't sanitize — same trust model as a local
        // shell.
        env: process.env as { [k: string]: string },
      });
    } catch (err) {
      ws.send(`failed to spawn shell: ${(err as Error).message}\r\n`);
      ws.close();
      return;
    }
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    pty.onExit(({ exitCode }) => {
      try { ws.send(`\r\n[shell exited with code ${exitCode}]\r\n`); } catch { /* ws may already be closing */ }
      try { ws.close(); } catch { /* ignore */ }
    });
    ws.on("message", (raw) => {
      // Frames arrive as Buffer; parse as JSON. Anything that doesn't parse
      // is treated as a stray byte and ignored.
      let msg: { kind?: string; data?: string; cols?: number; rows?: number };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.kind === "data" && typeof msg.data === "string") {
        pty.write(msg.data);
      } else if (msg.kind === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        try { pty.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0)); } catch { /* invalid sizes are non-fatal */ }
      }
    });
    ws.on("close", () => {
      try { pty.kill(); } catch { /* already dead */ }
    });
  });

  // --- Watch files for external (e.g. Claude) edits --------------------------
  let lastCommentsHash = "";
  const watcher = chokidar.watch([deckPath, commentsPath], { ignoreInitial: true });
  watcher.on("change", async (path) => {
    try {
      const raw = await readFile(path, "utf8");
      if (path === deckPath) {
        if (hash(raw) === lastWrittenHash) return; // echo of our own write
        broadcast({ kind: "deck", source: "external" });
      } else if (path === commentsPath) {
        if (hash(raw) === lastCommentsHash) return;
        broadcast({ kind: "comments", source: "external" });
      }
    } catch {
      /* file may be mid-write; next event will catch up */
    }
  });

  await new Promise<void>((r) => http.listen(chosenPort, r));

  // Drop a tiny pid+port record so `minerva render` (or any other tool) can
  // find this server without having to be told the port. Best-effort only.
  try {
    const minervaDir = join(root, ".minerva");
    await mkdir(minervaDir, { recursive: true });
    await writeFile(
      join(minervaDir, "server.json"),
      JSON.stringify({ port: chosenPort, pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch {
    /* not fatal — render will fall back to the default port */
  }

  console.log(`minerva: editing ${deckPath}`);
  console.log(`minerva: open http://localhost:${chosenPort}`);
  return chosenPort;
}

function extOfMime(mime: string): string | undefined {
  switch (mime) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/svg+xml": return ".svg";
    default: return undefined;
  }
}

function __dirnameSafe(): string {
  // ESM-safe __dirname
  const u = new URL(".", import.meta.url);
  return u.pathname;
}
