import { useEffect, useRef } from "react";
import type { TableElementT } from "@minerva/schema";
import { useStore } from "./store";
import { plainText, setTextPreservingStyle, firstTextStyle } from "./text";

type Props = {
  el: TableElementT;
  row: number;
  col: number;
  /** Canvas-area screen offset of slide origin (mirrors TextEditOverlay). */
  offset: { x: number; y: number };
  scale: number;
  onExit: () => void;
};

/** Inline cell editor. A plain HTML <textarea> overlaid on the target cell.
 *  Commits on Enter / Esc / click-outside and preserves the cell's existing
 *  text formatting via setTextPreservingStyle (so the first-run marks —
 *  font, size, color, bold, etc. — survive the edit). Shift+Enter inserts a
 *  newline for multi-line cells. */
export function CellEditOverlay({ el, row, col, offset, scale, onExit }: Props) {
  const updateElement = useStore((s) => s.updateElement);
  const slideId = useSlideIdForTable(el.id);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cell = el.cells[row]?.[col];
  const initial = plainText(cell?.content);

  // Compute the cell's slide-coord position inside the table.
  const colWidths = computeTracks(el.cols, el.w, el.colWidths);
  const rowHeights = computeTracks(el.rows, el.h, el.rowHeights);
  let cellX = 0;
  for (let i = 0; i < col; i++) cellX += colWidths[i];
  let cellY = 0;
  for (let i = 0; i < row; i++) cellY += rowHeights[i];
  const cellW = colWidths[col];
  const cellH = rowHeights[row];
  const padding = el.style?.cellPadding ?? 8;

  // Visual style — mirror the cell's display so the textarea looks like the
  // cell it's replacing.
  const cellTextStyle = firstTextStyle(cell?.content);
  const fontFamily = cellTextStyle.fontFamily ?? el.style?.fontFamily ?? "Inter, system-ui, sans-serif";
  const fontSize = cellTextStyle.fontSize ?? el.style?.fontSize ?? 16;
  const color = cellTextStyle.color ?? el.style?.color ?? "#111";

  // Position in screen space.
  const left = offset.x + (el.x + cellX) * scale;
  const top = offset.y + (el.y + cellY) * scale;

  // Commit: write the textarea value back into the cell, preserving the
  // existing TextNode marks via setTextPreservingStyle.
  const commit = () => {
    const next = taRef.current?.value ?? "";
    if (next === initial) {
      onExit();
      return;
    }
    if (!slideId) {
      onExit();
      return;
    }
    const newCells = el.cells.map((rowArr, ri) =>
      rowArr.map((c, ci) => {
        if (ri !== row || ci !== col) return c;
        return { ...c, content: setTextPreservingStyle(c?.content, next) };
      }),
    );
    updateElement(slideId, el.id, { cells: newCells } as any);
    onExit();
  };

  // Click outside / Esc commits. Enter alone commits; Shift+Enter inserts a
  // newline (default textarea behavior).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (taRef.current?.contains(t)) return;
      commit();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
    // commit is intentionally re-bound each render; we only need to subscribe once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autofocus + select-all so the user can immediately overtype.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  return (
    <textarea
      ref={taRef}
      defaultValue={initial}
      style={{
        position: "absolute",
        left,
        top,
        width: cellW * scale,
        height: cellH * scale,
        transform: `scale(1)`, // size already in screen space
        padding: padding * scale,
        boxSizing: "border-box",
        background: "#fff",
        color,
        fontFamily,
        fontSize: fontSize * scale,
        border: `2px solid #4a90e2`,
        outline: "none",
        resize: "none",
        zIndex: 110,
        lineHeight: 1.2,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onExit();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
        // Don't bubble — the canvas's window-level shortcut handler treats
        // Backspace as "delete element" when focus isn't in a textarea, but
        // the inEditor check already covers us. Belt-and-suspenders.
        e.stopPropagation();
      }}
    />
  );
}

/** Walk the deck to find the slide that contains the given table id. The
 *  overlay only knows the element id, so we look it up from the store. */
function useSlideIdForTable(tableId: string): string | undefined {
  const deck = useStore((s) => s.deck);
  if (!deck) return undefined;
  for (const slide of deck.slides) {
    if (slide.elements.some((e) => e.id === tableId)) return slide.id;
  }
  return undefined;
}

function computeTracks(count: number, total: number, custom?: number[]): number[] {
  if (custom && custom.length === count) {
    const sum = custom.reduce((a, b) => a + b, 0);
    if (sum > 0 && Math.abs(sum - total) > 0.5) {
      const k = total / sum;
      return custom.map((w) => w * k);
    }
    return [...custom];
  }
  const each = total / count;
  return Array.from({ length: count }, () => each);
}
