import type { TextNode } from "@minerva/schema";

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
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
    link.href = url;
    link.onload = async () => {
      try {
        await (document as any).fonts?.load?.(`16px "${family}"`);
      } catch { /* ignore */ }
      resolve();
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
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
  return parts.join("").replace(/^\n+/, "").trimEnd();
}

export function plainTextDoc(s: string): TextNode {
  const paragraphs = s.split(/\n/).map<TextNode>((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
  return { type: "doc", content: paragraphs };
}

export function firstTextStyle(node: TextNode | undefined): {
  color?: string;
  fontFamily?: string;
  fontSize?: number;
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
  patch: { color?: string; fontFamily?: string; fontSize?: number }
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

function mapText(node: TextNode, fn: (run: TextNode) => TextNode): TextNode {
  if (node.type === "text") return fn(node);
  return {
    ...node,
    content: node.content?.map((c) => mapText(c, fn)),
  };
}
