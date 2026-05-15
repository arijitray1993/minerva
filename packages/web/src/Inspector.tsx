import { useEffect } from "react";
import { useStore, findElement } from "./store";
import type { ElementT, TextElementT, ShapeElementT, ImageElementT } from "@minerva/schema";
import {
  GOOGLE_FONTS,
  ensureFontLoaded,
  firstTextStyle,
  hasMarkAll,
  plainText,
  plainTextDoc,
  setHighlightAll,
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
      </div>
    );
  }
  if (selectedIds.length > 1) {
    return <div className="inspector"><h3>{selectedIds.length} selected</h3></div>;
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
        onChange={(e) => patch({ content: plainTextDoc(e.target.value) } as any)}
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
  const isLine = el.shapeKind === "line" || el.shapeKind === "arrow";
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
        <div className="button-group">
          <button className={style.arrowStart ? "active" : ""} onClick={() => patchStyle({ arrowStart: !style.arrowStart })}>← head</button>
          <button className={style.arrowEnd ? "active" : ""} onClick={() => patchStyle({ arrowEnd: !style.arrowEnd })}>head →</button>
        </div>
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
