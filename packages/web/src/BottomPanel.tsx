import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { CommentsHistory } from "./CommentsHistory";
import { TerminalPane, type TerminalHandle } from "./TerminalPane";

type Tab = "comments" | "terminal";

/** Bottom dock with two tabs:
 *  - Comments: full history + reopen.
 *  - Terminal: embedded shell rooted in the deck folder for running `claude`.
 *  Also hosts a "Start working on comments" action that types a prompt into
 *  the terminal so the user doesn't have to leave the editor. */
export function BottomPanel() {
  const [tab, setTab] = useState<Tab>("comments");
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(320);
  const allComments = useStore((s) => s.comments);
  const openCount = allComments.filter((c) => c.status !== "resolved").length;
  const termRef = useRef<TerminalHandle>(null);
  const draggingRef = useRef(false);

  // Drag the top edge to resize. We use document-level listeners so the drag
  // doesn't get lost when the pointer moves over the canvas/iframes.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.max(120, Math.min(window.innerHeight - 120, window.innerHeight - e.clientY));
      setHeight(next);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startWorkingOnComments = () => {
    // Switch to the terminal tab so the user sees Claude's response stream.
    setTab("terminal");
    setCollapsed(false);
    // Defer until after the tab swap renders so the terminal pane is visible
    // and its fit pass has run.
    requestAnimationFrame(() => {
      // Trailing \r submits the line as if the user hit Enter.
      const prompt =
        "Read comments.json and address every comment with status \"open\". " +
        "For each one, find the targetIds in deck.json, make the requested change, " +
        "then set status to \"resolved\" and stamp resolvedAt with the current ISO timestamp.";
      termRef.current?.send(prompt + "\r");
    });
  };

  return (
    <div
      className={`bottom-panel ${collapsed ? "collapsed" : ""}`}
      style={collapsed ? undefined : { height }}
    >
      {!collapsed && (
        <div
          className="bottom-panel-resizer"
          onMouseDown={(e) => { e.preventDefault(); draggingRef.current = true; }}
          title="Drag to resize"
        />
      )}
      <div className="bottom-panel-tabs">
        <button
          className={tab === "comments" ? "active" : ""}
          onClick={() => { setTab("comments"); setCollapsed(false); }}
        >
          Comments{openCount > 0 ? ` · ${openCount} open` : ""}
        </button>
        <button
          className={tab === "terminal" ? "active" : ""}
          onClick={() => { setTab("terminal"); setCollapsed(false); }}
        >
          Terminal
        </button>
        <div className="bottom-panel-tabs-spacer" />
        {openCount > 0 && (
          <button
            className="bottom-panel-action"
            onClick={startWorkingOnComments}
            title="Type a prompt into the terminal asking Claude to work through every open comment"
          >
            ▶ Start working on {openCount} comment{openCount === 1 ? "" : "s"}
          </button>
        )}
        <button
          className="bottom-panel-collapse"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {!collapsed && (
        <div className="bottom-panel-body">
          <div style={{ display: tab === "comments" ? "block" : "none", height: "100%", overflow: "auto" }}>
            <CommentsHistory />
          </div>
          {/* Mount the terminal always so its WS + scrollback survive tab toggles;
              just toggle display: none when on the other tab. */}
          <div style={{ display: tab === "terminal" ? "block" : "none", height: "100%" }}>
            <TerminalPane ref={termRef} visible={tab === "terminal" && !collapsed} />
          </div>
        </div>
      )}
    </div>
  );
}
