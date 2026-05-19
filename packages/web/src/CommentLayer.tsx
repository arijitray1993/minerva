import { useEffect, useState } from "react";
import type { CommentT, ElementT, SlideT } from "@minerva/schema";
import { useStore } from "./store";
import { setCommentStatus } from "./sync";

type Props = {
  slide: SlideT;
  /** Canvas-area screen offset of slide origin. */
  offset: { x: number; y: number };
  /** Visual scale (px-per-slide-unit). */
  scale: number;
};

/** Inline comment markers + popover tile. Reads `comments` from the store and
 *  renders an indicator at the top-right of each open comment's first target;
 *  clicking the indicator opens a Google-Slides-style tile with the request
 *  text, metadata, and a Resolve button. Resolved comments don't render here —
 *  they live in the history tab. */
export function CommentLayer({ slide, offset, scale }: Props) {
  const allComments = useStore((s) => s.comments);
  const [open, setOpen] = useState<string | null>(null);

  // Open comments for this slide only.
  const comments = allComments.filter(
    (c) => c.slideId === slide.id && c.status !== "resolved",
  );

  // Clicks outside the tile and outside the markers close any open tile. We
  // use the capture phase so we win even if the user clicks something that
  // would otherwise stop propagation.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".comment-tile")) return;
      if (t.closest(".comment-marker")) return;
      setOpen(null);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [open]);

  if (comments.length === 0) return null;

  return (
    <>
      {comments.map((c) => {
        const anchor = firstTargetBBox(c, slide);
        if (!anchor) return null;
        // Marker sits just past the element's top-right corner.
        const screenX = offset.x + (anchor.x + anchor.w) * scale;
        const screenY = offset.y + anchor.y * scale;
        return (
          <button
            key={c.id}
            type="button"
            className={`comment-marker ${open === c.id ? "open" : ""} ${c.status}`}
            style={{ position: "absolute", left: screenX - 12, top: screenY - 12, zIndex: 95 }}
            onClick={() => setOpen((cur) => (cur === c.id ? null : c.id))}
            title={c.request.slice(0, 80)}
          >
            💬
          </button>
        );
      })}
      {open && (() => {
        const c = comments.find((x) => x.id === open);
        if (!c) return null;
        const anchor = firstTargetBBox(c, slide);
        if (!anchor) return null;
        const screenX = offset.x + (anchor.x + anchor.w) * scale;
        const screenY = offset.y + anchor.y * scale;
        return <CommentTile comment={c} x={screenX} y={screenY} onClose={() => setOpen(null)} />;
      })()}
    </>
  );
}

function CommentTile({ comment: c, x, y, onClose }: { comment: CommentT; x: number; y: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const author = c.author === "claude" ? "Claude" : "You";
  const when = new Date(c.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const resolve = async () => {
    setBusy(true);
    try {
      await setCommentStatus(c.id, "resolved");
      onClose();
    } catch (err) {
      alert(`Failed to resolve: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  // Flare right of the marker, flip to the left if it would clip the viewport.
  const W = 280;
  const flip = x + 24 + W > window.innerWidth;
  const left = flip ? x - 24 - W : x + 16;
  const top = Math.max(8, Math.min(y - 8, window.innerHeight - 220));
  return (
    <div className="comment-tile" style={{ position: "absolute", left, top, width: W, zIndex: 96 }}>
      <div className="comment-tile-header">
        <span className="comment-tile-author">{author}</span>
        <span className="comment-tile-when">{when}</span>
      </div>
      <div className="comment-tile-body">{c.request}</div>
      {c.status === "in_progress" && (
        <div className="comment-tile-status">⏳ Claude is working on this…</div>
      )}
      <div className="comment-tile-actions">
        <button onClick={onClose} disabled={busy}>Close</button>
        <button onClick={resolve} disabled={busy} className="primary">
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
    </div>
  );
}

/** First-target bounding box in slide coords. Returns null if the comment's
 *  targets are all stale (element was deleted). Normalizes negative w/h that
 *  arise for line/arrow elements drawn up-and-left. */
function firstTargetBBox(c: CommentT, slide: SlideT): { x: number; y: number; w: number; h: number } | null {
  for (const id of c.targetIds) {
    const el = findElementById(slide.elements, id);
    if (!el) continue;
    const x = el.w < 0 ? el.x + el.w : el.x;
    const y = el.h < 0 ? el.y + el.h : el.y;
    return { x, y, w: Math.abs(el.w), h: Math.abs(el.h) };
  }
  return null;
}

function findElementById(els: ElementT[], id: string): ElementT | undefined {
  for (const el of els) {
    if (el.id === id) return el;
    if (el.type === "group") {
      const inner = findElementById(el.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}
