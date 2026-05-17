import { Group, Rect, Text, Line } from "react-konva";
import type { TableElementT, TableCellT } from "@minerva/schema";
import { plainText, firstTextStyle } from "./text";

/**
 * Render a table element as a Group containing a Rect+Text per cell,
 * plus a grid of border Lines. Layout is uniform unless colWidths/rowHeights
 * are present on the element.
 *
 * `common` carries id/x/y/rotation/draggable/onMouseDown/onDragEnd/onTransformEnd
 * (same shape used by every other RenderElement branch).
 */
export function TableEl({ el, common }: { el: TableElementT; common: any }) {
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
      cellNodes.push(
        <Group key={`${r}-${c}`} x={x} y={y}>
          {fill && (
            <Rect x={0} y={0} width={w} height={h} fill={fill} listening={false} />
          )}
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

  return (
    <Group {...common} width={el.w} height={el.h}>
      {/* Invisible hit Rect so the whole table area accepts clicks/drag. */}
      <Rect x={0} y={0} width={el.w} height={el.h} fill="rgba(0,0,0,0.001)" />
      {cellNodes}
      {lines}
    </Group>
  );
}

function computeTracks(count: number, total: number, custom?: number[]): number[] {
  if (custom && custom.length === count) return [...custom];
  const each = total / count;
  return Array.from({ length: count }, () => each);
}
