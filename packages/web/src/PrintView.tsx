import { useEffect, useState } from "react";
import { Stage, Layer, Rect } from "react-konva";
import type { DeckT, ElementT, SlideT } from "@minerva/schema";
import { Text, Ellipse, Image as KImage, Line, Arrow } from "react-konva";
import useImage from "use-image";
import { firstTextStyle, plainText, ensureFontLoaded, ensureFontWeightLoaded } from "./text";
import { SHAPE_GEOMETRY, scalePolygon, roundRectPath } from "./shapes";
import { Group } from "react-konva";
import { TableEl } from "./TableEl";

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
      // Walk every text element so we pre-load each (family, weight, italic)
      // tuple the deck actually uses — listing a weight in the Google Fonts
      // URL is not enough; the file is only fetched when something uses it.
      const families = new Set<string>();
      const tuples = new Set<string>(); // family|weight|italic
      for (const slide of d.slides) {
        for (const el of slide.elements) {
          if (el.type !== "text") continue;
          const fs = firstTextStyle(el.content);
          const family = fs.fontFamily;
          if (!family) continue;
          families.add(family);
          const weight = fs.fontWeight ?? (fs.bold ? 700 : 400);
          tuples.add(`${family}|${weight}|${fs.italic ? "1" : "0"}`);
        }
      }
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
    const style = firstTextStyle(el.content);
    const weight = style.fontWeight ?? (style.bold ? 700 : undefined);
    const parts: string[] = [];
    if (style.italic) parts.push("italic");
    if (weight !== undefined) parts.push(String(weight));
    const fontStyle = parts.join(" ") || "normal";
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
        fontStyle={fontStyle}
        lineHeight={style.lineHeight ?? 1}
        letterSpacing={style.letterSpacing ?? 0}
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
        <KImage width={el.w} height={el.h} image={img} opacity={opacity} />
      </Group>
    );
  }
  return <KImage x={el.x} y={el.y} rotation={el.rotation ?? 0} width={el.w} height={el.h} image={img} opacity={opacity} {...shadowProps(el.style)} />;
}
