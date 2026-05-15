import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Line, Arrow, Text, Image as KImage, Transformer, Group } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import type {
  DeckT,
  ElementT,
  ImageElementT,
  ShapeElementT,
  SlideT,
  TextElementT,
} from "@minerva/schema";
import { useStore } from "./store";
import { firstTextStyle, plainText } from "./text";
import { SHAPE_GEOMETRY, scalePolygon } from "./shapes";

type Props = {
  deck: DeckT;
  slide: SlideT;
};

export function SlideCanvas({ deck, slide }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [scale, setScale] = useState(1);

  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const updateElement = useStore((s) => s.updateElement);

  // Fit the slide into the available container.
  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el) return;
      const pad = 32;
      const w = el.clientWidth - pad * 2;
      const h = el.clientHeight - pad * 2;
      const s = Math.min(w / deck.size.w, h / deck.size.h);
      setScale(Math.max(0.05, s));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [deck.size.w, deck.size.h]);

  // Wire the transformer to the currently selected nodes.
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, slide.elements]);

  function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Click on empty area clears selection.
    if (e.target === e.target.getStage() || e.target.getAttr("data-bg")) {
      setSelection([]);
    }
  }

  return (
    <div ref={containerRef} className="canvas-area">
      <Stage
        ref={stageRef}
        width={deck.size.w * scale}
        height={deck.size.h * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={onStageMouseDown}
        style={{ background: slide.background?.fill ?? "#fff", boxShadow: "0 8px 28px rgba(0,0,0,0.4)" }}
      >
        <Layer>
          <Rect
            x={0} y={0}
            width={deck.size.w} height={deck.size.h}
            fill={slide.background?.fill ?? "#ffffff"}
            listening={true}
            data-bg
          />
          {slide.elements.map((el) => (
            <RenderElement
              key={el.id}
              el={el}
              selected={selectedIds.includes(el.id)}
              onSelect={(additive) => {
                if (additive) {
                  setSelection(
                    selectedIds.includes(el.id)
                      ? selectedIds.filter((i) => i !== el.id)
                      : [...selectedIds, el.id]
                  );
                } else {
                  setSelection([el.id]);
                }
              }}
              onChange={(patch) => updateElement(slide.id, el.id, patch)}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={[
              "top-left","top-center","top-right",
              "middle-left","middle-right",
              "bottom-left","bottom-center","bottom-right",
            ]}
            boundBoxFunc={(_old, next) => {
              if (next.width < 5 || next.height < 5) return _old;
              return next;
            }}
          />
        </Layer>
      </Stage>
    </div>
  );
}

type ElProps = {
  el: ElementT;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<ElementT>) => void;
};

function RenderElement({ el, onSelect, onChange }: ElProps) {
  // Common drag/transform handlers.
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ x: e.target.x(), y: e.target.y() } as any);
  };
  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x(),
      y: node.y(),
      w: Math.max(5, node.width() * scaleX),
      h: Math.max(5, node.height() * scaleY),
      rotation: node.rotation(),
    } as any);
  };
  const common = {
    id: el.id,
    x: el.x,
    y: el.y,
    rotation: el.rotation ?? 0,
    draggable: !el.locked,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect(e.evt.shiftKey || e.evt.metaKey);
    },
    onDragEnd,
    onTransformEnd,
  };

  switch (el.type) {
    case "text":
      return <TextEl el={el} common={common} />;
    case "shape":
      return <ShapeEl el={el} common={common} />;
    case "image":
      return <ImageEl el={el} common={common} />;
    case "group":
      return (
        <Group {...common} width={el.w} height={el.h}>
          {el.children.map((c) => (
            <RenderElement
              key={c.id}
              el={c}
              selected={false}
              onSelect={() => onSelect(false)}
              onChange={() => {}}
            />
          ))}
        </Group>
      );
  }
}

function shadowProps(style: { shadow?: { offsetX?: number; offsetY?: number; blur?: number; color?: string; opacity?: number } } | undefined) {
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

function TextEl({ el, common }: { el: TextElementT; common: any }) {
  const text = useMemo(() => plainText(el.content), [el.content]);
  const style = useMemo(() => firstTextStyle(el.content), [el.content]);
  return (
    <Text
      {...common}
      width={el.w}
      height={el.h}
      text={text}
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

function ShapeEl({ el, common }: { el: ShapeElementT; common: any }) {
  const style = el.style ?? {};
  const fill = style.fill ?? "#bdd6f7";
  const stroke = style.stroke ?? undefined;
  const strokeWidth = style.strokeWidth ?? (stroke ? 1 : 0);
  const opacity = style.opacity ?? 1;
  const shadow = shadowProps(style);

  const geom = SHAPE_GEOMETRY[el.shapeKind];

  if (geom.kind === "rect") {
    return (
      <Rect
        {...common}
        width={el.w}
        height={el.h}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        cornerRadius={style.radius ?? 0}
        {...shadow}
      />
    );
  }
  if (geom.kind === "roundedRect") {
    // For roundedRect / flowTerminator, default to a pill if no radius is set.
    const radius = style.radius ?? Math.min(el.w, el.h) / 2;
    return (
      <Rect
        {...common}
        width={el.w}
        height={el.h}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        cornerRadius={radius}
        {...shadow}
      />
    );
  }
  if (geom.kind === "ellipse") {
    return (
      <Ellipse
        {...common}
        x={el.x + el.w / 2}
        y={el.y + el.h / 2}
        radiusX={el.w / 2}
        radiusY={el.h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        {...shadow}
      />
    );
  }
  if (geom.kind === "line" || geom.kind === "arrow") {
    const arrowStart = !!style.arrowStart || geom.kind === "arrow";
    const arrowEnd = !!style.arrowEnd || geom.kind === "arrow";
    return (
      <Arrow
        {...common}
        points={[0, 0, el.w, el.h]}
        stroke={stroke ?? fill}
        fill={stroke ?? fill}
        strokeWidth={strokeWidth || 2}
        opacity={opacity}
        pointerAtBeginning={arrowStart}
        pointerAtEnding={arrowEnd}
        pointerLength={Math.max(8, (strokeWidth || 2) * 4)}
        pointerWidth={Math.max(8, (strokeWidth || 2) * 4)}
        {...shadow}
      />
    );
  }
  // Polygon shape.
  const pts = scalePolygon(geom.points, el.w, el.h);
  return (
    <Line
      {...common}
      points={pts}
      closed={geom.closed}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
      tension={0}
      {...shadow}
    />
  );
}

function ImageEl({ el, common }: { el: ImageElementT; common: any }) {
  const src = el.src.startsWith("http") || el.src.startsWith("/") ? el.src : `/${el.src}`;
  const [img] = useImage(src, "anonymous");
  return (
    <KImage
      {...common}
      width={el.w}
      height={el.h}
      image={img}
      opacity={el.style?.opacity ?? 1}
      {...shadowProps(el.style)}
    />
  );
}
