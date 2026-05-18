import { useEffect, useState } from "react";
import { Stage, Layer, Rect } from "react-konva";
import type { DeckT, ElementT, SlideT } from "@minerva/schema";
import { Text, Ellipse, Image as KImage, Line, Arrow } from "react-konva";
import useImage from "use-image";
import { firstTextStyle, plainText, ensureFontLoaded, ensureFontWeightLoaded, layoutTextDoc } from "./text";
import { SHAPE_GEOMETRY, scalePolygon, roundRectPath } from "./shapes";
import { Group, Rect as KonvaRect } from "react-konva";
import { TableEl } from "./TableEl";
import { Fragment } from "react";

/**
 * Print view — renders every slide stacked at 1:1 with `page-break-after: always`.
 * Combined with @page CSS sized to the deck, Playwright's `page.pdf({ preferCSSPageSize: true })`
 * produces one slide per PDF page at exact dimensions, no chrome.
 */
export function PrintView() {
  const [deck, setDeck] = useState<DeckT | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/deck").then((r) => r.json()).then(async (d: DeckT) => {
      setDeck(d);
      // Walk *every* text run (including ones with no explicit fontFamily
      // mark) and collect (family, weight, italic) tuples so we pre-load
      // every weight that will be rendered. Default base family = "Inter"
      // (matches layoutTextDoc) so bold-applied-to-default-text loads
      // Inter 700, not just whatever weight happened to be on the first run.
      const families = new Set<string>();
      const tuples = new Set<string>();
      const collectFromDoc = (doc: any, baseFamily: string = "Inter", baseWeight: number = 400) => {
        if (!doc || typeof doc !== "object") return;
        if (doc.type === "text" && typeof doc.text === "string") {
          let family = baseFamily;
          let weight = baseWeight;
          let italic = false;
          for (const m of doc.marks ?? []) {
            if (m.type === "bold") weight = Math.max(weight, 700);
            else if (m.type === "italic") italic = true;
            else if (m.type === "textStyle" && m.attrs) {
              if (m.attrs.fontFamily) family = m.attrs.fontFamily;
              if (typeof m.attrs.fontWeight === "number") weight = m.attrs.fontWeight;
            }
          }
          families.add(family);
          tuples.add(`${family}|${weight}|${italic ? "1" : "0"}`);
        }
        if (Array.isArray(doc.content)) for (const c of doc.content) collectFromDoc(c, baseFamily, baseWeight);
      };
      const visit = (els: any[]) => {
        for (const el of els) {
          if (el.type === "text") {
            collectFromDoc(el.content);
          } else if (el.type === "table") {
            const family = el.style?.fontFamily;
            if (family) families.add(family);
            for (const row of el.cells ?? []) for (const cell of row ?? []) {
              collectFromDoc(cell.content, el.style?.fontFamily ?? "Inter");
            }
          } else if (el.type === "group") {
            visit(el.children ?? []);
          }
        }
      };
      for (const slide of d.slides) visit(slide.elements);
      await Promise.all(Array.from(families).map((f) => ensureFontLoaded(f)));
      await Promise.all(
        Array.from(tuples).map((t) => {
          const [family, weight, italic] = t.split("|");
          return ensureFontWeightLoaded(family, parseInt(weight, 10), italic === "1");
        })
      );
      // Give browser a tick to apply fonts + load images via konva.
      setTimeout(() => setReady(true), 250);
    });
  }, []);

  if (!deck) return <div>Loading…</div>;

  const filterSlide = new URLSearchParams(location.search).get("slide");
  const slides = filterSlide
    ? deck.slides.filter((s) => s.id === filterSlide)
    : deck.slides;

  return (
    <>
      <style>{`
        @page { size: ${deck.size.w}px ${deck.size.h}px; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .print-slide {
          width: ${deck.size.w}px;
          height: ${deck.size.h}px;
          page-break-after: always;
          break-after: page;
          overflow: hidden;
          background: #fff;
        }
        .print-slide:last-child { page-break-after: auto; break-after: auto; }
      `}</style>
      <div data-print-ready={ready ? "1" : "0"}>
        {slides.map((slide) => (
          <div key={slide.id} data-slide-id={slide.id} className="print-slide">
            <Stage width={deck.size.w} height={deck.size.h}>
              <Layer>
                <Rect x={0} y={0} width={deck.size.w} height={deck.size.h} fill={slide.background?.fill ?? "#ffffff"} />
                {slide.elements.map((el) => <PrintEl key={el.id} el={el} />)}
              </Layer>
            </Stage>
          </div>
        ))}
      </div>
    </>
  );
}

function shadowProps(style: any) {
  const s = style?.shadow;
  if (!s) return {};
  return {
    shadowOffsetX: s.offsetX ?? 0,
    shadowOffsetY: s.offsetY ?? 4,
    shadowBlur: s.blur ?? 8,
    shadowColor: s.color ?? "rgba(0,0,0,0.35)",
    shadowOpacity: s.opacity ?? 1,
  };
}

function PrintEl({ el }: { el: ElementT }) {
  const common = { x: el.x, y: el.y, rotation: el.rotation ?? 0 };
  if (el.type === "text") {
    const padding = el.style?.padding ?? 0;
    const align = (el.style?.align ?? "left") as "left" | "center" | "right" | "justify";
    const valign = el.style?.verticalAlign ?? "top";
    const layout = layoutTextDoc(el.content, Math.max(1, el.w - padding * 2), undefined, align);
    let vShift = 0;
    if (valign === "middle") vShift = Math.max(0, (el.h - padding * 2 - layout.totalHeight) / 2);
    else if (valign === "bottom") vShift = Math.max(0, el.h - padding * 2 - layout.totalHeight);
    return (
      <Group {...common} width={el.w} height={el.h} {...shadowProps(el.style)}>
        {layout.items.map((item, i) => {
          const parts: string[] = [];
          if (item.style.italic) parts.push("italic");
          if (item.style.fontWeight !== 400) parts.push(String(item.style.fontWeight));
          const fontStyle = parts.join(" ") || "normal";
          const decoParts: string[] = [];
          if (item.style.underline) decoParts.push("underline");
          if (item.style.strike) decoParts.push("line-through");
          return (
            <Fragment key={i}>
              {item.style.highlight && (
                <KonvaRect
                  x={padding + item.x}
                  y={padding + vShift + item.y}
                  width={item.width}
                  height={item.baselineHeight}
                  fill={item.style.highlight}
                  listening={false}
                />
              )}
              <Text
                x={padding + item.x}
                y={padding + vShift + item.y}
                text={item.text}
                fontFamily={item.style.fontFamily}
                fontSize={
                  item.style.superscript || item.style.subscript
                    ? item.style.fontSize * 0.65
                    : item.style.fontSize
                }
                fontStyle={fontStyle}
                letterSpacing={item.style.letterSpacing}
                lineHeight={1}
                wrap="none"
                textDecoration={decoParts.join(" ")}
                fill={item.style.color}
                listening={false}
              />
            </Fragment>
          );
        })}
      </Group>
    );
  }
  if (el.type === "shape") {
    const style = el.style ?? {};
    const fill = style.fill ?? "#bdd6f7";
    const stroke = style.stroke ?? undefined;
    const strokeWidth = style.strokeWidth ?? (stroke ? 1 : 0);
    const opacity = style.opacity ?? 1;
    const sh = shadowProps(style);
    const geom = SHAPE_GEOMETRY[el.shapeKind];
    if (geom.kind === "rect") return <Rect {...common} width={el.w} height={el.h} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} cornerRadius={style.radius ?? 0} {...sh} />;
    if (geom.kind === "roundedRect") {
      const radius = style.radius ?? Math.min(el.w, el.h) / 2;
      return <Rect {...common} width={el.w} height={el.h} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} cornerRadius={radius} {...sh} />;
    }
    if (geom.kind === "ellipse") return <Ellipse {...common} x={el.x + el.w / 2} y={el.y + el.h / 2} radiusX={el.w / 2} radiusY={el.h / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} {...sh} />;
    if (geom.kind === "line" || geom.kind === "arrow") {
      const arrowStart = !!style.arrowStart || geom.kind === "arrow";
      const arrowEnd = !!style.arrowEnd || geom.kind === "arrow";
      return <Arrow {...common} points={[0, 0, el.w, el.h]} stroke={stroke ?? fill} fill={stroke ?? fill} strokeWidth={strokeWidth || 2} opacity={opacity} pointerAtBeginning={arrowStart} pointerAtEnding={arrowEnd} pointerLength={Math.max(8, (strokeWidth || 2) * 4)} pointerWidth={Math.max(8, (strokeWidth || 2) * 4)} {...sh} />;
    }
    if (geom.kind === "curve") {
      const cx = style.controlX ?? el.w / 2;
      const cy = style.controlY ?? el.h / 2;
      const arrowStart = !!style.arrowStart;
      const arrowEnd = !!style.arrowEnd;
      return <Arrow {...common} points={[0, 0, cx, cy, el.w, el.h]} tension={0.5} stroke={stroke ?? fill} fill={stroke ?? fill} strokeWidth={strokeWidth || 2} opacity={opacity} pointerAtBeginning={arrowStart} pointerAtEnding={arrowEnd} pointerLength={Math.max(8, (strokeWidth || 2) * 4)} pointerWidth={Math.max(8, (strokeWidth || 2) * 4)} {...sh} />;
    }
    return <Line {...common} points={scalePolygon(geom.points, el.w, el.h)} closed={geom.closed} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} {...sh} />;
  }
  if (el.type === "image") {
    return <PrintImage el={el} />;
  }
  if (el.type === "table") {
    return <TableEl el={el} common={common} />;
  }
  return null;
}

function PrintImage({ el }: { el: any }) {
  const src = el.src.startsWith("http") || el.src.startsWith("/") ? el.src : `/${el.src}`;
  const [img] = useImage(src, "anonymous");
  const opacity = el.style?.opacity ?? 1;
  const radius = el.style?.radius ?? 0;
  const crop = el.crop ? { x: el.crop.x, y: el.crop.y, width: el.crop.w, height: el.crop.h } : undefined;
  if (radius > 0) {
    return (
      <Group
        x={el.x}
        y={el.y}
        rotation={el.rotation ?? 0}
        width={el.w}
        height={el.h}
        clipFunc={(ctx: any) => roundRectPath(ctx, 0, 0, el.w, el.h, radius)}
      >
        <KImage width={el.w} height={el.h} image={img} opacity={opacity} crop={crop} />
      </Group>
    );
  }
  return <KImage x={el.x} y={el.y} rotation={el.rotation ?? 0} width={el.w} height={el.h} image={img} opacity={opacity} crop={crop} {...shadowProps(el.style)} />;
}
