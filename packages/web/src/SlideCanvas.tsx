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
  TableElementT,
  TextElementT,
} from "@minerva/schema";
import { useStore } from "./store";
import { firstTextStyle, plainText, ensureFontLoaded, ensureFontWeightLoaded } from "./text";
import { SHAPE_GEOMETRY, scalePolygon, roundRectPath } from "./shapes";
import { TableEl } from "./TableEl";
import { submitClaudeComment } from "./sync";

type Props = {
  deck: DeckT;
  slide: SlideT;
};

export function SlideCanvas({ deck, slide }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [userScale, setUserScale] = useState<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);

  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const updateElement = useStore((s) => s.updateElement);
  const fontRevision = useStore((s) => s.fontRevision);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const addElement = useStore((s) => s.addElement);
  const formatToPaint = useStore((s) => s.formatToPaint);
  const [drawProgress, setDrawProgress] = useState<{ start: { x: number; y: number }; control?: { x: number; y: number }; cursor?: { x: number; y: number } } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string } | null>(null);
  const [commentDialog, setCommentDialog] = useState<{ x: number; y: number; elementId: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  // Snapshot of every selected element's position at the start of a group drag;
  // used to compute the per-frame delta and apply it to siblings.
  const groupDragSnapshot = useRef<Map<string, { x: number; y: number }> | null>(null);

  // Fit-to-viewport scale, used when user hasn't zoomed manually.
  const fitScale = useMemo(() => {
    if (!containerSize.w || !containerSize.h) return 1;
    const pad = 32;
    return Math.max(0.05, Math.min(
      (containerSize.w - pad * 2) / deck.size.w,
      (containerSize.h - pad * 2) / deck.size.h
    ));
  }, [containerSize, deck.size.w, deck.size.h]);
  const scale = userScale ?? fitScale;

  // Track container size for the viewport.
  useEffect(() => {
    const onResize = () => {
      const el = containerRef.current;
      if (!el) return;
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // When fit-scale is active (no user zoom), keep the slide centered.
  useEffect(() => {
    if (userScale !== null) return;
    setOffset({
      x: (containerSize.w - deck.size.w * fitScale) / 2,
      y: (containerSize.h - deck.size.h * fitScale) / 2,
    });
  }, [containerSize.w, containerSize.h, fitScale, userScale, deck.size.w, deck.size.h]);

  // Zoom toward a viewport anchor (cursor for wheel, center for keyboard).
  const zoomBy = (factor: number, anchor: { x: number; y: number }) => {
    const old = userScale ?? fitScale;
    const next = Math.max(0.05, Math.min(8, old * factor));
    if (next === old) return;
    const worldX = (anchor.x - offset.x) / old;
    const worldY = (anchor.y - offset.y) / old;
    setOffset({ x: anchor.x - worldX * next, y: anchor.y - worldY * next });
    setUserScale(next);
  };

  // Keyboard shortcuts: Cmd+= zoom in, Cmd+- zoom out, Cmd+0 reset, Space-hold pan.
  useEffect(() => {
    const center = () =>
      containerSize.w ? { x: containerSize.w / 2, y: containerSize.h / 2 } : null;
    const inTextInput = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const onKey = (e: KeyboardEvent) => {
      if (inTextInput(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const c = center(); if (c) zoomBy(1.2, c);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        const c = center(); if (c) zoomBy(1 / 1.2, c);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        setUserScale(null);
      } else if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setPanMode(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setPanMode(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [containerSize.w, containerSize.h, fitScale, offset.x, offset.y, userScale]);

  // Wheel zoom (only with modifier so plain scroll doesn't fight selection).
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!(e.evt.metaKey || e.evt.ctrlKey)) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    zoomBy(e.evt.deltaY > 0 ? 1 / 1.1 : 1.1, pointer);
  };

  // When a web font finishes loading, force Konva to re-measure & redraw all
  // text. batchDraw alone isn't enough — Konva.Text caches its glyph metrics
  // after the first measurement, so we have to dirty the layout cache by
  // re-applying the fontFamily setter (the setter calls _setTextData internally).
  useEffect(() => {
    if (fontRevision === 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.find("Text").forEach((node) => {
      const t: any = node;
      const ff = t.fontFamily?.() ?? "";
      t.fontFamily?.(ff + " ");
      t.fontFamily?.(ff);
      t.getLayer()?.batchDraw();
    });
  }, [fontRevision]);

  // Pre-load every font the current slide actually uses, so the gap between
  // first paint and font-ready is as short as possible.
  useEffect(() => {
    const tuples = new Set<string>();
    const visit = (els: ElementT[]) => {
      for (const el of els) {
        if (el.type === "text") {
          const fs = firstTextStyle(el.content);
          if (fs.fontFamily) {
            const weight = fs.fontWeight ?? (fs.bold ? 700 : 400);
            tuples.add(`${fs.fontFamily}|${weight}|${fs.italic ? "1" : "0"}`);
          }
        } else if (el.type === "table") {
          const family = el.style?.fontFamily;
          if (family) {
            const weight = el.style?.headerFontWeight ?? 400;
            tuples.add(`${family}|400|0`);
            tuples.add(`${family}|${weight}|0`);
          }
          for (const row of el.cells) for (const cell of row) {
            const fs = firstTextStyle(cell.content);
            if (fs.fontFamily) {
              const w = fs.fontWeight ?? (fs.bold ? 700 : 400);
              tuples.add(`${fs.fontFamily}|${w}|${fs.italic ? "1" : "0"}`);
            }
          }
        } else if (el.type === "group") {
          visit(el.children);
        }
      }
    };
    visit(slide.elements);
    for (const t of tuples) {
      const [family, weight, italic] = t.split("|");
      ensureFontLoaded(family);
      ensureFontWeightLoaded(family, parseInt(weight, 10), italic === "1");
    }
  }, [slide.elements]);

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

  function localPointer() {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getRelativePointerPosition();
    return p ? { x: p.x, y: p.y } : null;
  }

  function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (panMode) return; // pan drag owns the gesture
    if (tool === "curve") {
      const p = localPointer();
      if (!p) return;
      e.cancelBubble = true;
      if (!drawProgress) {
        setDrawProgress({ start: p, cursor: p });
      } else if (!drawProgress.control) {
        setDrawProgress({ start: drawProgress.start, control: p, cursor: p });
      } else {
        // Finalize: third click is the end point.
        const s = drawProgress.start;
        const c = drawProgress.control;
        const newEl = {
          id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: "shape" as const,
          shapeKind: "curveQuad" as const,
          x: s.x,
          y: s.y,
          w: p.x - s.x,
          h: p.y - s.y,
          rotation: 0,
          style: {
            stroke: "#333",
            strokeWidth: 2,
            opacity: 1,
            controlX: c.x - s.x,
            controlY: c.y - s.y,
          },
        };
        addElement(slide.id, newEl as any);
        setDrawProgress(null);
        setTool("select");
      }
      return;
    }
    // Click on empty area clears selection.
    if (e.target === e.target.getStage() || e.target.getAttr("data-bg")) {
      setSelection([]);
    }
  }

  function onStageMouseMove() {
    if (tool !== "curve" || !drawProgress) return;
    const p = localPointer();
    if (!p) return;
    setDrawProgress({ ...drawProgress, cursor: p });
  }

  function findElementIdFromTarget(target: Konva.Node): string | null {
    const ids = new Set(slide.elements.map((e) => e.id));
    let n: Konva.Node | null = target;
    while (n) {
      const id = (n as any).id?.();
      if (id && ids.has(id)) return id;
      n = (n as any).getParent?.() ?? null;
    }
    return null;
  }

  function onStageContextMenu(e: Konva.KonvaEventObject<PointerEvent>) {
    e.evt.preventDefault();
    if (tool === "curve") return;
    const elementId = findElementIdFromTarget(e.target);
    if (!elementId) {
      setContextMenu(null);
      return;
    }
    // Make sure the element is selected so the visual cue matches the menu target.
    if (!selectedIds.includes(elementId)) setSelection([elementId]);
    setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, elementId });
  }

  async function submitComment() {
    if (!commentDialog || !commentText.trim()) return;
    setCommentSubmitting(true);
    try {
      await submitClaudeComment({
        slideId: slide.id,
        targetIds: [commentDialog.elementId],
        request: commentText.trim(),
      });
      setCommentDialog(null);
      setCommentText("");
    } catch (err) {
      console.error(err);
      alert(`Failed to save comment: ${(err as Error).message}`);
    } finally {
      setCommentSubmitting(false);
    }
  }

  // Dismiss menus on Escape or click-outside.
  useEffect(() => {
    if (!contextMenu && !commentDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        if (!commentSubmitting) {
          setCommentDialog(null);
          setCommentText("");
        }
      }
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest(".context-menu") && !t.closest(".comment-dialog")) {
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDoc);
    };
  }, [contextMenu, commentDialog, commentSubmitting]);

  // Escape cancels in-flight drawing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (drawProgress || tool === "curve")) {
        setDrawProgress(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawProgress, tool, setTool]);

  // Group-move support: when a drag starts on a selected element and more than
  // one element is selected, snapshot every selected node's starting position
  // so we can apply the dragged element's delta to its siblings each frame.
  const onStageDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (e.target === stage) return; // stage drag is the pan gesture
    const id: string | undefined = (e.target as any).id?.();
    if (!id || !selectedIds.includes(id) || selectedIds.length < 2) {
      groupDragSnapshot.current = null;
      return;
    }
    const snap = new Map<string, { x: number; y: number }>();
    for (const sid of selectedIds) {
      // Skip locked elements so they stay put.
      const el = slide.elements.find((x) => x.id === sid);
      if (el?.locked) continue;
      const node = stage.findOne(`#${sid}`);
      if (node) snap.set(sid, { x: node.x(), y: node.y() });
    }
    groupDragSnapshot.current = snap;
  };

  const onStageDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const snap = groupDragSnapshot.current;
    if (!snap) return;
    const id: string | undefined = (e.target as any).id?.();
    if (!id || !snap.has(id)) return;
    const start = snap.get(id)!;
    const dx = e.target.x() - start.x;
    const dy = e.target.y() - start.y;
    const stage = stageRef.current;
    if (!stage) return;
    for (const [sid, sstart] of snap.entries()) {
      if (sid === id) continue;
      const node = stage.findOne(`#${sid}`);
      if (!node) continue;
      node.x(sstart.x + dx);
      node.y(sstart.y + dy);
    }
  };

  const onStageDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Stage's own drag = the pan gesture.
    if (e.target === e.target.getStage()) {
      setOffset({ x: e.target.x(), y: e.target.y() });
      return;
    }
    // Element drag — if a group snapshot was set, commit every selected node's
    // new position to the store in one pass.
    const snap = groupDragSnapshot.current;
    if (!snap) return;
    const stage = stageRef.current;
    if (!stage) return;
    for (const sid of snap.keys()) {
      const node = stage.findOne(`#${sid}`);
      if (node) updateElement(slide.id, sid, { x: node.x(), y: node.y() } as any);
    }
    groupDragSnapshot.current = null;
  };

  return (
    <div ref={containerRef} className="canvas-area" style={{ cursor: panMode ? "grab" : tool === "curve" ? "crosshair" : formatToPaint ? "copy" : "default" }}>
      <Stage
        ref={stageRef}
        width={containerSize.w}
        height={containerSize.h}
        x={offset.x}
        y={offset.y}
        scaleX={scale}
        scaleY={scale}
        draggable={tool !== "curve"}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onDragStart={onStageDragStart}
        onDragMove={onStageDragMove}
        onDragEnd={onStageDragEnd}
        onWheel={onWheel}
        onContextMenu={onStageContextMenu}
      >
        <Layer>
          <Rect
            x={0} y={0}
            width={deck.size.w} height={deck.size.h}
            fill={slide.background?.fill ?? "#ffffff"}
            shadowOffsetX={0}
            shadowOffsetY={8 / scale}
            shadowBlur={28 / scale}
            shadowColor="rgba(0,0,0,0.4)"
            shadowOpacity={1}
            listening={true}
            data-bg
          />
          {slide.elements.map((el) => (
            <RenderElement
              key={el.id}
              el={el}
              pointerPaused={panMode || tool === "curve"}
              selected={selectedIds.includes(el.id)}
              groupDragActive={selectedIds.length > 1 && selectedIds.includes(el.id)}
              onSelect={(additive) => {
                if (additive) {
                  setSelection(
                    selectedIds.includes(el.id)
                      ? selectedIds.filter((i) => i !== el.id)
                      : [...selectedIds, el.id]
                  );
                } else if (selectedIds.includes(el.id)) {
                  // Already part of the current (possibly multi-) selection —
                  // keep it as is so a subsequent drag moves the whole group.
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
          {drawProgress && (() => {
            const s = drawProgress.start;
            const c = drawProgress.control ?? drawProgress.cursor ?? s;
            const e = drawProgress.cursor ?? c;
            const pts = drawProgress.control
              ? [s.x, s.y, c.x, c.y, e.x, e.y]
              : [s.x, s.y, e.x, e.y];
            return (
              <Arrow
                points={pts}
                tension={drawProgress.control ? 0.5 : 0}
                stroke="#3b6ea8"
                strokeWidth={2}
                dash={[6, 6]}
                listening={false}
                pointerLength={0}
                pointerWidth={0}
              />
            );
          })()}
        </Layer>
      </Stage>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => {
              setCommentDialog({ x: contextMenu.x, y: contextMenu.y, elementId: contextMenu.elementId });
              setContextMenu(null);
            }}
          >
            Leave Claude comment…
          </button>
        </div>
      )}
      {commentDialog && (
        <div
          className="comment-dialog"
          style={{
            position: "fixed",
            left: Math.min(commentDialog.x, window.innerWidth - 340),
            top: Math.min(commentDialog.y, window.innerHeight - 220),
            zIndex: 1001,
          }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="comment-dialog-header">
            Comment for Claude · <code style={{ fontSize: 11 }}>{commentDialog.elementId}</code>
          </div>
          <textarea
            autoFocus
            rows={4}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Tell Claude what to do with this element…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitComment();
              }
            }}
          />
          <div className="comment-dialog-actions">
            <button
              onClick={() => {
                setCommentDialog(null);
                setCommentText("");
              }}
              disabled={commentSubmitting}
            >
              Cancel
            </button>
            <button onClick={submitComment} disabled={commentSubmitting || !commentText.trim()}>
              {commentSubmitting ? "Saving…" : "Send · ⌘⏎"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ElProps = {
  el: ElementT;
  /** True when the canvas is in a mode that should ignore element interaction
   *  (pan-drag with space, or drawing a curve). Disables drag, listening, and
   *  the select-on-mousedown so clicks pass through to the stage. */
  pointerPaused: boolean;
  selected: boolean;
  /** True when this element is part of a multi-element selection. The stage-level
   *  drag handlers will commit the new position for every selected element at once,
   *  so the per-element onDragEnd should not also write to the store. */
  groupDragActive: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<ElementT>) => void;
};

function RenderElement({ el, pointerPaused, selected, groupDragActive, onSelect, onChange }: ElProps) {
  // Common drag/transform handlers.
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (groupDragActive) return; // stage-level handler commits all selected at once
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
    // Two-step model: first click selects, second click (and drag) moves the element.
    // While unselected, the element is not draggable so a click+drag bubbles to the
    // stage as a pan gesture.
    draggable: !el.locked && !pointerPaused && selected,
    listening: !pointerPaused,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (pointerPaused) return;
      onSelect(e.evt.shiftKey || e.evt.metaKey);
      if (selected) {
        // Already selected — element drag should own this gesture.
        e.cancelBubble = true;
      }
      // Else: let the event bubble so the stage's pan-drag can pick it up if the user drags.
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
    case "table":
      return <TableEl el={el} common={common} />;
    case "group":
      return (
        <Group {...common} width={el.w} height={el.h}>
          {el.children.map((c) => (
            <RenderElement
              key={c.id}
              el={c}
              pointerPaused={pointerPaused}
              selected={false}
              groupDragActive={false}
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
      text={text}
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
  if (geom.kind === "curve") {
    const cx = style.controlX ?? el.w / 2;
    const cy = style.controlY ?? el.h / 2;
    const arrowStart = !!style.arrowStart;
    const arrowEnd = !!style.arrowEnd;
    return (
      <Arrow
        {...common}
        points={[0, 0, cx, cy, el.w, el.h]}
        tension={0.5}
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
  const opacity = el.style?.opacity ?? 1;
  const radius = (el.style as any)?.radius ?? 0;
  if (radius > 0) {
    return (
      <Group
        {...common}
        width={el.w}
        height={el.h}
        clipFunc={(ctx: any) => roundRectPath(ctx, 0, 0, el.w, el.h, radius)}
      >
        <KImage width={el.w} height={el.h} image={img} opacity={opacity} />
      </Group>
    );
  }
  return (
    <KImage
      {...common}
      width={el.w}
      height={el.h}
      image={img}
      opacity={opacity}
      {...shadowProps(el.style)}
    />
  );
}
