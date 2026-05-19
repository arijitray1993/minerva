import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import type { CommentT, DeckT, ElementT, ShapeKind, SlideT } from "@minerva/schema";
import { firstRunMarks, applyMarksToAll } from "./text";

export type Tool = "select" | "line" | "arrow" | "curve" | "shape" | "text";

type HistoryEntry = { deck: DeckT };

type State = {
  deck: DeckT | null;
  currentSlideId: string | null;
  selectedIds: string[];
  history: HistoryEntry[];
  historyIndex: number;
  /** When true, suppress sending changes back to the server (e.g. while applying a server-sourced update). */
  applyingRemote: boolean;
  /** Bumped after a web font finishes loading so the Konva canvas redraws with correct measurements. */
  fontRevision: number;
  /** Active drawing tool; "select" is the default. All non-select tools use a
   *  click-to-place flow on the canvas instead of inserting blindly: lines and
   *  arrows take start/end clicks, curves take start/control/end, and "shape"
   *  and "text" take two clicks defining a bounding box. */
  tool: Tool;
  /** When `tool === "shape"`, which shape to drop on click-to-place. */
  pendingShapeKind: ShapeKind | null;
  /** When set, the next non-source selection will receive this element's formatting. */
  formatToPaint: { sourceId: string } | null;
  /** Set while the user is editing a text element inline. The inspector reads
   *  it to provide selection-aware formatting controls. */
  activeTextEditor: Editor | null;
  /** Internal element clipboard for in-app copy/paste. Distinct from the
   *  system clipboard — Cmd+V on the canvas prefers a fresh system-clipboard
   *  image (e.g. paste from another tab) and falls back to this. */
  clipboard: ElementT[];
  /** Mirror of comments.json. Refreshed on WS "comments" broadcasts. */
  comments: CommentT[];
};

type Actions = {
  setDeck: (deck: DeckT, fromRemote?: boolean) => void;
  setCurrentSlide: (slideId: string) => void;
  setSelection: (ids: string[]) => void;
  updateElement: (slideId: string, elementId: string, patch: Partial<ElementT>) => void;
  addElement: (slideId: string, el: ElementT) => void;
  removeElement: (slideId: string, elementId: string) => void;
  reorderElement: (slideId: string, elementId: string, op: "front" | "back" | "forward" | "backward") => void;
  addSlide: () => void;
  removeSlide: (slideId: string) => void;
  reorderSlides: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  setDeckTitle: (title: string) => void;
  setDeckSize: (w: number, h: number) => void;
  bumpFontRevision: () => void;
  setTool: (tool: Tool) => void;
  /** Set both the tool to "shape" and which shape will be dropped on the next
   *  two clicks. Pass `null` to clear the pending kind. */
  setPendingShapeKind: (kind: ShapeKind | null) => void;
  setFormatToPaint: (v: { sourceId: string } | null) => void;
  applyFormatFromSource: (slideId: string, targetId: string) => void;
  setActiveTextEditor: (ed: Editor | null) => void;
  /** Move every currently-selected (non-locked) element by (dx, dy) in slide
   *  coords, batched into a single mutate so undo reverts the whole nudge. */
  nudgeSelected: (dx: number, dy: number) => void;
  /** Wrap the current selection's top-level elements into a single group
   *  element. Children are rebased so their coordinates are relative to the
   *  new group's origin (the bounding-box top-left of the selection). No-op
   *  if fewer than two elements are selected. */
  groupSelected: (slideId: string) => void;
  /** Inverse of groupSelected: replace a group with its children at their
   *  original absolute slide coordinates. */
  ungroup: (slideId: string, groupId: string) => void;
  /** Function the inline TipTap overlay registers so we can synchronously
   *  flush its pending content into the store (e.g. from a beforeunload
   *  handler before the page reloads). Null when not editing. */
  flushActiveEditor: (() => void) | null;
  setFlushActiveEditor: (fn: (() => void) | null) => void;
  setClipboard: (els: ElementT[]) => void;
  setComments: (comments: CommentT[]) => void;
};

export const useStore = create<State & Actions>((set, get) => ({
  deck: null,
  currentSlideId: null,
  selectedIds: [],
  history: [],
  historyIndex: -1,
  applyingRemote: false,
  fontRevision: 0,
  tool: "select",
  pendingShapeKind: null,
  formatToPaint: null,
  activeTextEditor: null,
  flushActiveEditor: null,
  clipboard: [],
  comments: [],

  setDeck: (deck, fromRemote) => {
    set((s) => {
      const slideExists = deck.slides.some((sl) => sl.id === s.currentSlideId);
      const next: Partial<State> = {
        deck,
        currentSlideId: slideExists ? s.currentSlideId : deck.slides[0]?.id ?? null,
        applyingRemote: !!fromRemote,
      };
      // History reset on full deck replacement (initial load or remote sync).
      if (fromRemote || s.history.length === 0) {
        next.history = [{ deck }];
        next.historyIndex = 0;
      }
      return next;
    });
    if (fromRemote) {
      // Drop the applyingRemote flag on the next tick so save effects fire normally afterwards.
      queueMicrotask(() => set({ applyingRemote: false }));
    }
  },

  setCurrentSlide: (slideId) => set({ currentSlideId: slideId, selectedIds: [] }),
  setSelection: (ids) => set({ selectedIds: ids }),

  updateElement: (slideId, elementId, patch) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      const idx = slide.elements.findIndex((e) => e.id === elementId);
      if (idx < 0) return;
      slide.elements[idx] = { ...slide.elements[idx], ...patch } as ElementT;
    }),

  addElement: (slideId, el) => {
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      slide.elements.push(el);
    });
    set({ selectedIds: [el.id] });
  },

  removeElement: (slideId, elementId) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      slide.elements = slide.elements.filter((e) => e.id !== elementId);
    }),

  reorderElement: (slideId, elementId, op) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      const i = slide.elements.findIndex((e) => e.id === elementId);
      if (i < 0) return;
      const [el] = slide.elements.splice(i, 1);
      const last = slide.elements.length;
      let j: number;
      switch (op) {
        case "back": j = 0; break;
        case "front": j = last; break;
        case "backward": j = Math.max(0, i - 1); break;
        case "forward": j = Math.min(last, i + 1); break;
      }
      slide.elements.splice(j, 0, el);
    }),

  addSlide: () =>
    mutate(set, get, (deck) => {
      const id = `slide-${deck.slides.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
      deck.slides.push({ id, elements: [], background: { fill: "#ffffff" } });
    }),

  removeSlide: (slideId) =>
    mutate(set, get, (deck) => {
      deck.slides = deck.slides.filter((s) => s.id !== slideId);
      if (deck.slides.length === 0) {
        deck.slides.push({ id: "slide-1", elements: [], background: { fill: "#ffffff" } });
      }
    }),

  reorderSlides: (from, to) =>
    mutate(set, get, (deck) => {
      const [m] = deck.slides.splice(from, 1);
      deck.slides.splice(to, 0, m);
    }),

  setDeckTitle: (title) =>
    mutate(set, get, (deck) => {
      deck.title = title;
    }),

  setDeckSize: (w, h) =>
    mutate(set, get, (deck) => {
      const oldW = deck.size.w;
      const oldH = deck.size.h;
      if (w <= 0 || h <= 0) return;
      if (w === oldW && h === oldH) return;
      const sx = w / oldW;
      const sy = h / oldH;
      const s = (sx + sy) / 2; // unitless scale for fonts, strokes, padding, etc.
      deck.size = { w, h };
      for (const slide of deck.slides) {
        slide.elements = slide.elements.map((el) => scaleElement(el, sx, sy, s));
      }
    }),

  bumpFontRevision: () => set((s) => ({ fontRevision: s.fontRevision + 1 })),
  setTool: (tool) => set((s) => ({
    tool,
    // Selecting any tool that isn't "shape" clears the pending shape kind so a
    // stale kind can't bleed into the next gesture.
    pendingShapeKind: tool === "shape" ? s.pendingShapeKind : null,
  })),
  setPendingShapeKind: (kind) =>
    set({ tool: kind ? "shape" : "select", pendingShapeKind: kind }),
  setFormatToPaint: (v) => set({ formatToPaint: v }),
  setActiveTextEditor: (ed) => set({ activeTextEditor: ed }),
  setFlushActiveEditor: (fn) => set({ flushActiveEditor: fn }),
  setClipboard: (els) => set({ clipboard: els }),
  setComments: (comments) => set({ comments }),

  nudgeSelected: (dx, dy) =>
    mutate(set, get, (deck) => {
      const { selectedIds, currentSlideId } = get();
      if (!currentSlideId || selectedIds.length === 0) return;
      const slide = deck.slides.find((s) => s.id === currentSlideId);
      if (!slide) return;
      for (const id of selectedIds) {
        const idx = slide.elements.findIndex((e) => e.id === id);
        if (idx < 0) continue;
        const el = slide.elements[idx];
        if (el.locked) continue;
        slide.elements[idx] = { ...el, x: el.x + dx, y: el.y + dy } as ElementT;
      }
    }),

  groupSelected: (slideId) => {
    const ids = new Set(get().selectedIds);
    if (ids.size < 2) return;
    let newGroupId = "";
    mutate(set, get, (deck) => {
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return;
      // Preserve z-order: keep the original index of each selected element.
      const picked: Array<{ idx: number; el: ElementT }> = [];
      for (let i = 0; i < slide.elements.length; i++) {
        if (ids.has(slide.elements[i].id)) picked.push({ idx: i, el: slide.elements[i] });
      }
      if (picked.length < 2) return;
      const bbox = bboxOfElements(picked.map((p) => p.el));
      if (!bbox) return;
      const children = picked.map(({ el }) => ({ ...el, x: el.x - bbox.x, y: el.y - bbox.y }) as ElementT);
      newGroupId = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const group: ElementT = {
        id: newGroupId,
        type: "group",
        x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, rotation: 0,
        children,
      };
      // Drop the picked elements, insert the group at the topmost picked slot
      // so the new group sits where the user's eye expects it in z-order.
      const insertAt = picked[picked.length - 1].idx;
      const remaining = slide.elements.filter((e) => !ids.has(e.id));
      // remaining preserves order; calculate where the insertion lands relative
      // to surviving siblings.
      const survivorsBeforeInsertion = slide.elements
        .slice(0, insertAt + 1)
        .filter((e) => !ids.has(e.id)).length;
      remaining.splice(survivorsBeforeInsertion, 0, group);
      slide.elements = remaining;
    });
    if (newGroupId) set({ selectedIds: [newGroupId] });
  },

  ungroup: (slideId, groupId) => {
    let liftedIds: string[] = [];
    mutate(set, get, (deck) => {
      const slide = deck.slides.find((s) => s.id === slideId);
      if (!slide) return;
      const idx = slide.elements.findIndex((e) => e.id === groupId);
      if (idx < 0) return;
      const g = slide.elements[idx];
      if (g.type !== "group") return;
      const lifted = g.children.map((c) => ({ ...c, x: c.x + g.x, y: c.y + g.y }) as ElementT);
      liftedIds = lifted.map((c) => c.id);
      slide.elements.splice(idx, 1, ...lifted);
    });
    if (liftedIds.length > 0) set({ selectedIds: liftedIds });
  },

  applyFormatFromSource: (slideId, targetId) => {
    const s = get();
    const sourceId = s.formatToPaint?.sourceId;
    if (!sourceId || sourceId === targetId || !s.deck) return;
    let source: ElementT | undefined;
    for (const slide of s.deck.slides) {
      for (const el of slide.elements) {
        if (el.id === sourceId) source = el;
      }
    }
    if (!source) {
      set({ formatToPaint: null });
      return;
    }
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      const i = slide.elements.findIndex((e) => e.id === targetId);
      if (i < 0) return;
      slide.elements[i] = applyFormat(source!, slide.elements[i]) as ElementT;
    });
    set({ formatToPaint: null });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    set({ deck: deepClone(history[i].deck), historyIndex: i });
  },
  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    set({ deck: deepClone(history[i].deck), historyIndex: i });
  },
}));

function mutate(
  set: (s: Partial<State>) => void,
  get: () => State & Actions,
  fn: (deck: DeckT) => void
) {
  const s = get();
  if (!s.deck) return;
  const next = deepClone(s.deck);
  fn(next);
  const trimmed = s.history.slice(0, s.historyIndex + 1);
  trimmed.push({ deck: next });
  // Cap history.
  const MAX = 100;
  const start = Math.max(0, trimmed.length - MAX);
  const sliced = trimmed.slice(start);
  set({ deck: next, history: sliced, historyIndex: sliced.length - 1 });
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Axis-aligned bounding box of a list of elements in slide coords. Handles
 *  lines/arrows that store negative w/h (drawn up-and-left). Returns null for
 *  an empty list. */
function bboxOfElements(els: ElementT[]): { x: number; y: number; w: number; h: number } | null {
  if (els.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const x1 = el.w < 0 ? el.x + el.w : el.x;
    const x2 = el.w < 0 ? el.x : el.x + el.w;
    const y1 = el.h < 0 ? el.y + el.h : el.y;
    const y2 = el.h < 0 ? el.y : el.y + el.h;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function findSlide(deck: DeckT, slideId: string): SlideT | undefined {
  return deck.slides.find((s) => s.id === slideId);
}

export function findElement(deck: DeckT, id: string): { slide: SlideT; el: ElementT } | undefined {
  for (const slide of deck.slides) {
    const el = slide.elements.find((e) => e.id === id);
    if (el) return { slide, el };
  }
  return undefined;
}

/**
 * Copy formatting from `source` onto `target` while preserving the target's
 * geometry (x/y/w/h/rotation) and identity (id, type, content text).
 *  - Shallow-merge `style` so target inherits source's style fields.
 *  - For text-to-text, also copy the first run's marks onto every run in target.
 *  - For table-to-table, also copy table-wide style settings.
 *  - Cross-type painting copies only `style`, which the foreign type ignores
 *    where fields don't apply — harmless but not lossy.
 */
function applyFormat(source: ElementT, target: ElementT): ElementT {
  const next: any = { ...target };
  const sStyle = (source as any).style;
  if (sStyle) {
    // Lines / arrows / curves are defined by geometry fields that live in
    // `style` (controlX/Y for the bezier control point, arrowStart/End for
    // tips). Painting those across would change the shape itself, not its
    // formatting. So when either side is a line-like shape we restrict the
    // copy to pure appearance — stroke color and thickness.
    if (isLineLike(source) || isLineLike(target)) {
      const filtered: any = {};
      if (sStyle.stroke !== undefined) filtered.stroke = sStyle.stroke;
      if (sStyle.strokeWidth !== undefined) filtered.strokeWidth = sStyle.strokeWidth;
      next.style = { ...((target as any).style ?? {}), ...filtered };
    } else {
      next.style = { ...((target as any).style ?? {}), ...sStyle };
    }
  }
  if (source.type === "text" && target.type === "text") {
    const marks = firstRunMarks((source as any).content);
    next.content = applyMarksToAll((target as any).content, marks);
  }
  return next as ElementT;
}

const LINE_LIKE_SHAPE_KINDS = new Set(["line", "arrow", "curveQuad"]);
function isLineLike(el: ElementT): boolean {
  return el.type === "shape" && LINE_LIKE_SHAPE_KINDS.has((el as any).shapeKind);
}

/**
 * Rescale an element when the deck dimensions change OR when a group it lives
 * inside is resized via the canvas transformer.
 *   sx, sy = per-axis scale (for position / box / curve control)
 *   s      = unitless scale for things without an axis (font, stroke, padding, blur, ...)
 */
export function scaleElement(el: ElementT, sx: number, sy: number, s: number): ElementT {
  const next: any = {
    ...el,
    x: el.x * sx,
    y: el.y * sy,
    w: el.w * sx,
    h: el.h * sy,
  };

  const inStyle = (el as any).style;
  if (inStyle) {
    const st: any = { ...inStyle };
    if (typeof st.strokeWidth === "number") st.strokeWidth *= s;
    if (typeof st.radius === "number") st.radius *= s;
    if (typeof st.controlX === "number") st.controlX *= sx;
    if (typeof st.controlY === "number") st.controlY *= sy;
    if (typeof st.padding === "number") st.padding *= s;
    if (typeof st.cellPadding === "number") st.cellPadding *= s;
    if (typeof st.fontSize === "number") st.fontSize *= s;
    if (typeof st.borderWidth === "number") st.borderWidth *= s;
    if (st.shadow) {
      st.shadow = {
        ...st.shadow,
        offsetX: (st.shadow.offsetX ?? 0) * sx,
        offsetY: (st.shadow.offsetY ?? 0) * sy,
        blur: (st.shadow.blur ?? 0) * s,
      };
    }
    next.style = st;
  }

  if (el.type === "text") {
    next.content = scaleTextNode((el as any).content, s);
  } else if (el.type === "table") {
    const t = el as any;
    if (t.colWidths) next.colWidths = t.colWidths.map((c: number) => c * sx);
    if (t.rowHeights) next.rowHeights = t.rowHeights.map((r: number) => r * sy);
    next.cells = t.cells.map((row: any[]) =>
      row.map((cell) => ({ ...cell, content: scaleTextNode(cell.content, s) }))
    );
  } else if (el.type === "group") {
    next.children = (el as any).children.map((c: ElementT) => scaleElement(c, sx, sy, s));
  }

  return next as ElementT;
}

function scaleTextNode(node: any, s: number): any {
  if (!node || typeof node !== "object") return node;
  const out: any = { ...node };
  if (node.marks) {
    out.marks = node.marks.map((m: any) => {
      if (m.type === "textStyle" && m.attrs) {
        const a = { ...m.attrs };
        if (typeof a.fontSize === "number") a.fontSize *= s;
        if (typeof a.letterSpacing === "number") a.letterSpacing *= s;
        return { ...m, attrs: a };
      }
      return m;
    });
  }
  if (node.content) {
    out.content = node.content.map((c: any) => scaleTextNode(c, s));
  }
  return out;
}
