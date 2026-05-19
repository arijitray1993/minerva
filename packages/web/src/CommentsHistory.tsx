import { useState } from "react";
import type { CommentT } from "@minerva/schema";
import { useStore } from "./store";
import { setCommentStatus } from "./sync";

/** Bottom-panel "Comments" tab. Lists every comment Claude has touched
 *  (resolved or in-progress) plus a quick view of any open ones, so the human
 *  has a single audit trail. Reopen flips a resolved comment back to open
 *  so the marker reappears on the canvas. */
export function CommentsHistory() {
  const allComments = useStore((s) => s.comments);
  const setCurrentSlide = useStore((s) => s.setCurrentSlide);
  const setSelection = useStore((s) => s.setSelection);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Newest first.
  const sorted = [...allComments].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );

  const open = sorted.filter((c) => c.status !== "resolved");
  const resolved = sorted.filter((c) => c.status === "resolved");

  const jumpTo = (c: CommentT) => {
    setCurrentSlide(c.slideId);
    setSelection(c.targetIds);
  };

  const flip = async (c: CommentT, next: CommentT["status"]) => {
    setBusyId(c.id);
    try {
      await setCommentStatus(c.id, next);
    } catch (err) {
      alert(`Failed to update comment: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="comments-history">
      {open.length === 0 && resolved.length === 0 && (
        <div className="comments-history-empty">
          No comments yet. Right-click any element on the canvas → "Leave Claude comment…".
        </div>
      )}
      {open.length > 0 && (
        <Section title={`Open (${open.length})`}>
          {open.map((c) => (
            <Row
              key={c.id}
              c={c}
              busy={busyId === c.id}
              onJump={() => jumpTo(c)}
              actions={
                <button onClick={() => flip(c, "resolved")} disabled={busyId === c.id}>
                  Resolve
                </button>
              }
            />
          ))}
        </Section>
      )}
      {resolved.length > 0 && (
        <Section title={`Resolved (${resolved.length})`}>
          {resolved.map((c) => (
            <Row
              key={c.id}
              c={c}
              busy={busyId === c.id}
              onJump={() => jumpTo(c)}
              actions={
                <button onClick={() => flip(c, "open")} disabled={busyId === c.id}>
                  Reopen
                </button>
              }
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="comments-history-section">
      <div className="comments-history-section-title">{title}</div>
      <div className="comments-history-rows">{children}</div>
    </div>
  );
}

function Row({
  c,
  busy,
  onJump,
  actions,
}: {
  c: CommentT;
  busy: boolean;
  onJump: () => void;
  actions: React.ReactNode;
}) {
  const when = new Date(c.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className={`comments-history-row ${c.status} ${busy ? "busy" : ""}`}>
      <div className="comments-history-row-meta">
        <span className="comments-history-row-author">{c.author === "claude" ? "Claude" : "You"}</span>
        <span className="comments-history-row-when">{when}</span>
        <span className={`comments-history-row-status ${c.status}`}>{c.status.replace("_", " ")}</span>
      </div>
      <div className="comments-history-row-body" onClick={onJump} title="Jump to commented element">
        {c.request}
      </div>
      <div className="comments-history-row-actions">{actions}</div>
    </div>
  );
}
