import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { useStore, scaleElement } from "./store";
import { firstTextStyle, plainText, plainTextDoc, ensureFontLoaded, ensureFontWeightLoaded, layoutTextDoc } from "./text";
import { SHAPE_GEOMETRY, scalePolygon, roundRectPath } from "./shapes";
import { TableEl } from "./TableEl";
import { submitClaudeComment } from "./sync";
import { TextEditOverlay } from "./TextEditOverlay";
import { CellEditOverlay } from "./CellEditOverlay";
import { CommentLayer } from "./CommentLayer";

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
  // Cmd/Ctrl is held → empty-area drag becomes a marquee instead of panning.
  const [cmdHeld, setCmdHeld] = useState(false);
  const [marquee, setMarquee] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);
  // Image being cropped via double-click. Replaces normal render of that element.
  const [cropping, setCropping] = useState<string | null>(null);
  // Text element being edited inline via double-click (TipTap overlay).
  const [editingText, setEditingText] = useState<string | null>(null);
  // Single table cell being edited inline. Identified by (tableId, row, col).
  const [editingCell, setEditingCell] = useState<{ tableId: string; row: number; col: number } | null>(null);

  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const updateElement = useStore((s) => s.updateElement);
  const fontRevision = useStore((s) => s.fontRevision);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const pendingShapeKind = useStore((s) => s.pendingShapeKind);
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

  // Sync Cmd/Ctrl-held state so the Stage can disable pan-drag and the next
  // empty-area drag becomes a marquee selection instead.
  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent) => setCmdHeld(e.metaKey || e.ctrlKey);
    const clear = () => setCmdHeld(false);
    window.addEventListener("keydown", sync as any);
    window.addEventListener("keyup", sync as any);
    window.addEventListener("mousedown", sync as any);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync as any);
      window.removeEventListener("keyup", sync as any);
      window.removeEventListener("mousedown", sync as any);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Keyboard shortcuts: Cmd+= zoom in, Cmd+- zoom out, Cmd+0 reset, Space-hold pan.
  useEffect(() => {
    const center = () =>
      containerSize.w ? { x: containerSize.w / 2, y: containerSize.h / 2 } : null;
    const inTextInput = (t: EventTarget | null) =>
      t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
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
    // Default base family matches DEFAULT_RUN_STYLE.fontFamily in layoutTextDoc
    // so we pre-load the right weight even for runs that have no explicit
    // textStyle.fontFamily mark (e.g. a bold mark in otherwise-plain text).
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
        tuples.add(`${family}|${weight}|${italic ? "1" : "0"}`);
      }
      if (Array.isArray(doc.content)) for (const c of doc.content) collectFromDoc(c, baseFamily, baseWeight);
    };
    const visit = (els: ElementT[]) => {
      for (const el of els) {
        if (el.type === "text") {
          collectFromDoc(el.content);
        } else if (el.type === "table") {
          const family = el.style?.fontFamily;
          if (family) {
            const weight = el.style?.headerFontWeight ?? 400;
            tuples.add(`${family}|400|0`);
            tuples.add(`${family}|${weight}|0`);
          }
          for (const row of el.cells) for (const cell of row) {
            collectFromDoc(cell.content, el.style?.fontFamily);
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
    // Cmd/Ctrl-drag starts a marquee, anywhere — including over an element.
    // Selection is *not* cleared here; mouseup decides whether this gesture
    // was a drag (replace selection with marquee result) or a no-drag click
    // (leave selection alone so the element's own onMouseDown handler — which
    // already toggled additively — owns the change).
    if (
      (e.evt.metaKey || e.evt.ctrlKey) &&
      tool === "select"
    ) {
      const p = localPointer();
      if (p) setMarquee({ start: p, current: p });
      return;
    }
    if (tool === "line" || tool === "arrow") {
      const p = localPointer();
      if (!p) return;
      e.cancelBubble = true;
      if (!drawProgress) {
        setDrawProgress({ start: p, cursor: p });
      } else {
        // Second click finalizes the line/arrow.
        const s = drawProgress.start;
        const newEl = {
          id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: "shape" as const,
          shapeKind: tool,
          x: s.x,
          y: s.y,
          w: p.x - s.x,
          h: p.y - s.y,
          rotation: 0,
          style: { stroke: "#333", strokeWidth: 2, opacity: 1 },
        };
        addElement(slide.id, newEl as any);
        setDrawProgress(null);
        setTool("select");
      }
      return;
    }
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
    if (tool === "shape" || tool === "text") {
      const p = localPointer();
      if (!p) return;
      e.cancelBubble = true;
      if (!drawProgress) {
        setDrawProgress({ start: p, cursor: p });
      } else {
        // Two-click bounding box: normalize so width/height are positive even
        // if the user dragged up-and-left.
        const s = drawProgress.start;
        const x = Math.min(s.x, p.x);
        const y = Math.min(s.y, p.y);
        let w = Math.abs(p.x - s.x);
        let h = Math.abs(p.y - s.y);
        // Tiny drags / accidental double-clicks: enforce a usable minimum so
        // the new element isn't a zero-size phantom.
        const MIN_W = tool === "text" ? 200 : 80;
        const MIN_H = tool === "text" ? 60 : 60;
        if (w < MIN_W) w = MIN_W;
        if (h < MIN_H) h = MIN_H;
        const id = `${tool === "text" ? "text" : "shape"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        let newEl: ElementT;
        if (tool === "text") {
          newEl = {
            id,
            type: "text",
            x, y, w, h, rotation: 0,
            content: plainTextDoc("New text"),
            style: { align: "left", padding: 8 },
          };
        } else {
          // pendingShapeKind set by the toolbar; fall back to rect if it
          // somehow got cleared so the click still produces something visible.
          const kind = pendingShapeKind ?? "rect";
          newEl = {
            id,
            type: "shape",
            shapeKind: kind,
            x, y, w, h, rotation: 0,
            style: { fill: "#bdd6f7", stroke: "#3b6ea8", strokeWidth: 1, opacity: 1 },
          };
        }
        addElement(slide.id, newEl);
        setDrawProgress(null);
        setTool("select");
        // For a freshly placed text box, jump straight into inline edit so
        // the user can type — matches the muscle memory of just typing after
        // adding a text box in Google Slides.
        if (tool === "text") {
          setEditingText(id);
        }
      }
      return;
    }
    // Click on empty area clears selection.
    if (e.target === e.target.getStage() || e.target.getAttr("data-bg")) {
      setSelection([]);
    }
  }

  function onStageMouseMove() {
    if (marquee) {
      const p = localPointer();
      if (p) setMarquee({ ...marquee, current: p });
      return;
    }
    if (tool === "select" || !drawProgress) return;
    const p = localPointer();
    if (!p) return;
    setDrawProgress({ ...drawProgress, cursor: p });
  }

  function onStageMouseUp() {
    if (!marquee) return;
    // Treat micro-movements as a click, not a drag: leaves any additive
    // selection that the element's onMouseDown made untouched. Otherwise
    // overwrite selection with whatever's inside the dashed rect.
    const dx = Math.abs(marquee.current.x - marquee.start.x);
    const dy = Math.abs(marquee.current.y - marquee.start.y);
    const dragged = dx > 4 || dy > 4;
    if (dragged) {
      const ids = elementsInsideRect(slide.elements, marquee);
      setSelection(ids);
    }
    setMarquee(null);
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

  function onStageDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    if (panMode || tool !== "select") return;
    const id = findElementIdFromTarget(e.target);
    if (!id) return;
    const el = slide.elements.find((x) => x.id === id);
    if (!el || el.type !== "image") return;
    e.evt.preventDefault();
    setSelection([]);
    setCropping(id);
  }

  // Escape / Enter / clicking the empty stage exits crop mode (crop draft is
  // already committed to the deck on every drag/resize, so exit is just UI state).
  useEffect(() => {
    if (!cropping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") setCropping(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cropping]);

  function onStageContextMenu(e: Konva.KonvaEventObject<PointerEvent>) {
    e.evt.preventDefault();
    if (tool !== "select") return;
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
      if (e.key === "Escape" && (drawProgress || tool !== "select")) {
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
    // new position to the store in one batched mutate so undo reverts the
    // whole group-move as a single step, not one element at a time.
    const snap = groupDragSnapshot.current;
    if (!snap) return;
    const stage = stageRef.current;
    if (!stage) return;
    const patches: Array<{ id: string; patch: Partial<ElementT> }> = [];
    for (const sid of snap.keys()) {
      const node = stage.findOne(`#${sid}`);
      if (node) patches.push({ id: sid, patch: { x: node.x(), y: node.y() } });
    }
    if (patches.length > 0) useStore.getState().updateElements(slide.id, patches);
    groupDragSnapshot.current = null;
  };

  return (
    <div ref={containerRef} className="canvas-area" style={{ cursor: panMode ? "grab" : tool !== "select" ? "crosshair" : formatToPaint ? "copy" : "default" }}>
      <Stage
        ref={stageRef}
        width={containerSize.w}
        height={containerSize.h}
        x={offset.x}
        y={offset.y}
        scaleX={scale}
        scaleY={scale}
        draggable={tool === "select" && !cmdHeld && !marquee}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onDblClick={onStageDblClick}
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
          {slide.elements.map((el) => (el.id === cropping || el.id === editingText) ? null : (
            <RenderElement
              key={el.id}
              el={el}
              pointerPaused={panMode || tool !== "select" || !!cropping || !!editingText || !!editingCell}
              selected={selectedIds.includes(el.id)}
              groupDragActive={selectedIds.length > 1 && selectedIds.includes(el.id)}
              scale={scale}
              onEditCell={el.type === "table" ? (row, col) => {
                setSelection([el.id]);
                setEditingCell({ tableId: el.id, row, col });
              } : undefined}
              editingCellId={editingCell && editingCell.tableId === el.id
                ? `${editingCell.tableId}::${editingCell.row}-${editingCell.col}`
                : null}
              onDoubleClick={
                el.type === "image"
                  ? () => { setSelection([]); setCropping(el.id); }
                  : el.type === "text"
                    // Keep the element selected so the inspector text section
                    // (with TipTap-aware formatting controls) stays visible.
                    ? () => { setSelection([el.id]); setEditingText(el.id); }
                    : undefined
              }
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
          {/* When multiple elements are selected, the Transformer wraps just
              one bbox around the union — you can't see which individual
              elements are in the selection. Add a dashed outline per element
              so the membership is obvious. Skip for single-select since the
              Transformer's own bbox is already unambiguous. */}
          {selectedIds.length > 1 && selectedIds.map((id) => {
            const el = slide.elements.find((e) => e.id === id);
            if (!el) return null;
            const isLine = el.type === "shape" && ["line", "arrow", "curveQuad"].includes((el as any).shapeKind);
            // Lines encode direction via signed w/h, so use the normalized
            // bbox and skip rotation (lines don't carry a separate rotation).
            const bx = el.w < 0 ? el.x + el.w : el.x;
            const by = el.h < 0 ? el.y + el.h : el.y;
            return (
              <Rect
                key={`sel-${id}`}
                x={isLine ? bx : el.x}
                y={isLine ? by : el.y}
                width={Math.abs(el.w)}
                height={Math.abs(el.h)}
                rotation={isLine ? 0 : (el.rotation ?? 0)}
                stroke="#4a90e2"
                strokeWidth={1.5 / scale}
                dash={[6 / scale, 4 / scale]}
                listening={false}
                fillEnabled={false}
              />
            );
          })}
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
          {cropping && (() => {
            const el = slide.elements.find((x) => x.id === cropping);
            if (!el || el.type !== "image") return null;
            return <CropEditor el={el} slideId={slide.id} scale={scale} />;
          })()}
          {marquee && (() => {
            const x1 = Math.min(marquee.start.x, marquee.current.x);
            const y1 = Math.min(marquee.start.y, marquee.current.y);
            const x2 = Math.max(marquee.start.x, marquee.current.x);
            const y2 = Math.max(marquee.start.y, marquee.current.y);
            return (
              <Rect
                x={x1}
                y={y1}
                width={x2 - x1}
                height={y2 - y1}
                fill="rgba(74, 144, 226, 0.12)"
                stroke="#4a90e2"
                strokeWidth={1 / scale}
                dash={[6 / scale, 4 / scale]}
                listening={false}
              />
            );
          })()}
          {drawProgress && (tool === "shape" || tool === "text") && (() => {
            // 2-click bounding box preview for shape/text placement.
            const s = drawProgress.start;
            const c = drawProgress.cursor ?? s;
            const x = Math.min(s.x, c.x);
            const y = Math.min(s.y, c.y);
            const w = Math.abs(c.x - s.x);
            const h = Math.abs(c.y - s.y);
            return (
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                stroke="#3b6ea8"
                strokeWidth={1 / scale}
                dash={[6 / scale, 4 / scale]}
                listening={false}
              />
            );
          })()}
          {drawProgress && (tool === "line" || tool === "arrow" || tool === "curve") && (() => {
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
      {editingText && (() => {
        const el = slide.elements.find((x) => x.id === editingText);
        if (!el || el.type !== "text") return null;
        return (
          <TextEditOverlay
            el={el}
            slideId={slide.id}
            containerOffset={offset}
            scale={scale}
            onExit={() => setEditingText(null)}
          />
        );
      })()}
      {editingCell && (() => {
        const t = slide.elements.find((x) => x.id === editingCell.tableId);
        if (!t || t.type !== "table") return null;
        return (
          <CellEditOverlay
            el={t}
            row={editingCell.row}
            col={editingCell.col}
            offset={offset}
            scale={scale}
            onExit={() => setEditingCell(null)}
          />
        );
      })()}
      <CommentLayer slide={slide} offset={offset} scale={scale} />

      {contextMenu && (() => {
        // Which group/ungroup actions are available depends on the live
        // selection, not just the right-clicked element.
        const canGroup = selectedIds.length >= 2;
        const ctxEl = slide.elements.find((e) => e.id === contextMenu.elementId);
        const canUngroup = selectedIds.length === 1 && ctxEl?.type === "group";
        return (
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
          {canGroup && (
            <button
              onClick={() => {
                useStore.getState().groupSelected(slide.id);
                setContextMenu(null);
              }}
              title="Wrap the selected elements into a single group"
            >
              Group ({selectedIds.length})
            </button>
          )}
          {canUngroup && (
            <button
              onClick={() => {
                useStore.getState().ungroup(slide.id, contextMenu.elementId);
                setContextMenu(null);
              }}
              title="Lift the group's children back out as individual elements"
            >
              Ungroup
            </button>
          )}
        </div>
        );
      })()}
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
  /** When set, double-clicking this element enters crop mode (image only). */
  onDoubleClick?: () => void;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<ElementT>) => void;
  /** Visual scale, threaded down so children that draw hit-handles can keep
   *  them a constant pixel size at any zoom. */
  scale?: number;
  /** Table-only: called when the user double-clicks a cell to start editing. */
  onEditCell?: (row: number, col: number) => void;
  /** Table-only: id of the cell currently being edited (formatted as
   *  `${tableId}::${row}-${col}`) so its plain-text render can be suppressed
   *  while an overlay handles the input. */
  editingCellId?: string | null;
};

function RenderElement({ el, pointerPaused, selected, groupDragActive, onDoubleClick, onSelect, onChange, scale = 1, onEditCell, editingCellId }: ElProps) {
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
      const cmd = e.evt.metaKey || e.evt.ctrlKey;
      // Toggle additively on shift OR cmd. The toggle stands when the user
      // *clicks* without dragging; if they drag, the stage-level marquee
      // overwrites the selection on mouseup.
      onSelect(e.evt.shiftKey || cmd);
      if (selected && !cmd) {
        // Already selected — element drag should own this gesture. But when
        // cmd is held, always let it bubble so the stage can start a marquee
        // from on top of an element.
        e.cancelBubble = true;
      }
    },
    onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (pointerPaused) return;
      if (!onDoubleClick) return;
      e.cancelBubble = true;
      onDoubleClick();
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
      return (
        <TableEl
          el={el}
          common={common}
          scale={scale}
          onEditCell={onEditCell}
          onResizeTracks={(patch) => onChange(patch as Partial<ElementT>)}
          editingCellId={editingCellId ?? null}
        />
      );
    case "group": {
      // Resizing a group: the transformer changes scaleX/scaleY on the Konva
      // Group, which visually scales all children via the parent transform —
      // but the children's stored x/y/w/h don't change. Bake the scale into
      // every child (recursively) so the new size sticks across re-renders.
      const onGroupTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const s = (sx + sy) / 2;
        onChange({
          x: node.x(),
          y: node.y(),
          w: Math.max(5, el.w * sx),
          h: Math.max(5, el.h * sy),
          rotation: node.rotation(),
          children: el.children.map((c) => scaleElement(c, sx, sy, s)),
        } as any);
      };
      return (
        <Group {...common} onTransformEnd={onGroupTransformEnd} width={el.w} height={el.h}>
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
          {/* (group children get no double-click crop handler — only top-level images do) */}
        </Group>
      );
    }
  }
}

/** Return the ids of every element whose bounding box intersects the marquee. */
function elementsInsideRect(
  elements: ElementT[],
  m: { start: { x: number; y: number }; current: { x: number; y: number } }
): string[] {
  const x1 = Math.min(m.start.x, m.current.x);
  const y1 = Math.min(m.start.y, m.current.y);
  const x2 = Math.max(m.start.x, m.current.x);
  const y2 = Math.max(m.start.y, m.current.y);
  return elements
    .filter((el) => {
      // Lines/curves can have negative w/h, so normalize the element bbox too.
      const eMinX = Math.min(el.x, el.x + el.w);
      const eMinY = Math.min(el.y, el.y + el.h);
      const eMaxX = Math.max(el.x, el.x + el.w);
      const eMaxY = Math.max(el.y, el.y + el.h);
      return !(eMaxX < x1 || eMinX > x2 || eMaxY < y1 || eMinY > y2);
    })
    .map((e) => e.id);
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
  // Walk the TipTap doc and lay out each text run with its own style. Falls
  // back gracefully to the single-style path when the doc has only one run.
  const padding = el.style?.padding ?? 0;
  const align = (el.style?.align ?? "left") as "left" | "center" | "right" | "justify";
  const valign = el.style?.verticalAlign ?? "top";
  // fontRevision in the deps recomputes layout once webfonts actually load,
  // so glyph widths reflect the loaded font rather than the system fallback.
  const fontRev = useStore((s) => s.fontRevision);
  const layout = useMemo(
    () => layoutTextDoc(el.content, Math.max(1, el.w - padding * 2), undefined, align),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [el.content, el.w, padding, align, fontRev]
  );
  let vShift = 0;
  if (valign === "middle") vShift = Math.max(0, (el.h - padding * 2 - layout.totalHeight) / 2);
  else if (valign === "bottom") vShift = Math.max(0, el.h - padding * 2 - layout.totalHeight);
  return (
    <Group {...common} width={el.w} height={el.h} {...shadowProps(el.style)}>
      {/* Invisible hit-rect so the whole element box catches mousedown/dblclick
          even when text runs (which are listening:false) don't fill the area. */}
      <Rect x={0} y={0} width={el.w} height={el.h} fill="rgba(0,0,0,0.001)" />
      {layout.items.map((item, i) => (
        <Fragment key={i}>
          {item.style.highlight && (
            <Rect
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
            fontStyle={fontStyleString(item.style)}
            letterSpacing={item.style.letterSpacing}
            lineHeight={1}
            wrap="none"
            textDecoration={textDecorationString(item.style)}
            fill={item.style.color}
            listening={false}
          />
        </Fragment>
      ))}
    </Group>
  );
}

function fontStyleString(s: { italic?: boolean; fontWeight?: number }): string {
  const parts: string[] = [];
  if (s.italic) parts.push("italic");
  if (s.fontWeight !== undefined && s.fontWeight !== 400) parts.push(String(s.fontWeight));
  return parts.join(" ") || "normal";
}

function textDecorationString(s: { underline?: boolean; strike?: boolean }): string {
  const parts: string[] = [];
  if (s.underline) parts.push("underline");
  if (s.strike) parts.push("line-through");
  return parts.join(" ");
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
        // Generous invisible hit area so thin lines are easy to click on.
        hitStrokeWidth={Math.max(24, (strokeWidth || 2) * 4)}
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
        hitStrokeWidth={Math.max(24, (strokeWidth || 2) * 4)}
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

/**
 * Crop-mode overlay: shows the full source image in the element's slot, masks
 * the area outside the current crop with black bars, and provides a draggable/
 * resizable crop rectangle. Every adjustment commits to the deck immediately,
 * so exiting crop mode is purely a UI-state change.
 */
function CropEditor({ el, slideId, scale }: { el: ImageElementT; slideId: string; scale: number }) {
  const src = el.src.startsWith("http") || el.src.startsWith("/") ? el.src : `/${el.src}`;
  const [img] = useImage(src, "anonymous");
  const updateElement = useStore((s) => s.updateElement);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rectRef = useRef<Konva.Rect>(null);

  // Source-pixel coords of the current crop. Initialize from the existing crop
  // (or the full image once it loads).
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(
    el.crop ?? null
  );
  useEffect(() => {
    if (!img) return;
    if (!draft) {
      setDraft(el.crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [img, draft, el.crop]);

  // Attach the transformer to the crop rect once both refs exist.
  useEffect(() => {
    const tr = transformerRef.current;
    const rect = rectRef.current;
    if (!tr || !rect || !draft) return;
    tr.nodes([rect]);
    tr.getLayer()?.batchDraw();
  }, [img, draft]);

  if (!img) {
    // Image hasn't decoded yet — render nothing (normal-path image is hidden).
    return null;
  }
  if (!draft) {
    // Image loaded but draft state hasn't initialized on this microtask yet.
    // Show the uncropped image so the user sees something during the transient.
    return <KImage x={el.x} y={el.y} width={el.w} height={el.h} image={img} listening={false} />;
  }

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const slideX = el.x + (draft.x * el.w) / srcW;
  const slideY = el.y + (draft.y * el.h) / srcH;
  const slideW = (draft.w * el.w) / srcW;
  const slideH = (draft.h * el.h) / srcH;
  const maskFill = "rgba(0,0,0,0.6)";

  // Clamp a candidate crop to the source image bounds.
  const clampToSource = (next: { x: number; y: number; w: number; h: number }) => ({
    x: Math.max(0, Math.min(srcW - 8, next.x)),
    y: Math.max(0, Math.min(srcH - 8, next.y)),
    w: Math.max(8, Math.min(srcW - Math.max(0, next.x), next.w)),
    h: Math.max(8, Math.min(srcH - Math.max(0, next.y), next.h)),
  });

  // Live update (used during drag/transform) — keeps mask in sync without
  // writing to the store on every frame.
  const liveUpdate = (next: { x: number; y: number; w: number; h: number }) => {
    setDraft(clampToSource(next));
  };

  // Commit on interaction end — persists to deck.json (one undo step per gesture).
  const commit = (next: { x: number; y: number; w: number; h: number }) => {
    const clamped = clampToSource(next);
    setDraft(clamped);
    updateElement(slideId, el.id, { crop: clamped } as any);
  };

  return (
    <>
      <KImage x={el.x} y={el.y} width={el.w} height={el.h} image={img} listening={false} />
      {/* Four mask rects framing the crop region within the element slot. */}
      <Rect x={el.x} y={el.y} width={el.w} height={Math.max(0, slideY - el.y)} fill={maskFill} listening={false} />
      <Rect x={el.x} y={slideY} width={Math.max(0, slideX - el.x)} height={slideH} fill={maskFill} listening={false} />
      <Rect x={slideX + slideW} y={slideY} width={Math.max(0, el.x + el.w - slideX - slideW)} height={slideH} fill={maskFill} listening={false} />
      <Rect x={el.x} y={slideY + slideH} width={el.w} height={Math.max(0, el.y + el.h - slideY - slideH)} fill={maskFill} listening={false} />
      {/* Crop rect (draggable for translate, transformer for resize). */}
      <Rect
        ref={rectRef}
        x={slideX}
        y={slideY}
        width={slideW}
        height={slideH}
        stroke="#ffffff"
        strokeWidth={2 / scale}
        dash={[8 / scale, 4 / scale]}
        fill="transparent"
        draggable
        onDragMove={(e) => {
          const nx = ((e.target.x() - el.x) * srcW) / el.w;
          const ny = ((e.target.y() - el.y) * srcH) / el.h;
          liveUpdate({ x: nx, y: ny, w: draft.w, h: draft.h });
        }}
        onDragEnd={(e) => {
          const nx = ((e.target.x() - el.x) * srcW) / el.w;
          const ny = ((e.target.y() - el.y) * srcH) / el.h;
          commit({ x: nx, y: ny, w: draft.w, h: draft.h });
        }}
        onTransform={(e) => {
          // Bake the current scale into width/height and reset scale so the
          // rect's controlled props (width/height set from draft on next render)
          // stay in sync with Konva's internal node state — no double-scaling,
          // no snap-back, mask follows live.
          const node = e.target;
          const sx = node.scaleX();
          const sy = node.scaleY();
          const newW = node.width() * sx;
          const newH = node.height() * sy;
          node.scaleX(1);
          node.scaleY(1);
          node.width(newW);
          node.height(newH);
          const nx = ((node.x() - el.x) * srcW) / el.w;
          const ny = ((node.y() - el.y) * srcH) / el.h;
          liveUpdate({
            x: nx,
            y: ny,
            w: (newW * srcW) / el.w,
            h: (newH * srcH) / el.h,
          });
        }}
        onTransformEnd={(e) => {
          // onTransform already baked scale → width/height. Just persist.
          const node = e.target;
          const nx = ((node.x() - el.x) * srcW) / el.w;
          const ny = ((node.y() - el.y) * srcH) / el.h;
          commit({
            x: nx,
            y: ny,
            w: (node.width() * srcW) / el.w,
            h: (node.height() * srcH) / el.h,
          });
        }}
      />
      <Transformer
        ref={transformerRef}
        rotateEnabled={false}
        enabledAnchors={[
          "top-left","top-center","top-right",
          "middle-left","middle-right",
          "bottom-left","bottom-center","bottom-right",
        ]}
        // Compensate for the viewport scale so anchors are clickable at any zoom.
        anchorSize={Math.max(8, 12 / scale)}
        anchorStrokeWidth={Math.max(1, 2 / scale)}
        borderStrokeWidth={Math.max(1, 1 / scale)}
        anchorCornerRadius={Math.max(2, 3 / scale)}
        anchorStroke="#4a90e2"
        anchorFill="#ffffff"
        borderStroke="#4a90e2"
      />
    </>
  );
}

function ImageEl({ el, common }: { el: ImageElementT; common: any }) {
  const src = el.src.startsWith("http") || el.src.startsWith("/") ? el.src : `/${el.src}`;
  const [img] = useImage(src, "anonymous");
  const opacity = el.style?.opacity ?? 1;
  const radius = (el.style as any)?.radius ?? 0;
  const crop = el.crop
    ? { x: el.crop.x, y: el.crop.y, width: el.crop.w, height: el.crop.h }
    : undefined;
  if (radius > 0) {
    return (
      <Group
        {...common}
        width={el.w}
        height={el.h}
        clipFunc={(ctx: any) => roundRectPath(ctx, 0, 0, el.w, el.h, radius)}
      >
        <KImage width={el.w} height={el.h} image={img} opacity={opacity} crop={crop} />
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
      crop={crop}
      {...shadowProps(el.style)}
    />
  );
}
