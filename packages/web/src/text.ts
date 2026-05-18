import type { TextNode } from "@minerva/schema";
import { useStore } from "./store";

export const GOOGLE_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Source Sans Pro",
  "Source Serif Pro",
  "Raleway",
  "Nunito",
  "Nunito Sans",
  "Work Sans",
  "Karla",
  "DM Sans",
  "DM Serif Display",
  "Manrope",
  "Rubik",
  "Quicksand",
  "Mulish",
  "Oswald",
  "Bebas Neue",
  "Anton",
  "Archivo",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "Crimson Text",
  "PT Serif",
  "PT Sans",
  "Cormorant Garamond",
  "EB Garamond",
  "Libre Baskerville",
  "Fira Sans",
  "Fira Code",
  "JetBrains Mono",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "Space Grotesk",
  "Space Mono",
  "Caveat",
  "Pacifico",
  "Dancing Script",
  "Shadows Into Light",
  "Permanent Marker",
] as const;

const loadedFonts = new Set<string>();
export function ensureFontLoaded(family: string): Promise<void> {
  if (!family || loadedFonts.has(family)) return Promise.resolve();
  loadedFonts.add(family);
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // Request every 100-step weight in both normal and italic so any
    // fontWeight the deck uses has an @font-face to bind to.
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;
    link.href = url;
    link.onload = async () => {
      try {
        await (document as any).fonts?.load?.(`16px "${family}"`);
      } catch { /* ignore */ }
      useStore.getState().bumpFontRevision();
      resolve();
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

const loadedWeights = new Set<string>();
/**
 * Force the browser to fetch a specific (family, weight, italic) font file.
 * Listing the weight in the Google Fonts URL only adds an @font-face rule —
 * the actual file is fetched lazily once something *uses* it. Konva draws to
 * <canvas>, so the browser may rasterize before the file arrives unless we
 * proactively call document.fonts.load() for the exact tuple.
 */
export async function ensureFontWeightLoaded(family: string, weight: number, italic = false): Promise<void> {
  if (!family) return;
  await ensureFontLoaded(family);
  const key = `${family}/${weight}/${italic ? "i" : "n"}`;
  if (loadedWeights.has(key)) return;
  loadedWeights.add(key);
  try {
    const spec = `${italic ? "italic " : ""}${weight} 16px "${family}"`;
    await (document as any).fonts?.load?.(spec);
  } catch { /* ignore */ }
  useStore.getState().bumpFontRevision();
}

/**
 * v0 helpers for text content.
 *
 * The schema stores rich text as a TipTap-style JSON document (doc → paragraph → text)
 * so we can later support mixed formatting per run. v0 renders text as a single style
 * run; these helpers flatten the doc to a plain string and read the first leaf's style.
 */

export function plainText(node: TextNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const parts: string[] = [];
  walk(node, (n) => {
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (n.type === "paragraph") parts.push("\n");
  });
  return parts.join("").replace(/^\n+/, "");
}

export function plainTextDoc(s: string): TextNode {
  const paragraphs = s.split(/\n/).map<TextNode>((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
  return { type: "doc", content: paragraphs };
}

/**
 * Rebuild a TipTap doc with new text but preserve the existing styling.
 * v0 renders single-style-per-element, so we snapshot the first text run's
 * marks and apply them to every paragraph in the new doc.
 */
export function setTextPreservingStyle(prev: TextNode | undefined, newText: string): TextNode {
  let firstMarks: TextNode["marks"] | undefined;
  if (prev) {
    walk(prev, (n) => {
      if (firstMarks === undefined && n.type === "text") firstMarks = n.marks ?? [];
    });
  }
  const marks = firstMarks ?? [];
  const paragraphs = newText.split(/\n/).map<TextNode>((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line, marks: marks.length ? marks : undefined }] : [],
  }));
  return { type: "doc", content: paragraphs };
}

/** Return the marks of the first text run in a doc (used by the format painter). */
export function firstRunMarks(node: TextNode | undefined): TextNode["marks"] {
  if (!node) return undefined;
  let m: TextNode["marks"] | undefined;
  walk(node, (n) => {
    if (m === undefined && n.type === "text") m = n.marks ?? [];
  });
  return m;
}

/** Apply the given marks to every text run in a doc. */
export function applyMarksToAll(node: TextNode, marks: TextNode["marks"]): TextNode {
  const next = marks && marks.length ? marks : undefined;
  return mapText(node, (run) => ({ ...run, marks: next ? [...next] : undefined }));
}

export function firstTextStyle(node: TextNode | undefined): {
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
} {
  let result: any = {};
  if (!node) return result;
  walk(node, (n) => {
    if (n.type !== "text" || result.found) return;
    for (const mark of n.marks ?? []) {
      if (mark.type === "bold") result.bold = true;
      else if (mark.type === "italic") result.italic = true;
      else if (mark.type === "underline") result.underline = true;
      else if (mark.type === "textStyle" && (mark as any).attrs) {
        const a = (mark as any).attrs;
        if (a.color) result.color = a.color;
        if (a.fontFamily) result.fontFamily = a.fontFamily;
        if (a.fontSize) result.fontSize = a.fontSize;
        if (a.fontWeight) result.fontWeight = a.fontWeight;
        if (a.lineHeight) result.lineHeight = a.lineHeight;
        if (typeof a.letterSpacing === "number") result.letterSpacing = a.letterSpacing;
      }
    }
    result.found = true;
  });
  delete result.found;
  return result;
}

function walk(node: TextNode, visit: (n: TextNode) => void) {
  visit(node);
  for (const c of node.content ?? []) walk(c, visit);
}

type SimpleMarkType = "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript";

export function hasMarkAll(node: TextNode | undefined, type: SimpleMarkType): boolean {
  if (!node) return false;
  let total = 0;
  let withMark = 0;
  walk(node, (n) => {
    if (n.type === "text") {
      total++;
      if ((n.marks ?? []).some((m) => m.type === type)) withMark++;
    }
  });
  return total > 0 && total === withMark;
}

export function toggleMarkAll(node: TextNode, type: SimpleMarkType): TextNode {
  const turnOff = hasMarkAll(node, type);
  return mapText(node, (run) => {
    const marks = (run.marks ?? []).filter((m) => m.type !== type);
    if (!turnOff) marks.push({ type } as any);
    return { ...run, marks };
  });
}

export function setHighlightAll(node: TextNode, color: string | null): TextNode {
  return mapText(node, (run) => {
    const marks = (run.marks ?? []).filter((m) => m.type !== "highlight");
    if (color) marks.push({ type: "highlight", attrs: { color } } as any);
    return { ...run, marks };
  });
}

export function setTextStyleAll(
  node: TextNode,
  patch: {
    color?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
  }
): TextNode {
  return mapText(node, (run) => {
    const marks = run.marks ? [...run.marks] : [];
    const i = marks.findIndex((m) => m.type === "textStyle");
    const existing = (i >= 0 ? (marks[i] as any).attrs : {}) ?? {};
    const merged = { ...existing, ...patch };
    const cleaned: any = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== null && v !== "") cleaned[k] = v;
    }
    const nextMark = { type: "textStyle" as const, attrs: cleaned };
    if (Object.keys(cleaned).length === 0) {
      if (i >= 0) marks.splice(i, 1);
    } else if (i >= 0) {
      marks[i] = nextMark as any;
    } else {
      marks.push(nextMark as any);
    }
    return { ...run, marks };
  });
}

/**
 * Multi-run text layout for the v0 multi-style renderer. Walks the TipTap doc,
 * splits text runs into word tokens, measures each with its computed run style,
 * lays them out left-to-right with word-level wrap at maxWidth, and emits
 * positioned items the Konva renderer can draw one-to-one.
 *
 * Output coords are local to the text element (origin at the top-left of the
 * element's box). The caller positions the parent Group at (el.x, el.y).
 */
export type RunStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  highlight: string | null;
  superscript: boolean;
  subscript: boolean;
  lineHeight: number;
  letterSpacing: number;
};

export type LayoutItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  baselineHeight: number;
  lineIndex: number;
  style: RunStyle;
};

export type LayoutResult = {
  items: LayoutItem[];
  totalHeight: number;
};

const DEFAULT_RUN_STYLE: RunStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  underline: false,
  strike: false,
  color: "#111111",
  highlight: null,
  superscript: false,
  subscript: false,
  lineHeight: 1,
  letterSpacing: 0,
};

function applyMarksToStyle(marks: TextNode["marks"] | undefined, base: RunStyle): RunStyle {
  const s: RunStyle = { ...base };
  if (!marks) return s;
  for (const m of marks) {
    switch (m.type) {
      case "bold": s.fontWeight = Math.max(s.fontWeight, 700); break;
      case "italic": s.italic = true; break;
      case "underline": s.underline = true; break;
      case "strike": s.strike = true; break;
      case "superscript": s.superscript = true; break;
      case "subscript": s.subscript = true; break;
      case "textStyle": {
        const a = (m as any).attrs ?? {};
        if (a.color) s.color = a.color;
        if (a.fontFamily) s.fontFamily = a.fontFamily;
        if (typeof a.fontSize === "number") s.fontSize = a.fontSize;
        if (typeof a.fontWeight === "number") s.fontWeight = a.fontWeight;
        if (typeof a.lineHeight === "number") s.lineHeight = a.lineHeight;
        if (typeof a.letterSpacing === "number") s.letterSpacing = a.letterSpacing;
        break;
      }
      case "highlight": {
        const a = (m as any).attrs ?? {};
        if (a.color) s.highlight = a.color;
        break;
      }
    }
  }
  return s;
}

let _measureCtx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (_measureCtx) return _measureCtx;
  const c = document.createElement("canvas");
  _measureCtx = c.getContext("2d")!;
  return _measureCtx;
}

function fontString(s: RunStyle): string {
  const sizeAdj = s.superscript || s.subscript ? s.fontSize * 0.65 : s.fontSize;
  const italic = s.italic ? "italic " : "";
  // Build the family list the SAME way Konva does (just split/trim/join, no
  // wrapping quotes). Wrapping the whole stack in quotes turns it into a
  // single "Inter, system-ui, sans-serif" name and the browser can't find
  // that font — it falls back to the default, and ctx.measureText returns
  // fallback widths while Konva renders with the real font → overlap.
  const family = s.fontFamily
    .split(",")
    .map((f) => f.trim())
    .join(", ");
  return `${italic}${s.fontWeight} ${sizeAdj}px ${family}`;
}

function measureWidth(text: string, s: RunStyle): number {
  const ctx = measureCtx();
  ctx.font = fontString(s);
  const w = ctx.measureText(text).width;
  // Konva mimics letterSpacing per glyph; mirror it in measurement.
  return w + Math.max(0, text.length - 1) * (s.letterSpacing ?? 0);
}

function stylesEqual(a: RunStyle, b: RunStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing
  );
}

/** Split a run's text into atomic tokens: words and whitespace sequences. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const isSpace = /\s/.test(text[i]);
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]) === isSpace) j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}

export function layoutTextDoc(
  doc: TextNode | undefined,
  maxWidth: number,
  baseOverride?: Partial<RunStyle>,
  align: "left" | "center" | "right" | "justify" = "left"
): LayoutResult {
  const items: LayoutItem[] = [];
  if (!doc) return { items, totalHeight: 0 };
  const base: RunStyle = { ...DEFAULT_RUN_STYLE, ...(baseOverride ?? {}) };

  // Collect paragraphs of runs (each run is {text, style}).
  type Run = { text: string; style: RunStyle };
  const paragraphs: Run[][] = [];
  const walkPara = (p: TextNode): Run[] => {
    const runs: Run[] = [];
    const visit = (n: TextNode) => {
      if (n.type === "text" && typeof n.text === "string" && n.text.length > 0) {
        runs.push({ text: n.text, style: applyMarksToStyle(n.marks, base) });
      }
      for (const c of n.content ?? []) visit(c);
    };
    visit(p);
    return runs;
  };
  if (doc.type === "paragraph") {
    paragraphs.push(walkPara(doc));
  } else if (doc.content) {
    for (const child of doc.content) {
      if (child.type === "paragraph") paragraphs.push(walkPara(child));
      else paragraphs.push(walkPara(child));
    }
  } else if (doc.type === "text") {
    paragraphs.push(walkPara(doc));
  }

  let y = 0;
  for (const runs of paragraphs) {
    // Lay this paragraph out as a sequence of tokens with word-level wrap.
    type Placed = { text: string; style: RunStyle; width: number };
    const lines: Placed[][] = [[]];
    let xCursor = 0;
    let lineMaxFont = base.fontSize;
    let lineHeightMul = base.lineHeight;

    const pushToWrap = (text: string, style: RunStyle) => {
      const w = measureWidth(text, style);
      const onlyWhitespace = /^\s+$/.test(text);
      // If a non-whitespace token won't fit on the current non-empty line, wrap.
      if (!onlyWhitespace && xCursor + w > maxWidth && xCursor > 0) {
        // Trim trailing whitespace from previous line (visual nicety).
        const cur = lines[lines.length - 1];
        while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
        lines.push([]);
        xCursor = 0;
        lineMaxFont = style.fontSize;
        lineHeightMul = style.lineHeight;
      }
      lines[lines.length - 1].push({ text, style, width: w });
      xCursor += w;
      if (style.fontSize > lineMaxFont) {
        lineMaxFont = style.fontSize;
        lineHeightMul = style.lineHeight;
      }
    };

    for (const run of runs) {
      for (const tok of tokenize(run.text)) pushToWrap(tok, run.style);
    }

    // Emit items per line, merging consecutive same-style tokens into one item.
    // Merging matters: ctx.measureText("foo") + ctx.measureText("bar") drifts
    // from ctx.measureText("foobar") because of kerning, so per-token rendering
    // accumulates error. Merging makes single-style lines render identically to
    // a single Konva.Text.
    for (const line of lines) {
      const lineHeight = lineMaxFont * (lineHeightMul || 1);
      const lineIndex = items.length === 0 ? 0 : items[items.length - 1].lineIndex + 1;
      // Group consecutive tokens with identical styles.
      type Group = { text: string; style: RunStyle };
      const groups: Group[] = [];
      for (const placed of line) {
        const prev = groups[groups.length - 1];
        if (prev && stylesEqual(prev.style, placed.style)) {
          prev.text += placed.text;
        } else {
          groups.push({ text: placed.text, style: placed.style });
        }
      }
      let x = 0;
      for (const g of groups) {
        // Re-measure the merged text for an accurate width (captures kerning).
        const w = measureWidth(g.text, g.style);
        const s = g.style;
        let runY = y;
        if (s.superscript) runY = y - lineMaxFont * 0.25;
        else if (s.subscript) runY = y + lineMaxFont * 0.25;
        items.push({
          text: g.text,
          x,
          y: runY,
          width: w,
          baselineHeight: lineHeight,
          lineIndex,
          style: s,
        });
        x += w;
      }
      y += lineHeight;
    }
  }

  // Horizontal alignment per line.
  if (align !== "left") {
    const byLine = new Map<number, LayoutItem[]>();
    for (const it of items) {
      const arr = byLine.get(it.lineIndex) ?? [];
      arr.push(it);
      byLine.set(it.lineIndex, arr);
    }
    for (const lineItems of byLine.values()) {
      const lineWidth = Math.max(...lineItems.map((it) => it.x + it.width));
      let shift = 0;
      if (align === "center") shift = (maxWidth - lineWidth) / 2;
      else if (align === "right") shift = maxWidth - lineWidth;
      // "justify" left-aligned for v0 (proper inter-word distribution can come later).
      if (shift > 0) for (const it of lineItems) it.x += shift;
    }
  }

  return { items, totalHeight: y };
}

function mapText(node: TextNode, fn: (run: TextNode) => TextNode): TextNode {
  if (node.type === "text") return fn(node);
  return {
    ...node,
    content: node.content?.map((c) => mapText(c, fn)),
  };
}
