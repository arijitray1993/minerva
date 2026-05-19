import { useEffect } from "react";
import { useStore, findSlide } from "./store";
import { connectWebsocket, loadComments, loadDeck, uploadAsset, watchAndSave, setupBeforeUnloadSave } from "./sync";
import { SlideCanvas } from "./SlideCanvas";
import { Inspector } from "./Inspector";
import { SlidesSidebar } from "./SlidesSidebar";
import { Toolbar } from "./Toolbar";
import { BottomPanel } from "./BottomPanel";
import type { ElementT } from "@minerva/schema";

/** Deep-clone an element, recursively assigning fresh IDs (the top-level id
 *  and every id inside a group's children). The shape of the copy is otherwise
 *  byte-identical to the source so formatting, content, crop, table cells,
 *  etc. all survive. */
function cloneElementWithFreshIds(el: ElementT): ElementT {
  const copy = JSON.parse(JSON.stringify(el)) as ElementT;
  const fresh = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const reassign = (e: ElementT) => {
    const prefix = e.type === "table" ? "table" : e.type === "image" ? "img" : e.type === "text" ? "text" : e.type === "group" ? "group" : "shape";
    e.id = fresh(prefix);
    if (e.type === "group") {
      for (const child of e.children) reassign(child);
    }
  };
  reassign(copy);
  return copy;
}

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
    loadComments().catch((err) => console.error(err));
    watchAndSave();
    connectWebsocket();
    setupBeforeUnloadSave();
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
      } else if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") &&
        selectedIds.length > 0 &&
        currentSlideId &&
        !inEditor
      ) {
        // Nudge selected elements. Shift makes a bigger step.
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        e.preventDefault();
        useStore.getState().nudgeSelected(dx, dy);
      } else if (meta && (e.key === "c" || e.key === "C") && !inEditor) {
        // Copy current selection into the in-app clipboard. We deliberately
        // don't touch the system clipboard so paste-from-other-tab (images,
        // SVG) still works untouched.
        const st = useStore.getState();
        if (currentSlideId && selectedIds.length > 0 && st.deck) {
          const slide = findSlide(st.deck, currentSlideId);
          if (slide) {
            const els = selectedIds
              .map((id) => slide.elements.find((el) => el.id === id))
              .filter((x): x is ElementT => !!x);
            if (els.length > 0) {
              st.setClipboard(els.map((el) => JSON.parse(JSON.stringify(el))));
              e.preventDefault();
            }
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, currentSlideId, undo, redo, removeElement]);

  // Paste images from clipboard. Handles three sources:
  //   1. A direct image File item (Cmd+V after "Copy Image" from any web page).
  //   2. An <img> element in clipboard text/html (Google Slides image paste, or
  //      copy-as-html from a web page) — supports both data: URLs and remote URLs.
  //   3. An inline <svg> in clipboard text/html (Google Slides shape paste) —
  //      we rasterize the SVG to PNG via canvas and add it as an image element.
  useEffect(() => {
    const addImageElement = (path: string, w = 480, h = 360) => {
      if (!currentSlideId) return;
      const el: ElementT = {
        id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type: "image",
        x: 200, y: 150, w, h, rotation: 0,
        src: path,
        fit: "contain",
      };
      addElement(currentSlideId, el);
    };

    const uploadBlobAsImage = async (data: Blob | File, name = `paste-${Date.now()}.png`, dims?: { w: number; h: number }) => {
      const file = data instanceof File ? data : new File([data], name, { type: data.type || "image/png" });
      const { path } = await uploadAsset(file, name);
      addImageElement(path, dims?.w, dims?.h);
    };

    const rasterizeSvg = async (svgString: string): Promise<{ blob: Blob; w: number; h: number } | null> => {
      // Parse SVG to read its natural dimensions, fall back to viewBox or 480×360.
      const probe = new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
      const widthAttr = parseFloat(probe.getAttribute("width") || "");
      const heightAttr = parseFloat(probe.getAttribute("height") || "");
      let w = isNaN(widthAttr) ? 0 : widthAttr;
      let h = isNaN(heightAttr) ? 0 : heightAttr;
      if (!w || !h) {
        const vb = probe.getAttribute("viewBox");
        if (vb) {
          const parts = vb.split(/\s+/).map(Number);
          if (parts.length === 4 && !parts.some(isNaN)) { w = w || parts[2]; h = h || parts[3]; }
        }
      }
      if (!w || !h) { w = 480; h = 360; }
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = url;
        });
        if (!img) return null;
        const drawW = img.naturalWidth || w;
        const drawH = img.naturalHeight || h;
        const canvas = document.createElement("canvas");
        canvas.width = drawW; canvas.height = drawH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, drawW, drawH);
        return await new Promise<{ blob: Blob; w: number; h: number } | null>((resolve) => {
          canvas.toBlob((b) => resolve(b ? { blob: b, w: drawW, h: drawH } : null), "image/png");
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (!currentSlideId) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const cd = e.clipboardData;
      if (!cd) return;

      // 1. Direct file item.
      for (const item of cd.items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          await uploadBlobAsImage(file);
          return;
        }
      }

      // 2. text/html with <img> or <svg>.
      const html = cd.getData("text/html");
      if (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const imgEl = doc.querySelector("img");
        if (imgEl && imgEl.src) {
          e.preventDefault();
          try {
            const resp = await fetch(imgEl.src);
            if (resp.ok) {
              const blob = await resp.blob();
              if (blob.type.startsWith("image/")) {
                const w = parseFloat(imgEl.getAttribute("width") || "") || undefined;
                const h = parseFloat(imgEl.getAttribute("height") || "") || undefined;
                const ext = blob.type.split("/")[1] || "png";
                await uploadBlobAsImage(blob, `paste-${Date.now()}.${ext}`, w && h ? { w, h } : undefined);
                return;
              }
            } else {
              console.warn("paste: fetch of pasted image src failed", resp.status);
            }
          } catch (err) {
            console.warn("paste: pasted image src not fetchable (likely CORS)", err);
          }
        }
        const svgEl = doc.querySelector("svg");
        if (svgEl) {
          e.preventDefault();
          const svgString = new XMLSerializer().serializeToString(svgEl);
          const r = await rasterizeSvg(svgString);
          if (r) await uploadBlobAsImage(r.blob, `paste-${Date.now()}.png`, { w: r.w, h: r.h });
          return;
        }
      }

      // 3. Fall back to the in-app clipboard: paste deep copies of whatever
      // the user last Cmd+C'd inside Minerva, with fresh IDs and a small
      // offset so they're visibly distinct from the originals.
      const st = useStore.getState();
      if (st.clipboard.length > 0) {
        e.preventDefault();
        const PASTE_OFFSET = 24;
        const newIds: string[] = [];
        for (const src of st.clipboard) {
          const copy = cloneElementWithFreshIds(src);
          copy.x += PASTE_OFFSET;
          copy.y += PASTE_OFFSET;
          addElement(currentSlideId, copy);
          newIds.push(copy.id);
        }
        // Re-stash the pasted clones so a chain of Cmd+V steps each new copy
        // further from the previous one (Figma/Slides behavior).
        st.setClipboard(st.clipboard.map((src) => {
          const c = JSON.parse(JSON.stringify(src)) as ElementT;
          c.x += PASTE_OFFSET;
          c.y += PASTE_OFFSET;
          return c;
        }));
        useStore.getState().setSelection(newIds);
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
      <BottomPanel />
    </div>
  );
}
