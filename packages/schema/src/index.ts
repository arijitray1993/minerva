import { z } from "zod";

export const DECK_SCHEMA_VERSION = 1;

const Color = z.string().describe("CSS color string, e.g. '#FF8800' or 'rgba(0,0,0,0.5)'");

const Shadow = z.object({
  offsetX: z.number().default(0),
  offsetY: z.number().default(4),
  blur: z.number().nonnegative().default(8),
  color: Color.default("rgba(0,0,0,0.35)"),
  opacity: z.number().min(0).max(1).default(1),
});

const BaseStyle = z.object({
  fill: Color.nullable().optional(),
  stroke: Color.nullable().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
  shadow: Shadow.optional(),
});

const TextRunMark = z.object({
  type: z.enum(["bold", "italic", "underline", "strike", "code", "superscript", "subscript"]),
});

const TextStyleMark = z.object({
  type: z.literal("textStyle"),
  attrs: z.object({
    color: Color.optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
  }),
});

const HighlightMark = z.object({
  type: z.literal("highlight"),
  attrs: z.object({
    color: Color.optional(),
  }),
});

const Mark = z.union([TextRunMark, TextStyleMark, HighlightMark]);

const TextNode: z.ZodType<TextNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().optional(),
    marks: z.array(Mark).optional(),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(TextNode).optional(),
  })
);
export type TextNode = {
  type: string;
  text?: string;
  marks?: Array<z.infer<typeof Mark>>;
  attrs?: Record<string, unknown>;
  content?: TextNode[];
};

const Geometry = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
  rotation: z.number().optional(),
});

const ElementBase = Geometry.extend({
  id: z.string().min(1),
  name: z.string().optional(),
  locked: z.boolean().optional(),
});

export const TextElement = ElementBase.extend({
  type: z.literal("text"),
  content: TextNode,
  style: BaseStyle.extend({
    align: z.enum(["left", "center", "right", "justify"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    padding: z.number().nonnegative().optional(),
  }).optional(),
});

export const SHAPE_KINDS = [
  // Basic
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
  // Arrows
  "arrowRight",
  "arrowLeft",
  "arrowUp",
  "arrowDown",
  "arrowDouble",
  // Callouts
  "speechRect",
  "speechEllipse",
  // Flowchart
  "flowProcess",
  "flowDecision",
  "flowTerminator",
  "flowData",
  // Lines
  "line",
  "arrow",
  "curveQuad",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const ShapeElement = ElementBase.extend({
  type: z.literal("shape"),
  shapeKind: z.enum(SHAPE_KINDS),
  style: BaseStyle.extend({
    radius: z.number().nonnegative().optional(),
    arrowStart: z.boolean().optional(),
    arrowEnd: z.boolean().optional(),
    // For curveQuad: control point offset from element origin (slide coords).
    controlX: z.number().optional(),
    controlY: z.number().optional(),
  }).optional(),
});

export const ImageElement = ElementBase.extend({
  type: z.literal("image"),
  src: z.string().describe("Relative path under assets/ or absolute URL"),
  alt: z.string().optional(),
  fit: z.enum(["contain", "cover", "fill"]).default("contain"),
  style: BaseStyle.extend({
    /** Corner radius in pixels for rounded image edges. Same field name as ShapeElement.style.radius. */
    radius: z.number().nonnegative().optional(),
  }).optional(),
});

const TableCell = z.object({
  content: TextNode,
  style: z
    .object({
      fill: Color.nullable().optional(),
      align: z.enum(["left", "center", "right", "justify"]).optional(),
      verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    })
    .optional(),
});

export const TableElement = ElementBase.extend({
  type: z.literal("table"),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  cells: z.array(z.array(TableCell)),
  headerRow: z.boolean().optional(),
  headerCol: z.boolean().optional(),
  colWidths: z.array(z.number().positive()).optional(),
  rowHeights: z.array(z.number().positive()).optional(),
  style: BaseStyle.extend({
    borderColor: Color.optional(),
    borderWidth: z.number().nonnegative().optional(),
    cellPadding: z.number().nonnegative().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    color: Color.optional(),
    headerFill: Color.optional(),
    headerColor: Color.optional(),
    headerFontWeight: z.number().min(100).max(900).optional(),
  }).optional(),
});

export type GroupElementT = z.infer<typeof ElementBase> & {
  type: "group";
  children: ElementT[];
};
export const GroupElement: z.ZodType<GroupElementT, z.ZodTypeDef, any> = z.lazy(() =>
  ElementBase.extend({
    type: z.literal("group"),
    children: z.array(Element),
  })
);

export const Element = z.union([TextElement, ShapeElement, ImageElement, TableElement, GroupElement]);
export type ElementT = z.infer<typeof Element>;

export const Slide = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  background: z.object({
    fill: Color.optional(),
  }).optional(),
  elements: z.array(Element),
  notes: z.string().optional(),
});

export const Theme = z.object({
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  palette: z.record(Color).default({}),
}).default({ fontFamily: "Inter, system-ui, sans-serif", palette: {} });

export const Deck = z.object({
  version: z.literal(DECK_SCHEMA_VERSION).default(DECK_SCHEMA_VERSION),
  title: z.string().default("Untitled deck"),
  size: z.object({
    w: z.number().positive().default(1280),
    h: z.number().positive().default(720),
  }).default({ w: 1280, h: 720 }),
  theme: Theme,
  slides: z.array(Slide).default([]),
});

export type DeckT = z.infer<typeof Deck>;
export type SlideT = z.infer<typeof Slide>;
export type TextElementT = z.infer<typeof TextElement>;
export type ShapeElementT = z.infer<typeof ShapeElement>;
export type ImageElementT = z.infer<typeof ImageElement>;
export type TableElementT = z.infer<typeof TableElement>;
export type TableCellT = z.infer<typeof TableCell>;

export const Comment = z.object({
  id: z.string().min(1),
  slideId: z.string(),
  targetIds: z.array(z.string()),
  author: z.enum(["human", "claude"]).default("human"),
  request: z.string(),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});
export const Comments = z.object({
  comments: z.array(Comment).default([]),
});
export type CommentT = z.infer<typeof Comment>;
export type CommentsT = z.infer<typeof Comments>;

export function emptyDeck(): DeckT {
  return Deck.parse({
    title: "Untitled deck",
    slides: [
      {
        id: "slide-1",
        elements: [],
        background: { fill: "#ffffff" },
      },
    ],
  });
}

export function newId(prefix = "el"): string {
  // Short, sortable-ish, collision-resistant enough for a local deck.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${t}-${r}`;
}

export function emptyTableCell(): TableCellT {
  return {
    content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
  };
}

export function newTable(rows: number, cols: number, opts?: Partial<TableElementT>): TableElementT {
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => emptyTableCell())
  );
  return TableElement.parse({
    id: newId("table"),
    type: "table",
    x: opts?.x ?? 200,
    y: opts?.y ?? 200,
    w: opts?.w ?? 600,
    h: opts?.h ?? 240,
    rotation: opts?.rotation ?? 0,
    rows,
    cols,
    cells,
    headerRow: opts?.headerRow ?? true,
    style: {
      borderColor: "#333",
      borderWidth: 1,
      cellPadding: 8,
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 16,
      color: "#111",
      headerFill: "#1f2937",
      headerColor: "#ffffff",
      headerFontWeight: 700,
      ...(opts?.style ?? {}),
    },
  });
}
