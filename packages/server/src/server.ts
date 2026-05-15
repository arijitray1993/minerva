import express, { type Request, type Response } from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import multer from "multer";
import { Deck, Comments } from "@minerva/schema";
import { exportDeckPdf } from "./pdf.js";

type ServerOptions = { root: string; port: number };

export async function startServer({ root, port }: ServerOptions) {
  const deckPath = join(root, "deck.json");
  const commentsPath = join(root, "comments.json");
  const assetsDir = join(root, "assets");
  await mkdir(assetsDir, { recursive: true });

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // --- API: deck read/write ---------------------------------------------------
  app.get("/api/deck", async (_req, res) => {
    const raw = await readFile(deckPath, "utf8");
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
        baseUrl: `http://localhost:${port}`,
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

  // --- Static UI (served from the built web package in production) -----------
  const webDist = resolve(root, "../web/dist"); // fallback for dev
  const packagedWeb = resolve(__dirnameSafe(), "../../web/dist");
  const staticDir = existsSync(packagedWeb) ? packagedWeb : (existsSync(webDist) ? webDist : null);
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get("*", (_req, res) => res.sendFile(join(staticDir, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res
        .type("text/plain")
        .send("UI bundle not found. Build packages/web first (npm run build -w @minerva/web).")
    );
  }

  // --- HTTP + WebSocket -------------------------------------------------------
  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: "/ws" });
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

  await new Promise<void>((r) => http.listen(port, r));
  console.log(`minerva: editing ${deckPath}`);
  console.log(`minerva: open http://localhost:${port}`);
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
