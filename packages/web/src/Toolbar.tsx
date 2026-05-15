import { useState } from "react";
import { useStore } from "./store";
import { uploadAsset } from "./sync";
import type { ElementT, ShapeKind } from "@minerva/schema";
import { plainTextDoc } from "./text";
import { SHAPE_GROUPS, SHAPE_LABELS, type ShapeKindCategory } from "./shapes";

function newId(prefix: string) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${t}-${r}`;
}

export function Toolbar() {
  const deck = useStore((s) => s.deck);
  const currentSlideId = useStore((s) => s.currentSlideId);
  const addElement = useStore((s) => s.addElement);
  const addSlide = useStore((s) => s.addSlide);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  if (!deck || !currentSlideId) return <div className="toolbar" />;

  const addText = () => {
    const el: ElementT = {
      id: newId("text"),
      type: "text",
      x: 100, y: 100, w: 600, h: 80, rotation: 0,
      content: plainTextDoc("New text"),
      style: { align: "left", padding: 8 },
    };
    addElement(currentSlideId, el);
  };
  const addShape = (kind: ShapeKind) => {
    const isLine = kind === "line" || kind === "arrow";
    const el: ElementT = {
      id: newId("shape"),
      type: "shape",
      shapeKind: kind,
      x: 200, y: 200,
      w: isLine ? 300 : 200,
      h: isLine ? 1 : 160,
      rotation: 0,
      style: isLine
        ? { stroke: "#333", strokeWidth: 2, opacity: 1 }
        : { fill: "#bdd6f7", stroke: "#3b6ea8", strokeWidth: 1, opacity: 1 },
    };
    addElement(currentSlideId, el);
    setShapeMenuOpen(false);
  };
  const addImage = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const { path } = await uploadAsset(f);
      const el: ElementT = {
        id: newId("img"),
        type: "image",
        x: 200, y: 150, w: 480, h: 360, rotation: 0,
        src: path,
        fit: "contain",
      };
      addElement(currentSlideId, el);
    };
    input.click();
  };
  const exportPdf = async () => {
    const r = await fetch("/api/export/pdf");
    if (!r.ok) {
      const err = await r.text();
      alert(`PDF export failed: ${err}`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.title || "deck"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="toolbar">
      <div className="title">Minerva — {deck.title}</div>
      <button onClick={addText}>+ Text</button>
      <div style={{ position: "relative" }}>
        <button onClick={() => setShapeMenuOpen((v) => !v)}>+ Shape ▾</button>
        {shapeMenuOpen && (
          <div className="shape-menu">
            {(Object.entries(SHAPE_GROUPS) as Array<[ShapeKindCategory, ShapeKind[]]>).map(([cat, kinds]) => (
              <div key={cat} className="shape-menu-group">
                <div className="shape-menu-label">{cat}</div>
                <div className="shape-menu-grid">
                  {kinds.map((k) => (
                    <button key={k} className="shape-menu-item" onClick={() => addShape(k)} title={SHAPE_LABELS[k]}>
                      {SHAPE_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <button onClick={addImage}>+ Image</button>
      <span className="sep" />
      <button onClick={addSlide}>+ Slide</button>
      <span className="sep" />
      <button onClick={undo}>Undo</button>
      <button onClick={redo}>Redo</button>
      <span className="sep" />
      <button onClick={exportPdf}>Export PDF</button>
      <div className="spacer" />
      <span className="status">edits sync to deck.json automatically</span>
    </div>
  );
}
