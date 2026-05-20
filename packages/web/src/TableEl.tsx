import { useRef } from "react";
import { Group, Rect, Text, Line } from "react-konva";
import type Konva from "konva";
import type { TableElementT, TableCellT } from "@minerva/schema";
import { plainText, firstTextStyle } from "./text";

type Props = {
  el: TableElementT;
  common: any;
  /** Visual px-per-slide-unit. Used to keep hit-handle widths and dashed
   *  guides visually constant regardless of zoom. Print render passes 1. */
  scale?: number;
  /** Called with the (row, col) the user double-clicked, so the canvas can
   *  mount a cell-editing overlay over that cell. */
  onEditCell?: (row: number, col: number) => void;
  /** Persist a resized column/row layout. We bubble the patch up because all
   *  element mutations go through the store's updateElement. */
  onResizeTracks?: (patch: Partial<TableElementT>) => void;
  /** Hide a cell while it's being edited via overlay so the overlay's textarea
   *  is the only visible text for that cell. */
  editingCellId?: string | null;
};

/** Render a table element as a Group containing a Rect+Text per cell,
 *  plus a grid of border Lines and (when not disabled) draggable resize
 *  handles on every interior boundary.
 *
 *  Layout normalizes if `colWidths`/`rowHeights` don't sum to the element's
 *  current w/h — that way table-level resize scales tracks proportionally
 *  without needing a separate pass to persist new values.
 */
export function TableEl({ el, common, scale = 1, onEditCell, onResizeTracks, editingCellId }: Props) {
  const style = el.style ?? {};
  const borderColor = style.borderColor ?? "#333";
  const borderWidth = style.borderWidth ?? 1;
  const padding = style.cellPadding ?? 8;
  const baseFontFamily = style.fontFamily ?? "Inter, system-ui, sans-serif";
  const baseFontSize = style.fontSize ?? 16;
  const baseColor = style.color ?? "#111";
  const headerFill = style.headerFill ?? "#1f2937";
  const headerColor = style.headerColor ?? "#ffffff";
  const headerWeight = style.headerFontWeight ?? 700;
  const interactive = !!onEditCell || !!onResizeTracks;

  // Live track lengths in slide units. Normalized so they always sum to el.w
  // / el.h — handles the case where colWidths were stored at one table size
  // and the table has since been resized.
  const colWidths = computeTracks(el.cols, el.w, el.colWidths);
  const rowHeights = computeTracks(el.rows, el.h, el.rowHeights);
  const colX: number[] = [0];
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i]);
  const rowY: number[] = [0];
  for (let i = 0; i < rowHeights.length; i++) rowY.push(rowY[i] + rowHeights[i]);

  const cellNodes = [];
  for (let r = 0; r < el.rows; r++) {
    for (let c = 0; c < el.cols; c++) {
      const cell: TableCellT | undefined = el.cells[r]?.[c];
      const isHeader =
        (el.headerRow && r === 0) || (el.headerCol && c === 0);
      const cellStyle = cell?.style ?? {};
      const fill = cellStyle.fill ?? (isHeader ? headerFill : undefined);
      const text = cell ? plainText(cell.content) : "";
      const cellTextStyle = cell ? firstTextStyle(cell.content) : {};
      const fontFamily = cellTextStyle.fontFamily ?? baseFontFamily;
      const fontSize = cellTextStyle.fontSize ?? baseFontSize;
      const color = cellTextStyle.color ?? (isHeader ? headerColor : baseColor);
      const weight =
        cellTextStyle.fontWeight ??
        (cellTextStyle.bold ? 700 : isHeader ? headerWeight : undefined);
      const parts: string[] = [];
      if (cellTextStyle.italic) parts.push("italic");
      if (weight !== undefined) parts.push(String(weight));
      const fontStyle = parts.join(" ") || "normal";
      const x = colX[c];
      const y = rowY[r];
      const w = colWidths[c];
      const h = rowHeights[r];
      const cellId = `${el.id}::${r}-${c}`;
      const isEditing = editingCellId === cellId;
      cellNodes.push(
        <Group
          key={`${r}-${c}`}
          x={x}
          y={y}
          onDblClick={interactive ? (e: Konva.KonvaEventObject<MouseEvent>) => {
            if (!onEditCell) return;
            e.cancelBubble = true;
            onEditCell(r, c);
          } : undefined}
        >
          {fill && (
            <Rect x={0} y={0} width={w} height={h} fill={fill} listening={false} />
          )}
          {!isEditing && (
            <Text
              x={padding}
              y={padding}
              width={Math.max(0, w - padding * 2)}
              height={Math.max(0, h - padding * 2)}
              text={text}
              align={cellStyle.align ?? "left"}
              verticalAlign={cellStyle.verticalAlign ?? "middle"}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontStyle={fontStyle}
              fill={color}
              listening={false}
            />
          )}
        </Group>
      );
    }
  }

  // Grid lines (vertical between cols, horizontal between rows, plus outer border).
  const lines = [];
  for (let i = 0; i <= el.cols; i++) {
    lines.push(
      <Line
        key={`v${i}`}
        points={[colX[i], 0, colX[i], el.h]}
        stroke={borderColor}
        strokeWidth={borderWidth}
        listening={false}
      />
    );
  }
  for (let i = 0; i <= el.rows; i++) {
    lines.push(
      <Line
        key={`h${i}`}
        points={[0, rowY[i], el.w, rowY[i]]}
        stroke={borderColor}
        strokeWidth={borderWidth}
        listening={false}
      />
    );
  }

  // Interior resize handles. Sized for a comfortable hit area at any zoom.
  // Only interior boundaries are draggable — outer edges are owned by the
  // table-level Transformer.
  const handleHit = Math.max(6, 8 / scale);
  const resizers: React.ReactNode[] = [];
  if (onResizeTracks) {
    for (let i = 1; i < el.cols; i++) {
      resizers.push(
        <ColResizeHandle
          key={`cr${i}`}
          colIdx={i}
          xCenter={colX[i]}
          tableH={el.h}
          hit={handleHit}
          colWidths={colWidths}
          onCommit={(next) => onResizeTracks({ colWidths: next })}
        />
      );
    }
    for (let i = 1; i < el.rows; i++) {
      resizers.push(
        <RowResizeHandle
          key={`rr${i}`}
          rowIdx={i}
          yCenter={rowY[i]}
          tableW={el.w}
          hit={handleHit}
          rowHeights={rowHeights}
          onCommit={(next) => onResizeTracks({ rowHeights: next })}
        />
      );
    }
  }

  return (
    <Group {...common} width={el.w} height={el.h}>
      {/* Invisible hit Rect so the whole table area accepts clicks/drag. */}
      <Rect x={0} y={0} width={el.w} height={el.h} fill="rgba(0,0,0,0.001)" />
      {cellNodes}
      {lines}
      {resizers}
    </Group>
  );
}

/** Draggable vertical hairline straddling boundary `colIdx` (between
 *  cols colIdx-1 and colIdx). Drag redistributes width between those two
 *  columns; other columns keep their widths. Constrained so neither
 *  adjacent column shrinks below MIN_TRACK. */
function ColResizeHandle({
  colIdx,
  xCenter,
  tableH,
  hit,
  colWidths,
  onCommit,
}: {
  colIdx: number;
  xCenter: number;
  tableH: number;
  hit: number;
  colWidths: number[];
  onCommit: (next: number[]) => void;
}) {
  const startRef = useRef<{ left: number; right: number } | null>(null);
  return (
    <Rect
      x={xCenter - hit / 2}
      y={0}
      width={hit}
      height={tableH}
      fill="rgba(0,0,0,0.001)"
      draggable
      dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
      onMouseEnter={(e) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = "col-resize"; }}
      onMouseLeave={(e) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = ""; }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        startRef.current = { left: colWidths[colIdx - 1], right: colWidths[colIdx] };
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const start = startRef.current;
        if (!start) return;
        const newX = e.target.x() + hit / 2; // x of the moved boundary
        const dx = newX - xCenter;
        const next = [...colWidths];
        const MIN_TRACK = 16;
        let left = start.left + dx;
        let right = start.right - dx;
        if (left < MIN_TRACK) { right -= (MIN_TRACK - left); left = MIN_TRACK; }
        if (right < MIN_TRACK) { left -= (MIN_TRACK - right); right = MIN_TRACK; }
        next[colIdx - 1] = left;
        next[colIdx] = right;
        e.target.position({ x: xCenter - hit / 2, y: 0 }); // snap visually
        onCommit(next);
      }}
    />
  );
}

/** Same as ColResizeHandle but horizontal — drags row height between
 *  rows rowIdx-1 and rowIdx. */
function RowResizeHandle({
  rowIdx,
  yCenter,
  tableW,
  hit,
  rowHeights,
  onCommit,
}: {
  rowIdx: number;
  yCenter: number;
  tableW: number;
  hit: number;
  rowHeights: number[];
  onCommit: (next: number[]) => void;
}) {
  const startRef = useRef<{ top: number; bottom: number } | null>(null);
  return (
    <Rect
      x={0}
      y={yCenter - hit / 2}
      width={tableW}
      height={hit}
      fill="rgba(0,0,0,0.001)"
      draggable
      dragBoundFunc={(pos) => ({ x: 0, y: pos.y })}
      onMouseEnter={(e) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = "row-resize"; }}
      onMouseLeave={(e) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = ""; }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        startRef.current = { top: rowHeights[rowIdx - 1], bottom: rowHeights[rowIdx] };
      }}
      onDragMove={(e) => { e.cancelBubble = true; }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const start = startRef.current;
        if (!start) return;
        const newY = e.target.y() + hit / 2;
        const dy = newY - yCenter;
        const next = [...rowHeights];
        const MIN_TRACK = 16;
        let top = start.top + dy;
        let bottom = start.bottom - dy;
        if (top < MIN_TRACK) { bottom -= (MIN_TRACK - top); top = MIN_TRACK; }
        if (bottom < MIN_TRACK) { top -= (MIN_TRACK - bottom); bottom = MIN_TRACK; }
        next[rowIdx - 1] = top;
        next[rowIdx] = bottom;
        e.target.position({ x: 0, y: yCenter - hit / 2 });
        onCommit(next);
      }}
    />
  );
}

/** Compute track sizes that always sum to `total`. If `custom` is present and
 *  the right length, scale it proportionally so the table looks right even if
 *  the element was resized after the custom tracks were stored. Falls back to
 *  uniform tracks otherwise. */
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
