import { useStore } from "./store";
import type { DeckT, CommentT } from "@minerva/schema";

let saveTimer: number | null = null;
let lastSavedJson = "";

export async function loadDeck(): Promise<void> {
  const r = await fetch("/api/deck");
  if (!r.ok) throw new Error(`load deck failed: ${r.status}`);
  const deck = (await r.json()) as DeckT;
  lastSavedJson = JSON.stringify(deck);
  useStore.getState().setDeck(deck, true);
}

export function watchAndSave() {
  useStore.subscribe((state, prev) => {
    if (state.applyingRemote) return;
    if (!state.deck) return;
    if (state.deck === prev.deck) return;
    scheduleSave();
  });
}

/**
 * Last-chance save on page unload — for the case where the user refreshes (or
 * closes the tab) before our debounced save has fired. Flushes the in-flight
 * TipTap editor content into the store first, then PUTs the deck with
 * `keepalive: true` so the request survives the unload.
 */
export function setupBeforeUnloadSave() {
  window.addEventListener("beforeunload", () => {
    const s = useStore.getState();
    // Flush any pending TipTap edits into the deck state synchronously.
    if (s.flushActiveEditor) {
      try { s.flushActiveEditor(); } catch { /* best-effort */ }
    }
    const deck = useStore.getState().deck;
    if (!deck) return;
    const json = JSON.stringify(deck);
    if (json === lastSavedJson) return;
    try {
      fetch("/api/deck", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true,
      });
      lastSavedJson = json;
    } catch {
      /* unload-time errors are unrecoverable; swallow */
    }
  });
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  // Tight debounce so a single change → save fires on the next animation
  // frame, not 300 ms later. The user shouldn't have to wait for an idle
  // window to know their edit is on disk.
  saveTimer = window.setTimeout(saveNow, 40);
}

export async function saveNow() {
  const { deck } = useStore.getState();
  if (!deck) return;
  const json = JSON.stringify(deck);
  if (json === lastSavedJson) return;
  try {
    const r = await fetch("/api/deck", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: json,
    });
    if (!r.ok) {
      // Surface validation failures — silent rejects produced the "edits
      // disappear on refresh" class of bug.
      console.error("save failed", r.status, await r.text());
      return;
    }
    lastSavedJson = json;
  } catch (err) {
    console.error("save error", err);
  }
}

export function connectWebsocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.kind === "deck" && msg.source === "external") {
        await loadDeck();
      } else if (msg.kind === "comments") {
        // Reload regardless of source so the human sees Claude's status flips
        // (open → in_progress → resolved) live, and also picks up their own
        // edits made from another tab.
        await loadComments();
      }
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    setTimeout(connectWebsocket, 1500);
  };
}

export async function loadComments(): Promise<void> {
  const r = await fetch("/api/comments");
  if (!r.ok) return;
  const body = (await r.json()) as { comments: CommentT[] };
  useStore.getState().setComments(body.comments ?? []);
}

async function putComments(comments: CommentT[]): Promise<void> {
  const r = await fetch("/api/comments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments }),
  });
  if (!r.ok) throw new Error(`comments PUT failed: ${r.status}`);
  // Update store optimistically — the WS broadcast will arrive a moment later
  // and overwrite with the canonical disk content, which is fine.
  useStore.getState().setComments(comments);
}

export async function submitClaudeComment(c: {
  slideId: string;
  targetIds: string[];
  request: string;
}): Promise<void> {
  const cur = useStore.getState().comments;
  const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const newComment: CommentT = {
    id,
    slideId: c.slideId,
    targetIds: c.targetIds,
    author: "human",
    request: c.request,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  await putComments([...cur, newComment]);
}

export async function setCommentStatus(id: string, status: CommentT["status"]): Promise<void> {
  const cur = useStore.getState().comments;
  const next = cur.map((c) => {
    if (c.id !== id) return c;
    const nextC: CommentT = { ...c, status };
    if (status === "resolved") nextC.resolvedAt = new Date().toISOString();
    else delete (nextC as any).resolvedAt;
    return nextC;
  });
  await putComments(next);
}

export async function uploadAsset(file: File | Blob, filename?: string): Promise<{ path: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file, filename ?? (file instanceof File ? file.name : "image.png"));
  const r = await fetch("/api/assets", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return r.json();
}
