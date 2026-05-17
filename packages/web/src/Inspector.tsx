import { useEffect } from "react";
import { useStore, findElement } from "./store";
import type { ElementT, TextElementT, ShapeElementT, ImageElementT, TableElementT, TableCellT } from "@minerva/schema";
import { emptyTableCell } from "@minerva/schema";
import {
  GOOGLE_FONTS,
  ensureFontLoaded,
  firstTextStyle,
  hasMarkAll,
  plainText,
  plainTextDoc,
  setHighlightAll,
  setTextPreservingStyle,
  setTextStyleAll,
  toggleMarkAll,
} from "./text";
import { SHAPE_LABELS } from "./shapes";

export function Inspector() {
  const deck = useStore((s) => s.deck);
  const selectedIds = useStore((s) => s.selectedIds);
  const currentSlideId = useStore((s) => s.currentSlideId);

  if (!deck) return <div className="inspector"><h3>Inspector</h3></div>;
  if (selectedIds.length === 0) {
    return (
      <div className="inspector">
        <h3>Deck</h3>
        <div className="row">
          <label>Title</label>
          <input
            type="text"
            value={deck.title}
            onChange={(e) => useStore.getState().setDeckTitle(e.target.value)}
          />
        </div>
        <DeckSizeRow w={deck.size.w} h={deck.size.h} />
      </div>
    );
  }
  if (selectedIds.length > 1 && currentSlideId) {
    return (
      <div className="inspector">
        <MultiInspector selectedIds={selectedIds} slideId={currentSlideId} />
      </div>
    );
  }

  const id = selectedIds[0];
  const found = findElement(deck, id);
  if (!found || !currentSlideId) return <div className="inspector"><h3>Inspector</h3></div>;
  const el = found.el;

  return (
    <div className="inspector">
      <ElementInspector el={el} slideId={currentSlideId} />
    </div>
  );
}

// 96 CSS px = 1 inch — same DPI Playwright uses when interpreting the deck size
// for PDF export, so what the inspector says in inches matches what comes out.
const DPI = 96;
const pxToIn = (px: number) => +(px / DPI).toFixed(2);
const inToPx = (inches: number) => Math.round(inches * DPI);

function DeckSizeRow({ w, h }: { w: number; h: number }) {
  const setDeckSize = useStore((s) => s.setDeckSize);
  const applyIn = (nwIn: number, nhIn: number) => {
    if (!nwIn || !nhIn || nwIn <= 0 || nhIn <= 0) return;
    const nw = inToPx(nwIn);
    const nh = inToPx(nhIn);
    if (nw === w && nh === h) return;
    setDeckSize(nw, nh);
  };
  return (
    <>
      <h3>Size (inches)</h3>
      <div className="row">
        <label>width</label>
        <input
          key={`w-${w}`}
          type="number" min={0.1} max={200} step={0.1}
          defaultValue={pxToIn(w)}
          onBlur={(e) => applyIn(+e.target.value, pxToIn(h))}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="row">
        <label>height</label>
        <input
          key={`h-${h}`}
          type="number" min={0.1} max={200} step={0.1}
          defaultValue={pxToIn(h)}
          onBlur={(e) => applyIn(pxToIn(w), +e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="row" style={{ color: "var(--muted)", fontSize: 11 }}>
        Content scales with the canvas. {w} × {h} px @ 96 DPI.
      </div>
      <div className="button-group">
        <button onClick={() => applyIn(13.33, 7.5)} title="16:9 standard slide">13.33×7.5″</button>
        <button onClick={() => applyIn(20, 11.25)} title="16:9 large">20×11.25″</button>
        <button onClick={() => applyIn(24, 18)} title="Conference poster">24×18″</button>
        <button onClick={() => applyIn(36, 24)} title="Large poster">36×24″</button>
        <button onClick={() => applyIn(48, 36)} title="Trade-show poster">48×36″</button>
      </div>
    </>
  );
}

function MultiInspector({ selectedIds, slideId }: { selectedIds: string[]; slideId: string }) {
  const deck = useStore((s) => s.deck);
  const updateElement = useStore((s) => s.updateElement);
  const removeElement = useStore((s) => s.removeElement);
  const reorderElement = useStore((s) => s.reorderElement);
  const setSelection = useStore((s) => s.setSelection);

  if (!deck) return null;
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return null;

  const selected = selectedIds
    .map((id) => slide.elements.find((e) => e.id === id))
    .filter(Boolean) as ElementT[];
  if (selected.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const el of selected) counts[el.type] = (counts[el.type] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`)
    .join(", ");

  const patchAllStyle = (delta: Record<string, any>) => {
    for (const el of selected) {
      const cur = (el as any).style ?? {};
      updateElement(slideId, el.id, { style: { ...cur, ...delta } } as any);
    }
  };
  const patchAllTextStyle = (delta: {
    color?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
  }) => {
    if (delta.fontFamily) ensureFontLoaded(delta.fontFamily);
    for (const el of selected) {
      if (el.type !== "text") continue;
      updateElement(slideId, el.id, { content: setTextStyleAll(el.content, delta) } as any);
    }
  };
  const toggleMarkAllSelected = (type: "bold" | "italic" | "underline" | "strike") => {
    for (const el of selected) {
      if (el.type !== "text") continue;
      updateElement(slideId, el.id, { content: toggleMarkAll(el.content, type) } as any);
    }
  };
  const setHighlightAllSelected = (color: string | null) => {
    for (const el of selected) {
      if (el.type !== "text") continue;
      updateElement(slideId, el.id, { content: setHighlightAll(el.content, color) } as any);
    }
  };
  const removeAll = () => {
    for (const el of selected) removeElement(slideId, el.id);
    setSelection([]);
  };
  const reorderAll = (op: "front" | "back" | "forward" | "backward") => {
    for (const el of selected) reorderElement(slideId, el.id, op);
  };

  const hasText = (counts.text ?? 0) > 0;
  const hasShape = (counts.shape ?? 0) > 0;

  return (
    <>
      <div className="section-header"><h3 style={{ margin: 0 }}>{selected.length} selected · {summary}</h3></div>

      <h3>Common</h3>
      <div className="row">
        <label>opacity</label>
        <input
          type="number" min={0} max={1} step={0.05} placeholder="–" defaultValue=""
          onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patchAllStyle({ opacity: v }); e.target.value = ""; }}
        />
      </div>

      <h3>Layer</h3>
      <div className="button-group">
        <button onClick={() => reorderAll("back")} title="Send to back">⤓⤓</button>
        <button onClick={() => reorderAll("backward")} title="Send backward">⤓</button>
        <button onClick={() => reorderAll("forward")} title="Bring forward">⤒</button>
        <button onClick={() => reorderAll("front")} title="Bring to front">⤒⤒</button>
      </div>

      {hasText && (
        <>
          <h3>Text · applies to {counts.text} element{counts.text === 1 ? "" : "s"}</h3>
          <div className="row">
            <label>font</label>
            <select defaultValue="" onChange={(e) => { if (e.target.value) patchAllTextStyle({ fontFamily: e.target.value }); }}>
              <option value="" disabled>–</option>
              {GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="row">
            <label>size</label>
            <input
              type="number" min={6} max={300} placeholder="–" defaultValue=""
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) patchAllTextStyle({ fontSize: v }); e.target.value = ""; }}
            />
          </div>
          <div className="row">
            <label>weight</label>
            <input
              type="number" min={100} max={900} step={100} placeholder="–" defaultValue=""
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patchAllTextStyle({ fontWeight: v }); e.target.value = ""; }}
            />
          </div>
          <div className="row">
            <label>line h</label>
            <input
              type="number" min={0.5} max={3} step={0.05} placeholder="–" defaultValue=""
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) patchAllTextStyle({ lineHeight: v }); e.target.value = ""; }}
            />
          </div>
          <div className="row">
            <label>tracking</label>
            <input
              type="number" step={0.1} placeholder="–" defaultValue=""
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patchAllTextStyle({ letterSpacing: v }); e.target.value = ""; }}
            />
          </div>
          <div className="row">
            <label>color</label>
            <input type="color" onChange={(e) => patchAllTextStyle({ color: e.target.value })} />
          </div>
          <div className="row">
            <label>highlight</label>
            <input type="color" onChange={(e) => setHighlightAllSelected(e.target.value)} />
            <button onClick={() => setHighlightAllSelected(null)} title="Clear highlight">×</button>
          </div>
          <div className="button-group">
            <button onClick={() => toggleMarkAllSelected("bold")}>B</button>
            <button onClick={() => toggleMarkAllSelected("italic")} style={{ fontStyle: "italic" }}>I</button>
            <button onClick={() => toggleMarkAllSelected("underline")} style={{ textDecoration: "underline" }}>U</button>
            <button onClick={() => toggleMarkAllSelected("strike")} style={{ textDecoration: "line-through" }}>S</button>
          </div>
        </>
      )}

      {hasShape && (
        <>
          <h3>Shape · applies to {counts.shape} element{counts.shape === 1 ? "" : "s"}</h3>
          <div className="row">
            <label>fill</label>
            <input type="color" onChange={(e) => patchAllStyle({ fill: e.target.value })} />
          </div>
          <div className="row">
            <label>stroke</label>
            <input type="color" onChange={(e) => patchAllStyle({ stroke: e.target.value })} />
          </div>
          <div className="row">
            <label>stroke w</label>
            <input
              type="number" min={0} max={40} step={0.5} placeholder="–" defaultValue=""
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patchAllStyle({ strokeWidth: v }); e.target.value = ""; }}
            />
          </div>
        </>
      )}

      <button
        style={{ marginTop: 16, background: "var(--danger)", color: "white", border: "none", borderRadius: 4, padding: "6px 10px", cursor: "pointer", width: "100%" }}
        onClick={removeAll}
      >
        Delete {selected.length} element{selected.length === 1 ? "" : "s"}
      </button>
    </>
  );
}

function ElementInspector({ el, slideId }: { el: ElementT; slideId: string }) {
  const updateElement = useStore((s) => s.updateElement);
  const removeElement = useStore((s) => s.removeElement);
  const reorderElement = useStore((s) => s.reorderElement);

  const patch = (p: Partial<ElementT>) => updateElement(slideId, el.id, p);
  const patchStyle = (p: Record<string, any>) => {
    const cur = (el as any).style ?? {};
    patch({ style: { ...cur, ...p } } as any);
  };

  return (
    <>
      <div className="section-header">
        <h3 style={{ margin: 0 }}>{el.type}{el.type === "shape" ? ` · ${SHAPE_LABELS[(el as ShapeElementT).shapeKind]}` : ""}</h3>
      </div>
      <div className="row"><label>id</label><code style={{ fontSize: 11, color: "var(--muted)" }}>{el.id}</code></div>

      <h3>Position</h3>
      <div className="row"><label>x</label><input type="number" value={Math.round(el.x)} onChange={(e) => patch({ x: +e.target.value } as any)} /></div>
      <div className="row"><label>y</label><input type="number" value={Math.round(el.y)} onChange={(e) => patch({ y: +e.target.value } as any)} /></div>
      <div className="row"><label>w</label><input type="number" value={Math.round(el.w)} onChange={(e) => patch({ w: +e.target.value } as any)} /></div>
      <div className="row"><label>h</label><input type="number" value={Math.round(el.h)} onChange={(e) => patch({ h: +e.target.value } as any)} /></div>
      <div className="row"><label>rot</label><input type="number" value={Math.round(el.rotation ?? 0)} onChange={(e) => patch({ rotation: +e.target.value } as any)} /></div>

      <h3>Layer</h3>
      <div className="button-group">
        <button onClick={() => reorderElement(slideId, el.id, "back")} title="Send to back">⤓⤓</button>
        <button onClick={() => reorderElement(slideId, el.id, "backward")} title="Send backward">⤓</button>
        <button onClick={() => reorderElement(slideId, el.id, "forward")} title="Bring forward">⤒</button>
        <button onClick={() => reorderElement(slideId, el.id, "front")} title="Bring to front">⤒⤒</button>
      </div>

      {el.type === "text" && <TextStyleSection el={el} patch={patch} />}
      {el.type === "shape" && <ShapeStyleSection el={el} patchStyle={patchStyle} />}
      {el.type === "image" && <ImageStyleSection el={el} patch={patch} patchStyle={patchStyle} />}
      {el.type === "table" && <TableSection el={el} patch={patch} patchStyle={patchStyle} />}

      <ShadowSection el={el} patchStyle={patchStyle} />

      <button
        style={{ marginTop: 16, background: "var(--danger)", color: "white", border: "none", borderRadius: 4, padding: "6px 10px", cursor: "pointer", width: "100%" }}
        onClick={() => removeElement(slideId, el.id)}
      >
        Delete element
      </button>
    </>
  );
}

function TextStyleSection({ el, patch }: { el: TextElementT; patch: (p: Partial<ElementT>) => void }) {
  const style = firstTextStyle(el.content);
  const fontFamily = style.fontFamily ?? "Inter";
  const fontSize = style.fontSize ?? 24;
  const color = style.color ?? "#111111";

  useEffect(() => { ensureFontLoaded(fontFamily); }, [fontFamily]);

  const toggle = (type: "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript") => {
    patch({ content: toggleMarkAll(el.content, type) } as any);
  };
  const styleSet = (p: { color?: string; fontFamily?: string; fontSize?: number }) => {
    if (p.fontFamily) ensureFontLoaded(p.fontFamily);
    patch({ content: setTextStyleAll(el.content, p) } as any);
  };

  // Find current highlight color, if any.
  let highlightColor: string | null = null;
  const findHighlight = (node: any) => {
    if (node.type === "text") {
      const m = (node.marks ?? []).find((m: any) => m.type === "highlight");
      if (m?.attrs?.color) highlightColor = m.attrs.color;
    }
    for (const c of node.content ?? []) findHighlight(c);
  };
  findHighlight(el.content);

  return (
    <>
      <h3>Text</h3>
      <textarea
        style={{ width: "100%", minHeight: 60, background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: 6, fontSize: 12 }}
        value={plainText(el.content)}
        onChange={(e) => patch({ content: setTextPreservingStyle(el.content, e.target.value) } as any)}
      />

      <div className="row">
        <label>font</label>
        <select value={fontFamily} onChange={(e) => styleSet({ fontFamily: e.target.value })}>
          {GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="row">
        <label>size</label>
        <input type="number" min={6} max={300} value={fontSize} onChange={(e) => styleSet({ fontSize: +e.target.value })} />
      </div>
      <div className="row">
        <label>color</label>
        <input type="color" value={color} onChange={(e) => styleSet({ color: e.target.value })} />
      </div>

      <div className="button-group">
        <button className={hasMarkAll(el.content, "bold") ? "active" : ""} onClick={() => toggle("bold")} style={{ fontWeight: 700 }}>B</button>
        <button className={hasMarkAll(el.content, "italic") ? "active" : ""} onClick={() => toggle("italic")} style={{ fontStyle: "italic" }}>I</button>
        <button className={hasMarkAll(el.content, "underline") ? "active" : ""} onClick={() => toggle("underline")} style={{ textDecoration: "underline" }}>U</button>
        <button className={hasMarkAll(el.content, "strike") ? "active" : ""} onClick={() => toggle("strike")} style={{ textDecoration: "line-through" }}>S</button>
      </div>
      <div className="button-group">
        <button className={hasMarkAll(el.content, "superscript") ? "active" : ""} onClick={() => toggle("superscript")}>x²</button>
        <button className={hasMarkAll(el.content, "subscript") ? "active" : ""} onClick={() => toggle("subscript")}>x₂</button>
      </div>
      <div className="row">
        <label>highlight</label>
        <input
          type="color"
          value={highlightColor ?? "#fff59d"}
          onChange={(e) => patch({ content: setHighlightAll(el.content, e.target.value) } as any)}
        />
        <button
          style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
          onClick={() => patch({ content: setHighlightAll(el.content, null) } as any)}
        >clear</button>
      </div>

      <div className="row">
        <label>align</label>
        <select
          value={el.style?.align ?? "left"}
          onChange={(e) => patch({ style: { ...(el.style ?? {}), align: e.target.value as any } } as any)}
        >
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
          <option value="justify">justify</option>
        </select>
      </div>
    </>
  );
}

function ShapeStyleSection({ el, patchStyle }: { el: ShapeElementT; patchStyle: (p: Record<string, any>) => void }) {
  const style = el.style ?? {};
  const supportsRadius = el.shapeKind === "rect" || el.shapeKind === "roundedRect" || el.shapeKind === "flowProcess" || el.shapeKind === "flowTerminator";
  const isLine = el.shapeKind === "line" || el.shapeKind === "arrow" || el.shapeKind === "curveQuad";
  const isCurve = el.shapeKind === "curveQuad";
  return (
    <>
      <h3>Shape</h3>
      {!isLine && (
        <div className="row">
          <label>fill</label>
          <input type="color" value={style.fill ?? "#bdd6f7"} onChange={(e) => patchStyle({ fill: e.target.value })} />
        </div>
      )}
      <div className="row">
        <label>stroke</label>
        <input type="color" value={style.stroke ?? "#000000"} onChange={(e) => patchStyle({ stroke: e.target.value })} />
      </div>
      <div className="row">
        <label>stroke w</label>
        <input type="number" min={0} max={40} step={0.5} value={style.strokeWidth ?? 1} onChange={(e) => patchStyle({ strokeWidth: +e.target.value })} />
      </div>
      <div className="row">
        <label>opacity</label>
        <input type="number" min={0} max={1} step={0.1} value={style.opacity ?? 1} onChange={(e) => patchStyle({ opacity: +e.target.value })} />
      </div>
      {supportsRadius && (
        <div className="row">
          <label>radius</label>
          <input type="number" min={0} max={200} step={1} value={style.radius ?? 0} onChange={(e) => patchStyle({ radius: +e.target.value })} />
        </div>
      )}
      {isLine && (
        <>
          <div className="row"><label>arrows</label></div>
          <div className="button-group">
            <button className={style.arrowStart ? "active" : ""} onClick={() => patchStyle({ arrowStart: !style.arrowStart })}>← start</button>
            <button className={style.arrowEnd ? "active" : ""} onClick={() => patchStyle({ arrowEnd: !style.arrowEnd })}>end →</button>
          </div>
        </>
      )}
      {isCurve && (
        <>
          <div className="row"><label>ctrl x</label><input type="number" value={Math.round(style.controlX ?? 0)} onChange={(e) => patchStyle({ controlX: +e.target.value })} /></div>
          <div className="row"><label>ctrl y</label><input type="number" value={Math.round(style.controlY ?? 0)} onChange={(e) => patchStyle({ controlY: +e.target.value })} /></div>
        </>
      )}
    </>
  );
}

function ImageStyleSection({ el, patch, patchStyle }: { el: ImageElementT; patch: (p: Partial<ElementT>) => void; patchStyle: (p: Record<string, any>) => void }) {
  return (
    <>
      <h3>Image</h3>
      <div className="row"><label>src</label><input type="text" value={el.src} readOnly /></div>
      <div className="row">
        <label>fit</label>
        <select value={el.fit ?? "contain"} onChange={(e) => patch({ fit: e.target.value as any } as any)}>
          <option value="contain">contain</option>
          <option value="cover">cover</option>
          <option value="fill">fill</option>
        </select>
      </div>
      <div className="row">
        <label>opacity</label>
        <input type="number" min={0} max={1} step={0.1} value={el.style?.opacity ?? 1} onChange={(e) => patchStyle({ opacity: +e.target.value })} />
      </div>
      <div className="row">
        <label>radius</label>
        <input type="number" min={0} max={500} step={1} value={(el.style as any)?.radius ?? 0} onChange={(e) => patchStyle({ radius: +e.target.value })} />
      </div>
    </>
  );
}

function TableSection({
  el,
  patch,
  patchStyle,
}: {
  el: TableElementT;
  patch: (p: Partial<ElementT>) => void;
  patchStyle: (p: Record<string, any>) => void;
}) {
  const style = el.style ?? {};

  const insertRow = (at: number) => {
    const cells = el.cells.map((r) => r.slice());
    cells.splice(at, 0, Array.from({ length: el.cols }, () => emptyTableCell()));
    patch({ rows: el.rows + 1, cells } as any);
  };
  const insertCol = (at: number) => {
    const cells = el.cells.map((r) => {
      const copy = r.slice();
      copy.splice(at, 0, emptyTableCell());
      return copy;
    });
    patch({ cols: el.cols + 1, cells } as any);
  };
  const deleteRow = (at: number) => {
    if (el.rows <= 1) return;
    const cells = el.cells.slice();
    cells.splice(at, 1);
    patch({ rows: el.rows - 1, cells } as any);
  };
  const deleteCol = (at: number) => {
    if (el.cols <= 1) return;
    const cells = el.cells.map((r) => {
      const copy = r.slice();
      copy.splice(at, 1);
      return copy;
    });
    patch({ cols: el.cols - 1, cells } as any);
  };
  const setCellText = (r: number, c: number, text: string) => {
    const cells = el.cells.map((row, ri) =>
      row.map((cell, ci) =>
        ri === r && ci === c
          ? { ...cell, content: setTextPreservingStyle(cell.content, text) }
          : cell
      )
    );
    patch({ cells } as any);
  };

  return (
    <>
      <h3>Table</h3>
      <div className="row"><label>rows × cols</label><span>{el.rows} × {el.cols}</span></div>

      <div className="row"><label>rows</label></div>
      <div className="button-group">
        <button onClick={() => insertRow(0)} title="Insert row at top">+ top</button>
        <button onClick={() => insertRow(el.rows)} title="Append row">+ bottom</button>
        <button onClick={() => deleteRow(el.rows - 1)} title="Delete last row" disabled={el.rows <= 1}>− last</button>
      </div>

      <div className="row"><label>cols</label></div>
      <div className="button-group">
        <button onClick={() => insertCol(0)} title="Insert column at left">+ left</button>
        <button onClick={() => insertCol(el.cols)} title="Append column">+ right</button>
        <button onClick={() => deleteCol(el.cols - 1)} title="Delete last column" disabled={el.cols <= 1}>− last</button>
      </div>

      <div className="row"><label>headers</label></div>
      <div className="button-group">
        <button className={el.headerRow ? "active" : ""} onClick={() => patch({ headerRow: !el.headerRow } as any)}>row</button>
        <button className={el.headerCol ? "active" : ""} onClick={() => patch({ headerCol: !el.headerCol } as any)}>col</button>
      </div>

      <h3>Cells</h3>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${el.cols}, 1fr)`, gap: 4 }}>
        {el.cells.flatMap((row, ri) =>
          row.map((cell, ci) => (
            <input
              key={`${ri}-${ci}`}
              type="text"
              value={plainText(cell.content)}
              onChange={(e) => setCellText(ri, ci, e.target.value)}
              placeholder={`r${ri + 1}c${ci + 1}`}
              style={{ fontSize: 11, padding: "2px 4px", minWidth: 0 }}
            />
          ))
        )}
      </div>

      <h3>Borders</h3>
      <div className="row">
        <label>color</label>
        <input type="color" value={style.borderColor ?? "#333333"} onChange={(e) => patchStyle({ borderColor: e.target.value })} />
      </div>
      <div className="row">
        <label>width</label>
        <input type="number" min={0} max={20} step={0.5} value={style.borderWidth ?? 1} onChange={(e) => patchStyle({ borderWidth: +e.target.value })} />
      </div>
      <div className="row">
        <label>padding</label>
        <input type="number" min={0} max={80} step={1} value={style.cellPadding ?? 8} onChange={(e) => patchStyle({ cellPadding: +e.target.value })} />
      </div>

      <h3>Body text</h3>
      <div className="row">
        <label>font</label>
        <select value={style.fontFamily ?? "Inter"} onChange={(e) => { ensureFontLoaded(e.target.value); patchStyle({ fontFamily: e.target.value }); }}>
          {GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="row">
        <label>size</label>
        <input type="number" min={6} max={120} value={style.fontSize ?? 16} onChange={(e) => patchStyle({ fontSize: +e.target.value })} />
      </div>
      <div className="row">
        <label>color</label>
        <input type="color" value={style.color ?? "#111111"} onChange={(e) => patchStyle({ color: e.target.value })} />
      </div>

      <h3>Header style</h3>
      <div className="row">
        <label>fill</label>
        <input type="color" value={style.headerFill ?? "#1f2937"} onChange={(e) => patchStyle({ headerFill: e.target.value })} />
      </div>
      <div className="row">
        <label>color</label>
        <input type="color" value={style.headerColor ?? "#ffffff"} onChange={(e) => patchStyle({ headerColor: e.target.value })} />
      </div>
      <div className="row">
        <label>weight</label>
        <input type="number" min={100} max={900} step={100} value={style.headerFontWeight ?? 700} onChange={(e) => patchStyle({ headerFontWeight: +e.target.value })} />
      </div>
    </>
  );
}

function ShadowSection({ el, patchStyle }: { el: ElementT; patchStyle: (p: Record<string, any>) => void }) {
  const style = (el as any).style ?? {};
  const shadow = style.shadow;
  return (
    <>
      <h3>Shadow</h3>
      <div className="button-group">
        <button
          className={shadow ? "active" : ""}
          onClick={() => patchStyle({ shadow: shadow ? undefined : { offsetX: 0, offsetY: 4, blur: 8, color: "rgba(0,0,0,0.35)", opacity: 1 } })}
        >{shadow ? "On" : "Off"}</button>
      </div>
      {shadow && (
        <>
          <div className="row"><label>x</label><input type="number" value={shadow.offsetX ?? 0} onChange={(e) => patchStyle({ shadow: { ...shadow, offsetX: +e.target.value } })} /></div>
          <div className="row"><label>y</label><input type="number" value={shadow.offsetY ?? 4} onChange={(e) => patchStyle({ shadow: { ...shadow, offsetY: +e.target.value } })} /></div>
          <div className="row"><label>blur</label><input type="number" min={0} value={shadow.blur ?? 8} onChange={(e) => patchStyle({ shadow: { ...shadow, blur: +e.target.value } })} /></div>
          <div className="row"><label>color</label><input type="color" value={shadow.color ?? "#000000"} onChange={(e) => patchStyle({ shadow: { ...shadow, color: e.target.value } })} /></div>
          <div className="row"><label>opacity</label><input type="number" min={0} max={1} step={0.05} value={shadow.opacity ?? 1} onChange={(e) => patchStyle({ shadow: { ...shadow, opacity: +e.target.value } })} /></div>
        </>
      )}
    </>
  );
}
