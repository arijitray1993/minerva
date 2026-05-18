import { useState } from "react";
import { useStore } from "./store";
import { uploadAsset } from "./sync";
import type { ElementT, ShapeKind } from "@minerva/schema";
import { newTable } from "@minerva/schema";
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
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selectedIds = useStore((s) => s.selectedIds);
  const formatToPaint = useStore((s) => s.formatToPaint);
  const setFormatToPaint = useStore((s) => s.setFormatToPaint);
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
    setShapeMenuOpen(false);
    // Line-like shapes use click-to-place on the canvas — the user clicks the
    // start and end points (and a control point for curves). Inserting them
    // at a fixed location made them invisibly tiny on a big poster.
    if (kind === "line") { setTool("line"); return; }
    if (kind === "arrow") { setTool("arrow"); return; }
    if (kind === "curveQuad") { setTool("curve"); return; }
    const el: ElementT = {
      id: newId("shape"),
      type: "shape",
      shapeKind: kind,
      x: 200, y: 200,
      w: 200,
      h: 160,
      rotation: 0,
      style: { fill: "#bdd6f7", stroke: "#3b6ea8", strokeWidth: 1, opacity: 1 },
    };
    addElement(currentSlideId, el);
  };
  const addTable = () => {
    addElement(currentSlideId, newTable(3, 3));
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
      <button onClick={addTable}>+ Table</button>
      {tool !== "select" && (
        <button
          onClick={() => setTool("select")}
          className="active"
          title="Cancel drawing tool"
        >
          {tool === "line" ? "✏︎ drawing line — click start, click end (Esc to cancel)" :
           tool === "arrow" ? "✏︎ drawing arrow — click start, click end (Esc to cancel)" :
           "✏︎ drawing curve — click start, click control, click end (Esc to cancel)"}
        </button>
      )}
      <span className="sep" />
      <button
        onClick={() => {
          if (formatToPaint) setFormatToPaint(null);
          else if (selectedIds.length === 1) setFormatToPaint({ sourceId: selectedIds[0] });
        }}
        className={formatToPaint ? "active" : ""}
        disabled={!formatToPaint && selectedIds.length !== 1}
        title={
          formatToPaint
            ? "Click any other element to paint this format. Esc to cancel."
            : "Select one element, then click to copy its formatting to another."
        }
      >
        {formatToPaint ? "🖌 paint format…" : "Format painter"}
      </button>
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
