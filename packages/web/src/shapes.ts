import type { ShapeKind } from "@minerva/schema";

/**
 * Shape registry — maps shapeKind → renderable geometry.
 *
 * Most shapes are expressed as polygons normalised to a 0..1 unit box. The renderer
 * scales them by the element's width/height. A few shapes (rect, ellipse, arrow,
 * roundedRect, plus) are special-cased because Konva has native nodes for them.
 */

export type ShapeKindCategory = "Basic" | "Arrows" | "Callouts" | "Flowchart" | "Lines";

export const SHAPE_GROUPS: Record<ShapeKindCategory, ShapeKind[]> = {
  Basic: [
    "rect",
    "roundedRect",
    "ellipse",
    "triangle",
    "rightTriangle",
    "diamond",
    "parallelogram",
    "trapezoid",
    "pentagon",
    "hexagon",
    "octagon",
    "star4",
    "star5",
    "star6",
    "heart",
    "cloud",
    "plus",
  ],
  Arrows: ["arrowRight", "arrowLeft", "arrowUp", "arrowDown", "arrowDouble"],
  Callouts: ["speechRect", "speechEllipse"],
  Flowchart: ["flowProcess", "flowDecision", "flowTerminator", "flowData"],
  Lines: ["line", "arrow", "curveQuad"],
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  roundedRect: "Rounded rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  rightTriangle: "Right triangle",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  trapezoid: "Trapezoid",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  octagon: "Octagon",
  star4: "Star (4-pt)",
  star5: "Star (5-pt)",
  star6: "Star (6-pt)",
  heart: "Heart",
  cloud: "Cloud",
  plus: "Plus",
  arrowRight: "Right arrow",
  arrowLeft: "Left arrow",
  arrowUp: "Up arrow",
  arrowDown: "Down arrow",
  arrowDouble: "Double arrow",
  speechRect: "Speech (rect)",
  speechEllipse: "Speech (ellipse)",
  flowProcess: "Flow: process",
  flowDecision: "Flow: decision",
  flowTerminator: "Flow: terminator",
  flowData: "Flow: data",
  line: "Line",
  arrow: "Arrow",
  curveQuad: "Curved line",
};

/** A polygon expressed in unit space (0..1 along each axis). */
type UnitPolygon = { kind: "polygon"; points: number[]; closed: boolean };
type SpecialShape = { kind: "rect" } | { kind: "ellipse" } | { kind: "roundedRect" } | { kind: "line" } | { kind: "arrow" } | { kind: "curve" };
type ShapeGeometry = UnitPolygon | SpecialShape;

/** Star helper: n points, alternating outer/inner radius. Output is in unit space centred at (0.5, 0.5). */
function starPolygon(points: number, innerScale = 0.4): number[] {
  const out: number[] = [];
  const cx = 0.5, cy = 0.5;
  const rOuter = 0.5;
  const rInner = rOuter * innerScale;
  const steps = points * 2;
  for (let i = 0; i < steps; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI * 2 * i) / steps - Math.PI / 2;
    out.push(cx + Math.cos(angle) * r);
    out.push(cy + Math.sin(angle) * r);
  }
  return out;
}

function ngonPolygon(n: number, rotationDeg = 0): number[] {
  const out: number[] = [];
  const cx = 0.5, cy = 0.5;
  const r = 0.5;
  const startAngle = (rotationDeg * Math.PI) / 180 - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const angle = startAngle + (Math.PI * 2 * i) / n;
    out.push(cx + Math.cos(angle) * r);
    out.push(cy + Math.sin(angle) * r);
  }
  return out;
}

export const SHAPE_GEOMETRY: Record<ShapeKind, ShapeGeometry> = {
  rect: { kind: "rect" },
  roundedRect: { kind: "roundedRect" },
  ellipse: { kind: "ellipse" },
  line: { kind: "line" },
  arrow: { kind: "arrow" },
  curveQuad: { kind: "curve" },

  triangle: { kind: "polygon", points: [0.5, 0, 0, 1, 1, 1], closed: true },
  rightTriangle: { kind: "polygon", points: [0, 0, 0, 1, 1, 1], closed: true },
  diamond: { kind: "polygon", points: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], closed: true },
  parallelogram: { kind: "polygon", points: [0.2, 0, 1, 0, 0.8, 1, 0, 1], closed: true },
  trapezoid: { kind: "polygon", points: [0.25, 0, 0.75, 0, 1, 1, 0, 1], closed: true },
  pentagon: { kind: "polygon", points: ngonPolygon(5), closed: true },
  hexagon: { kind: "polygon", points: ngonPolygon(6, 30), closed: true },
  octagon: { kind: "polygon", points: ngonPolygon(8, 22.5), closed: true },
  star4: { kind: "polygon", points: starPolygon(4, 0.35), closed: true },
  star5: { kind: "polygon", points: starPolygon(5, 0.4), closed: true },
  star6: { kind: "polygon", points: starPolygon(6, 0.5), closed: true },
  heart: {
    kind: "polygon",
    points: heartPolygon(),
    closed: true,
  },
  cloud: {
    kind: "polygon",
    points: cloudPolygon(),
    closed: true,
  },
  plus: {
    kind: "polygon",
    points: [
      0.35, 0,   0.65, 0,
      0.65, 0.35, 1, 0.35,
      1, 0.65,   0.65, 0.65,
      0.65, 1,   0.35, 1,
      0.35, 0.65, 0, 0.65,
      0, 0.35,   0.35, 0.35,
    ],
    closed: true,
  },

  arrowRight: {
    kind: "polygon",
    points: [0, 0.3, 0.6, 0.3, 0.6, 0, 1, 0.5, 0.6, 1, 0.6, 0.7, 0, 0.7],
    closed: true,
  },
  arrowLeft: {
    kind: "polygon",
    points: [1, 0.3, 0.4, 0.3, 0.4, 0, 0, 0.5, 0.4, 1, 0.4, 0.7, 1, 0.7],
    closed: true,
  },
  arrowUp: {
    kind: "polygon",
    points: [0.3, 1, 0.3, 0.4, 0, 0.4, 0.5, 0, 1, 0.4, 0.7, 0.4, 0.7, 1],
    closed: true,
  },
  arrowDown: {
    kind: "polygon",
    points: [0.3, 0, 0.3, 0.6, 0, 0.6, 0.5, 1, 1, 0.6, 0.7, 0.6, 0.7, 0],
    closed: true,
  },
  arrowDouble: {
    kind: "polygon",
    points: [0, 0.5, 0.25, 0, 0.25, 0.3, 0.75, 0.3, 0.75, 0, 1, 0.5, 0.75, 1, 0.75, 0.7, 0.25, 0.7, 0.25, 1],
    closed: true,
  },

  speechRect: {
    kind: "polygon",
    points: [0, 0, 1, 0, 1, 0.8, 0.35, 0.8, 0.25, 1, 0.25, 0.8, 0, 0.8],
    closed: true,
  },
  speechEllipse: {
    // Approximate ellipse with a polygon for v0 (ellipse + a small tail rectangle is hard in a single polygon).
    kind: "polygon",
    points: ellipsePolygon(0.5, 0.4, 32).concat([0.3, 0.78, 0.18, 1, 0.4, 0.78]),
    closed: true,
  },

  flowProcess: { kind: "rect" }, // standard rectangle
  flowDecision: { kind: "polygon", points: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], closed: true }, // diamond
  flowTerminator: { kind: "roundedRect" }, // pill
  flowData: { kind: "polygon", points: [0.2, 0, 1, 0, 0.8, 1, 0, 1], closed: true }, // parallelogram
};

function heartPolygon(): number[] {
  const out: number[] = [];
  const segments = 40;
  // parametric heart: x = 16 sin³t; y = -(13 cos t - 5 cos 2t - 2 cos 3t - cos 4t)
  // normalise to unit box.
  let pts: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const t = (Math.PI * 2 * i) / segments;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x, y]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  for (const [x, y] of pts) {
    out.push((x - xmin) / (xmax - xmin), (y - ymin) / (ymax - ymin));
  }
  return out;
}

function cloudPolygon(): number[] {
  // 7 overlapping circle bumps along the top + a soft flat bottom.
  const bumps = [
    [0.15, 0.45, 0.18],
    [0.32, 0.28, 0.2],
    [0.5, 0.22, 0.22],
    [0.68, 0.28, 0.2],
    [0.85, 0.45, 0.18],
    [0.85, 0.7, 0.18],
    [0.15, 0.7, 0.18],
  ];
  const pts: number[] = [];
  // Trace upper arc of each bump, then bottom from right to left.
  for (const [cx, cy, r] of bumps.slice(0, 5)) {
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (Math.PI * i) / 8;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  // Right side down
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 4;
    pts.push(0.85 + Math.cos(a) * 0.18, 0.7 + Math.sin(a) * 0.18);
  }
  // Bottom right to left
  pts.push(0.18, 0.88);
  // Left side down
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 4;
    pts.push(0.15 + Math.cos(a) * 0.18, 0.7 + Math.sin(a) * 0.18);
  }
  return pts;
}

function ellipsePolygon(rx: number, ry: number, segments: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    out.push(0.5 + Math.cos(a) * rx, 0.5 + Math.sin(a) * ry);
  }
  return out;
}

export function scalePolygon(points: number[], w: number, h: number): number[] {
  const out: number[] = new Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i] * w;
    out[i + 1] = points[i + 1] * h;
  }
  return out;
}

/**
 * Trace a rounded-rect path on the given 2D context. Used as a Konva clipFunc
 * to give images (and any other clipped node) soft corners.
 */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function shapeCategoryOf(kind: ShapeKind): ShapeKindCategory {
  for (const [cat, kinds] of Object.entries(SHAPE_GROUPS) as Array<[ShapeKindCategory, ShapeKind[]]>) {
    if (kinds.includes(kind)) return cat;
  }
  return "Basic";
}
