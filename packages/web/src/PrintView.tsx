import { useEffect, useState } from "react";
import { Stage, Layer, Rect } from "react-konva";
import type { DeckT, ElementT, SlideT } from "@minerva/schema";
import { Text, Ellipse, Image as KImage, Line, Arrow } from "react-konva";
import useImage from "use-image";
import { firstTextStyle, plainText, ensureFontLoaded } from "./text";
import { SHAPE_GEOMETRY, scalePolygon } from "./shapes";

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
      // Pre-load every font that appears in the deck.
      const families = new Set<string>();
      for (const slide of d.slides) {
        for (const el of slide.elements) {
          if (el.type === "text") {
            const fs = firstTextStyle(el.content);
            if (fs.fontFamily) families.add(fs.fontFamily);
          }
        }
      }
      await Promise.all(Array.from(families).map((f) => ensureFontLoaded(f)));
      // Give browser a tick to apply fonts + load images via konva.
      setTimeout(() => setReady(true), 250);
    });
  }, []);

  if (!deck) return <div>Loading…</div>;

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
        {deck.slides.map((slide) => (
          <div key={slide.id} className="print-slide">
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
    const style = firstTextStyle(el.content);
    return (
      <Text
        {...common}
        width={el.w}
        height={el.h}
        text={plainText(el.content)}
        align={el.style?.align ?? "left"}
        verticalAlign={el.style?.verticalAlign ?? "top"}
        padding={el.style?.padding ?? 0}
        fontFamily={style.fontFamily ?? "Inter, system-ui, sans-serif"}
        fontSize={style.fontSize ?? 24}
        fontStyle={`${style.italic ? "italic" : ""} ${style.bold ? "bold" : ""}`.trim() || "normal"}
        textDecoration={style.underline ? "underline" : ""}
        fill={style.color ?? "#111"}
        {...shadowProps(el.style)}
      />
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
    return <Line {...common} points={scalePolygon(geom.points, el.w, el.h)} closed={geom.closed} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} {...sh} />;
  }
  if (el.type === "image") {
    return <PrintImage el={el} />;
  }
  return null;
}

function PrintImage({ el }: { el: any }) {
  const src = el.src.startsWith("http") || el.src.startsWith("/") ? el.src : `/${el.src}`;
  const [img] = useImage(src, "anonymous");
  return <KImage x={el.x} y={el.y} rotation={el.rotation ?? 0} width={el.w} height={el.h} image={img} opacity={el.style?.opacity ?? 1} {...shadowProps(el.style)} />;
}
