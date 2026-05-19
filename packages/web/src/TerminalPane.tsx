import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export type TerminalHandle = {
  /** Write text into the embedded shell's stdin (so the user sees it on the
   *  terminal). Used by "Start working on all comments" to seed a prompt. */
  send: (text: string) => void;
  /** Recompute size and notify the pty. Called by the layout when the panel
   *  resizes (height splitter drag, tab show). */
  fit: () => void;
};

/** xterm.js wired to `/term` for the embedded shell. The handle exposes
 *  `send()` so other components can stuff text into the prompt without
 *  monkey-patching the terminal. */
export const TerminalPane = forwardRef<TerminalHandle, { visible: boolean }>(
  function TerminalPane({ visible }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
      if (!hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 13,
        theme: {
          background: "#0e0f12",
          foreground: "#e6e6e6",
          cursor: "#e6e6e6",
        },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      // Initial fit deferred until after the host has its real dimensions.
      requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* host may not be visible yet */ }
      });

      // Connect to the server's pty bridge.
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/term`);
      wsRef.current = ws;
      // Send initial size once the socket opens so the pty matches the
      // visible terminal dimensions.
      ws.onopen = () => {
        try { fit.fit(); } catch { /* ignore */ }
        sendResize();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") term.write(ev.data);
        else if (ev.data instanceof Blob) {
          ev.data.text().then((t) => term.write(t));
        } else if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data) as any);
        }
      };
      ws.onclose = () => {
        term.write("\r\n[terminal disconnected]\r\n");
      };

      const sendResize = () => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify({ kind: "resize", cols: term.cols, rows: term.rows }));
      };
      term.onData((data) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify({ kind: "data", data }));
      });
      // Refit on host element resize and forward the new dimensions.
      const ro = new ResizeObserver(() => {
        try { fit.fit(); sendResize(); } catch { /* ignore */ }
      });
      ro.observe(hostRef.current);

      return () => {
        ro.disconnect();
        try { ws.close(); } catch { /* ignore */ }
        try { term.dispose(); } catch { /* ignore */ }
        termRef.current = null;
        fitRef.current = null;
      };
    }, []);

    // When the panel becomes visible (tab switch, expand from collapsed),
    // xterm needs a fit pass because ResizeObserver may have missed it.
    useEffect(() => {
      if (!visible) return;
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          if (wsRef.current?.readyState === WebSocket.OPEN && termRef.current) {
            wsRef.current.send(JSON.stringify({
              kind: "resize", cols: termRef.current.cols, rows: termRef.current.rows,
            }));
          }
        } catch { /* ignore */ }
      });
    }, [visible]);

    useImperativeHandle(ref, () => ({
      send: (text: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ kind: "data", data: text }));
      },
      fit: () => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      },
    }), []);

    return <div ref={hostRef} className="terminal-pane-host" />;
  }
);
