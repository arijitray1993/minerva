import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize, FontFamily } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { Underline } from "@tiptap/extension-underline";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import type { TextElementT } from "@minerva/schema";
import { useStore } from "./store";
import { saveNow } from "./sync";
import { firstTextStyle, ensureFontLoaded, GOOGLE_FONTS } from "./text";

type Props = {
  el: TextElementT;
  slideId: string;
  /** Screen-space position of the element's top-left and visual scale of the
   *  slide (so the overlay can be sized in slide-coord units and visually
   *  scaled to match the canvas). */
  containerOffset: { x: number; y: number };
  scale: number;
  onExit: () => void;
};

export function TextEditOverlay({ el, slideId, containerOffset, scale, onExit }: Props) {
  const updateElement = useStore((s) => s.updateElement);
  const setActiveTextEditor = useStore((s) => s.setActiveTextEditor);
  const setFlushActiveEditor = useStore((s) => s.setFlushActiveEditor);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Auto-save timer — debounce live edits into the store so refresh while
  // still in edit mode doesn't lose work.
  const autoSaveTimer = useRef<number | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      TextStyle,
      FontSize,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      Superscript,
      Subscript,
    ],
    content: el.content,
    autofocus: "end",
    onUpdate: ({ editor: ed }) => {
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = window.setTimeout(() => {
        const json = normalizeDocForSchema(ed.getJSON());
        updateElement(slideId, el.id, { content: json } as any);
        autoSaveTimer.current = null;
      }, 200);
    },
  });

  // Commit-on-exit: write the editor's JSON back to the element. TipTap's
  // FontSize extension stores values as strings like "24px"; our schema wants
  // plain numbers, so normalize before saving. Also cancels any pending
  // debounced auto-save so the final state is what gets persisted.
  const commit = () => {
    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    if (!editor) return;
    const json = normalizeDocForSchema(editor.getJSON());
    updateElement(slideId, el.id, { content: json } as any);
    // Decks bigger than ~64 KB blow past the keepalive size limit, so
    // beforeunload can't reliably persist on refresh. Fire the PUT now
    // instead of waiting on the watch-and-save debounce.
    saveNow();
  };

  // On unmount, flush any pending auto-save so navigating away (incl. refresh
  // via the in-flight save) doesn't drop the latest edits.
  useEffect(() => {
    return () => {
      if (editor) {
        if (autoSaveTimer.current) {
          window.clearTimeout(autoSaveTimer.current);
          autoSaveTimer.current = null;
        }
        // Always re-commit on unmount so a stale auto-save can't be the last
        // word, then force-save immediately.
        const json = normalizeDocForSchema(editor.getJSON());
        updateElement(slideId, el.id, { content: json } as any);
        saveNow();
      }
    };
    // editor is stable for the overlay lifetime; deps intentionally narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Publish the live editor to the store so the side-panel inspector can
  // operate on its selection. Clear on unmount.
  useEffect(() => {
    if (!editor) return;
    setActiveTextEditor(editor);
    setFlushActiveEditor(commit);
    return () => {
      setActiveTextEditor(null);
      setFlushActiveEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Click-outside (excluding the inspector) / Escape → commit + exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        commit();
        onExit();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (overlayRef.current?.contains(t)) return;
      // Treat clicks inside the side-panel inspector as part of the editing UI.
      if (t.closest(".inspector")) return;
      commit();
      onExit();
    };
    window.addEventListener("keydown", onKey);
    // Listen on capture so we win against other handlers.
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [editor]);

  // Pre-load the element's font weights into the document so the overlay's
  // text measurement matches what Konva will draw on commit.
  useEffect(() => {
    const fs = firstTextStyle(el.content);
    if (fs.fontFamily) ensureFontLoaded(fs.fontFamily);
  }, [el.content]);

  const fs = firstTextStyle(el.content);
  const baseFamily = fs.fontFamily ?? "Inter, system-ui, sans-serif";
  const baseSize = fs.fontSize ?? 24;
  const baseColor = fs.color ?? "#111";
  const baseAlign = el.style?.align ?? "left";

  // Screen-space position of the element. We render the overlay at slide-coord
  // dimensions and apply transform: scale(scale) so the inner font sizes (also
  // in slide-coord units) visually match the Konva rendering.
  const left = containerOffset.x + el.x * scale;
  const top = containerOffset.y + el.y * scale;
  const padding = el.style?.padding ?? 0;

  return (
    <div
      ref={overlayRef}
      className="text-edit-overlay"
      style={{
        position: "absolute",
        left,
        top,
        width: el.w,
        height: el.h,
        transform: `scale(${scale}) rotate(${el.rotation ?? 0}deg)`,
        transformOrigin: "0 0",
        padding,
        boxSizing: "border-box",
        background: "rgba(255, 255, 255, 0.0)",
        outline: `${Math.max(1, 1 / scale)}px solid #4a90e2`,
        outlineOffset: 0,
        color: baseColor,
        fontFamily: baseFamily,
        fontSize: baseSize,
        textAlign: baseAlign as any,
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      <EditorContent editor={editor} className="tiptap-content" />
    </div>
  );
}

/** Recursively coerce TipTap-emitted attrs into the shapes our Zod schema wants.
 *  - `textStyle.fontSize` may arrive as "24px" → strip the unit.
 *  - `textStyle.lineHeight` may arrive as "1.5" → parse to number.
 *  - TipTap's TextStyle extension emits *all* declared attributes on every mark,
 *    even ones the user never set, as `null`. Our Zod schema uses `.optional()`
 *    (string|undefined), not `.nullable()`, so any null value rejects the whole
 *    PUT. Strip nulls/undefineds from mark attrs, and drop a mark entirely if
 *    nothing survives. */
function normalizeDocForSchema(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  const out: any = { ...doc };
  if (Array.isArray(doc.marks)) {
    const cleaned: any[] = [];
    for (const m of doc.marks) {
      if (!m) continue;
      const isAttrMark = m.type === "textStyle" || m.type === "highlight";
      if (isAttrMark && m.attrs && typeof m.attrs === "object") {
        const attrs: any = {};
        for (const [k, v] of Object.entries(m.attrs)) {
          if (v === null || v === undefined) continue;
          if (["fontSize", "lineHeight", "letterSpacing", "fontWeight"].includes(k) && typeof v === "string") {
            const n = parseFloat(v);
            if (!isNaN(n)) attrs[k] = n;
            continue;
          }
          attrs[k] = v;
        }
        // textStyle with no surviving attrs is functionally a no-op; drop it
        // rather than send an empty {} that would render with no effect anyway.
        if (Object.keys(attrs).length === 0) continue;
        cleaned.push({ ...m, attrs });
      } else {
        cleaned.push(m);
      }
    }
    if (cleaned.length > 0) out.marks = cleaned;
    else delete out.marks;
  }
  if (Array.isArray(doc.content)) {
    out.content = doc.content.map(normalizeDocForSchema);
  }
  return out;
}

/** Selection-aware formatting controls for the active TipTap editor. Mounted
 *  by the inspector when the user is editing a text element inline. */
export function TextEditToolbar({ editor }: { editor: Editor }) {
  // Trigger re-renders when the editor's selection/marks change so button
  // active states reflect the current selection.
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", fn);
    editor.on("transaction", fn);
    return () => {
      editor.off("selectionUpdate", fn);
      editor.off("transaction", fn);
    };
  }, [editor]);

  const btn = (active: boolean, onClick: () => void, label: string, style?: React.CSSProperties) => (
    <button
      className={active ? "active" : ""}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={style}
    >
      {label}
    </button>
  );

  const currentColor = editor.getAttributes("textStyle").color || "#111111";
  const currentHighlight = editor.getAttributes("highlight").color || "#ffff00";
  const currentSize = editor.getAttributes("textStyle").fontSize ?? editor.getAttributes("fontSize")?.fontSize ?? "";
  const currentFamily =
    editor.getAttributes("textStyle").fontFamily ??
    editor.getAttributes("fontFamily")?.fontFamily ??
    "";

  return (
    <div className="text-edit-toolbar-inner">
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "B", { fontWeight: 700 })}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "I", { fontStyle: "italic" })}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "U", { textDecoration: "underline" })}
      {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "S", { textDecoration: "line-through" })}
      {btn(editor.isActive("superscript"), () => editor.chain().focus().toggleSuperscript().run(), "x²")}
      {btn(editor.isActive("subscript"), () => editor.chain().focus().toggleSubscript().run(), "x₂")}
      <span className="sep" />
      <label title="text color">
        <span style={{ marginRight: 4 }}>A</span>
        <input
          type="color"
          value={currentColor}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <label title="highlight">
        <span style={{ marginRight: 4, background: "#ff0", padding: "0 2px" }}>H</span>
        <input
          type="color"
          value={currentHighlight}
          onChange={(e) => editor.chain().focus().setHighlight({ color: e.target.value }).run()}
        />
      </label>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().unsetHighlight().run()}
        title="clear highlight"
      >
        ×
      </button>
      <span className="sep" />
      <input
        type="number"
        min={6}
        max={500}
        step={1}
        placeholder="size"
        value={currentSize}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v > 0) {
            (editor.chain().focus() as any).setFontSize(`${v}px`).run();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 52 }}
      />
      <select
        value={currentFamily}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          ensureFontLoaded(v);
          (editor.chain().focus() as any).setFontFamily(v).run();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: 110 }}
        title="font family"
      >
        <option value="">font…</option>
        {GOOGLE_FONTS.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  );
}
