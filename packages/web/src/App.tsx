import { useEffect } from "react";
import { useStore, findSlide } from "./store";
import { connectWebsocket, loadDeck, uploadAsset, watchAndSave } from "./sync";
import { SlideCanvas } from "./SlideCanvas";
import { Inspector } from "./Inspector";
import { SlidesSidebar } from "./SlidesSidebar";
import { Toolbar } from "./Toolbar";
import type { ElementT } from "@minerva/schema";

export function App() {
  const deck = useStore((s) => s.deck);
  const currentSlideId = useStore((s) => s.currentSlideId);
  const addElement = useStore((s) => s.addElement);
  const removeElement = useStore((s) => s.removeElement);
  const selectedIds = useStore((s) => s.selectedIds);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const formatToPaint = useStore((s) => s.formatToPaint);
  const applyFormatFromSource = useStore((s) => s.applyFormatFromSource);
  const setFormatToPaint = useStore((s) => s.setFormatToPaint);

  // Format painter: when armed, apply on next single-element selection that
  // isn't the source itself.
  useEffect(() => {
    if (!formatToPaint || !currentSlideId) return;
    if (selectedIds.length !== 1) return;
    if (selectedIds[0] === formatToPaint.sourceId) return;
    applyFormatFromSource(currentSlideId, selectedIds[0]);
  }, [selectedIds, formatToPaint, currentSlideId, applyFormatFromSource]);

  // Escape cancels the format painter.
  useEffect(() => {
    if (!formatToPaint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFormatToPaint(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formatToPaint, setFormatToPaint]);

  useEffect(() => {
    loadDeck().catch((err) => console.error(err));
    watchAndSave();
    connectWebsocket();
  }, []);

  // Keyboard shortcuts: undo/redo + delete + paste images.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Don't hijack undo/redo while typing in any text input or contenteditable
      // (TipTap, Inspector textareas, the deck title field, etc.).
      const inEditor = e.target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
      if (meta && e.key === "z" && !e.shiftKey && !inEditor) {
        e.preventDefault(); undo();
      } else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey)) && !inEditor) {
        e.preventDefault(); redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0 && currentSlideId) {
        // Don't hijack when focus is in an input/textarea.
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        for (const id of selectedIds) removeElement(currentSlideId, id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, currentSlideId, undo, redo, removeElement]);

  // Paste images from clipboard.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!currentSlideId) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          const { path } = await uploadAsset(file, `paste-${Date.now()}.png`);
          const el: ElementT = {
            id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: "image",
            x: 200, y: 150, w: 480, h: 360, rotation: 0,
            src: path,
            fit: "contain",
          };
          addElement(currentSlideId, el);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [currentSlideId, addElement]);

  // Drag-and-drop images onto canvas area.
  useEffect(() => {
    const onDrop = async (e: DragEvent) => {
      if (!currentSlideId) return;
      const dt = e.dataTransfer;
      if (!dt || dt.files.length === 0) return;
      e.preventDefault();
      for (const file of Array.from(dt.files)) {
        if (!file.type.startsWith("image/")) continue;
        const { path } = await uploadAsset(file);
        const el: ElementT = {
          id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: "image",
          x: 200, y: 150, w: 480, h: 360, rotation: 0,
          src: path,
          fit: "contain",
        };
        addElement(currentSlideId, el);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
        e.preventDefault();
      }
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [currentSlideId, addElement]);

  if (!deck) {
    return <div className="app"><div style={{ gridColumn: "1 / -1", padding: 24 }}>Loading deck…</div></div>;
  }
  const slide = currentSlideId ? findSlide(deck, currentSlideId) : undefined;

  return (
    <div className="app">
      <Toolbar />
      <SlidesSidebar />
      {slide ? <SlideCanvas deck={deck} slide={slide} /> : <div className="canvas-area" />}
      <Inspector />
    </div>
  );
}
