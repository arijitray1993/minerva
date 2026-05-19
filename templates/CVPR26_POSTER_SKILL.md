---
name: make-minerva-poster
description: Build a polished CVPR/NeurIPS-style single-slide poster in the Minerva visualizer (deck.json, Konva-rendered). Use when the user wants to draft, iterate, or polish a poster for a paper using the Minerva slide app.
argument-hint: <paper title or topic, conference name, optional reference image path>
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch
---

# /make-minerva-poster — Polished CVPR-style poster in Minerva

You are about to author a single-slide research poster inside the **Minerva visualizer app**. The slide lives in `deck.json` (validated against `@minerva/schema`), is rendered by Konva on canvas, and is your *only* ground truth for layout. This skill captures the design system and workflow proven on a real CVPR-style poster.

User notes: `$ARGUMENTS`

---

## 0. Quickstart (do this on every session start)

1. Read `MINERVA.md` in the deck folder if present — it overrides anything here.
2. Read `comments.json` and address every entry with `status: "open"`. Mark resolved when done with `"status": "resolved"` and an ISO timestamp on `resolvedAt`.
3. Read `feature_iteration.md` and skim for any `OPEN` entries addressed to you (rare).
4. Render the current state once: `minerva render slide-1` and Read the resulting PNG so you know what the human is looking at.
5. Make changes via small Python build scripts in `/tmp/`, then re-render and re-Read.

**Never** create `*.html`, `*.htm`, `*.css`, or "preview" / "mockup" / "render" files in the deck folder. The only acceptable preview is the PNG produced by `minerva render`.

---

## 1. Project folder

```
<deck>/
├── deck.json              # The slide. Validate against @minerva/schema.
├── comments.json          # Human's per-element feedback (status: open|resolved).
├── feature_iteration.md   # Append-only mailbox to renderer-claude.
├── MINERVA.md             # Project-specific rules (read first).
├── assets/                # Images: logos, QR, photos, charts.
└── .minerva/preview-<slide-id>.png   # Rendered output you inspect.
```

If the user pasted reference posters or a polished example, view them with the Read tool and match the aesthetic.

---

## 2. Canvas, grid, and the narrative

CVPR landscape posters are typically **84"×42"** at high DPI. Use a Minerva canvas of:

```json
"size": { "w": 8064, "h": 4032 }
```

(3.2× the original 2520×1260; produces a 16128×8064 PNG with sub-pixel-clean text.)

### Default narrative grid (8 cards in two rows + thin title bar)

```
┌────────────────────── TITLE BAR (compact, ~150 tall) ───────────────────┐
│ Title | Authors | Logos bundled tight | QR code                          │
├────┬─────────┬─────────┬────────┬────────┬────────┬─────────┬───────────┤
│ A1 │   A2    │   A3    │   A4   │  ────── tagline strip ──────          │
│Gap │ Our Idea│ Training│  Gains │   (one-line value prop)               │
├────┼─────────┼─────────┼────────┼────────┼────────┼─────────┼───────────┤
│ B1 │  B2     │  B3     │  B4    │  Results, charts, takeaways           │
│Tbl │ Chart   │ Curves  │ Notes  │                                       │
└────┴─────────┴─────────┴────────┴────────┴────────┴─────────┴───────────┘
```

Card widths vary by content (a results table is wider than "takeaways"). Heights are fixed per row. Always leave ~32-64 px gutters between cards.

**Title bar is COMPACT.** ~150 tall, not 400. Bundle logos tight, drop affiliation lines (logos already encode that), use a QR code not URL text.

---

## 3. Color palette (proven)

```python
NAVY      = "#0c2536"   # primary text, dark surfaces, stripes
NAVY_DIM  = "#3b4f5d"   # body copy when not on white
GOLD      = "#f3d27a"   # accent on dark surfaces
GOLD_DK   = "#c08a1a"   # accent/emphasis on light surfaces
CREAM     = "#f4ecdb"   # warm inset background (failure callouts, reasoning panels)
WHITE     = "#ffffff"   # cards
DIM       = "#6b7a85"   # subtle labels
CORAL     = "#c64435"   # failure / negative
GREEN     = "#2f8f44"   # success / positive
BODY_BG   = "#f3ede0"   # poster background (cream, not white, not teal)
```

**Don't use teal/dark-blue full-canvas backgrounds.** Cream body + thin navy strip + white cards reads as polished; teal reads as PowerPoint.

---

## 4. Typography

- **Body / headlines**: `Inter` at weights 400–900.
- **Casual / script labels** (e.g., "mull"): `Pacifico` or `Caveat`. Test that the Google Font actually loads in `minerva render` — if it falls back to Inter italic, file a BUG.
- **All-caps section labels** (e.g. `"1 · THE GAP"`, `"INPUT QUESTION"`): `letterSpacing: 4–5`, `fontWeight: 800`.
- **Big titles**: negative letterSpacing (−0.5 to −4) tightens display type.

**TipTap content quirks** (the renderer uses TipTap docs for text):
- Each `\n` must be a **separate paragraph** node — `\n` inside a text run does NOT line-break.
- The renderer reads only the **first text run's** marks for styling — don't mix bold/regular in one text element; split into two elements.

---

## 5. Element patterns (copy these)

Build elements through small Python scripts that emit JSON and append to `deck.json`. Inline JSON-editing by hand is fragile.

### 5.1 Helper functions

```python
import json
from pathlib import Path

DECK = Path("deck.json")
data = json.loads(DECK.read_text())
slide = data["slides"][0]
elements = slide["elements"]

NAVY="#0c2536"; GOLD="#f3d27a"; GOLD_DK="#c08a1a"; CREAM="#f4ecdb"
WHITE="#ffffff"; CORAL="#c64435"; GREEN="#2f8f44"; DIM="#6b7a85"

def text_el(eid, x, y, w, h, text, *, size, weight=500, color=NAVY,
            family="Inter", align="left", valign="top",
            ls=0, lh=1.25, italic=False, rotation=0):
    paras = []
    for line in text.split("\n"):
        if not line:
            paras.append({"type": "paragraph", "content": []})
            continue
        attrs = {"fontFamily": family, "fontSize": size, "fontWeight": weight,
                 "color": color, "letterSpacing": ls, "lineHeight": lh}
        if italic: attrs["fontStyle"] = "italic"
        paras.append({"type": "paragraph", "content": [{
            "type": "text", "text": line,
            "marks": [{"type": "textStyle", "attrs": attrs}],
        }]})
    return {"id": eid, "type": "text",
            "x": x, "y": y, "w": w, "h": h, "rotation": rotation,
            "content": {"type": "doc", "content": paras},
            "style": {"align": align, "verticalAlign": valign}}

def rect_el(eid, x, y, w, h, fill, *, radius=18, stroke=None, sw=0,
            opacity=1, shadow=None):
    style = {"fill": fill, "stroke": stroke or fill, "strokeWidth": sw,
             "opacity": opacity, "radius": radius}
    if shadow: style["shadow"] = shadow
    return {"id": eid, "type": "shape", "shapeKind": "rect",
            "x": x, "y": y, "w": w, "h": h, "rotation": 0, "style": style}

def image_el(eid, x, y, w, h, src, *, radius=12):
    return {"id": eid, "type": "image",
            "x": x, "y": y, "w": w, "h": h, "rotation": 0,
            "src": src, "style": {"radius": radius}}

def curve_el(eid, x1, y1, x2, y2, control_dx, control_dy, *,
             stroke=GOLD_DK, sw=6, arrow_end=True, arrow_start=False):
    # See section 6 for the IMPORTANT direction constraint.
    if x2 < x1 or y2 < y1:
        x1, x2 = x2, x1; y1, y2 = y2, y1
        arrow_start, arrow_end = arrow_end, arrow_start
    style = {"stroke": stroke, "strokeWidth": sw,
             "controlX": max(int(control_dx), 0),
             "controlY": max(int(control_dy), 0)}
    if arrow_end: style["arrowEnd"] = True
    if arrow_start: style["arrowStart"] = True
    return {"id": eid, "type": "shape", "shapeKind": "curveQuad",
            "x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1,
            "rotation": 0, "style": style}
```

### 5.2 Card with shadow + stripe

```python
elements.append(rect_el(
    "shape-card-a1", x=96, y=768, w=1728, h=1536, fill=WHITE, radius=22,
    shadow={"blur": 70, "color": "rgba(12,37,54,0.18)",
            "offsetX": 0, "offsetY": 12, "opacity": 1},
))
# Thin navy accent stripe at the top of the card
elements.append(rect_el(
    "shape-card-a1-stripe", x=96, y=768, w=1728, h=19, fill=NAVY, radius=0,
))
```

### 5.3 Section heading inside a card

```python
elements.append(text_el(
    "text-a1-head", x=179, y=845, w=1562, h=115,
    "1 · THE GAP",
    size=72, weight=800, color=GOLD_DK, ls=8,
))
```

### 5.4 Navy question card (input prompt)

```python
elements.append(rect_el("a2-q-card", x, y, w, h=170, fill=NAVY, radius=22,
    shadow={"blur": 24, "color": "rgba(12,37,54,0.20)",
            "offsetX": 0, "offsetY": 8, "opacity": 1}))
elements.append(text_el("a2-q-label", x+28, y+18, w-56, 32,
    "QUESTION", size=20, weight=800, color=GOLD, ls=5))
elements.append(text_el("a2-q-text", x+28, y+56, w-56, 96,
    "“Which option fills the missing corner?”",
    size=30, weight=600, color=WHITE, lh=1.18))
```

### 5.5 Failure callout (cream + coral stripe + ✕ badge)

```python
# outer card
elements.append(rect_el(f"{p}-bg", x, y, w, h, fill=CREAM, radius=22))
# left coral stripe
elements.append(rect_el(f"{p}-stripe", x, y, 14, h, fill=CORAL, radius=22))
# badge
elements.append(rect_el(f"{p}-badge", x+38, y+32, 64, 64, fill=CORAL, radius=18))
elements.append(text_el(f"{p}-x", x+38, y+32, 64, 64,
    "✕", size=42, weight=800, color=WHITE, align="center", valign="middle"))
# title + body next to it (see 5.1)
```

### 5.6 Big numeric delta (use sparingly — visuals beat numbers stacked alone)

```python
elements.append(text_el("delta", x, y, 360, 150,
    "+3.0%", size=120, weight=900, color=GOLD, ls=-4, lh=1.0))
elements.append(text_el("delta-sub", x, y+140, 360, 36,
    "avg accuracy", size=22, weight=600, color=WHITE, ls=0.4))
```

When a comment says "this is too big" on stacked deltas, replace with **baseline pipeline diagrams** showing what the gain is *over* (input → baseline pipeline → answer + the delta to the right).

### 5.7 Tables

Use the renderer's `table` element, **not** a hand-built grid of rect+text. Manual grids drift and look amateur.

### 5.8 Real charts (not hand-drawn bars)

Generate with matplotlib, save to `assets/chart_<x>.png`, drop in as an image:

```python
# /tmp/make_chart.py
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(6, 4), dpi=300)
ax.bar(["A","B","C","D"], [61.4, 59.2, 65.9, 66.8], color=["#9fb6c5"]*3 + ["#f3d27a"])
ax.set_ylim(50, 70); ax.set_ylabel("accuracy %")
plt.tight_layout(); plt.savefig("assets/chart_mm_warmup.png", dpi=300)
```

---

## 6. curveQuad arrow constraints (CRITICAL)

**`curveQuad` requires `w ≥ 0` AND `h ≥ 0`** in its bounding box. It draws the **top-left → bottom-right diagonal** of that bbox. You cannot draw the *anti*-diagonal (e.g., a down-LEFT or up-RIGHT arrow) with a single curveQuad.

Practical consequences:
- **Down-and-right** and **horizontal** and **vertical** arrows: trivial.
- **Up-right** or **down-left** arrows: not directly drawable. Workarounds:
  1. Re-route through a horizontal arrow at a different y.
  2. Place the arrow so source is up-and-left of target.
  3. Drop the arrow — adjacent layout usually conveys the connection.
- **`controlX`, `controlY`** are offsets from the start point; clamp to ≥ 0 to avoid validator errors.
- The helper in 5.1 swaps endpoints automatically when both axes need flipping (works for the diagonal case only).

Example: 4 "distillation" arrows from a panel's bottom edge to 4 token labels below it. Place each source slightly LEFT of its target so dx > 0:

```python
for i, tok in enumerate(mull_tokens):
    target_cx = tok["x"] + tok["w"]//2
    target_y  = tok["y"]
    src_x = target_cx - 32        # source up-LEFT of target → dx>0, dy>0
    src_y = panel_bottom_y
    elements.append(curve_el(f"distil-{i+1}",
        src_x, src_y, target_cx, target_y,
        control_dx=max((target_cx-src_x)//2, 1),
        control_dy=(target_y-src_y) + 12,
        stroke=GOLD_DK, sw=5, arrow_end=True))
```

---

## 7. The render loop

```
1. Edit deck.json (via a python script in /tmp/).
2. minerva render slide-1                 # one-shot
   minerva render all                     # all slides
3. Read .minerva/preview-slide-1.png      # this is what the human sees
4. Crop to the card you edited (see snippet below) and Read that.
5. Iterate. Mark relevant comments resolved.
```

Crop snippet:

```python
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(".minerva/preview-slide-1.png")
W, H = im.size; sx = W/8064; sy = H/4032
crop = (int(card_x*sx)-4, int(card_y*sy)-4,
        int((card_x+card_w)*sx)+8, int((card_y+card_h)*sy)+8)
im2 = im.crop(crop); im2.thumbnail((2200, 2200))
im2.save("/tmp/card_review.png")
```

`minerva render` requires `minerva serve` running in the deck folder (default port 5174). If you can't find `minerva` on PATH, look for `node <minerva-repo>/packages/server/dist/cli.js`.

---

## 8. Comments protocol

`comments.json` is the human's per-element feedback. Schema:

```json
{ "comments": [
  { "id": "c-<slug>", "slideId": "slide-1",
    "targetIds": ["text-a1-pitch"], "author": "human",
    "request": "make this a visual not bullets",
    "status": "open" | "in_progress" | "resolved",
    "createdAt": "2026-...", "resolvedAt": "2026-..." }
] }
```

On every session start: read it, find every `"status": "open"`, action each one, then set status to `resolved` and add a `resolvedAt` timestamp. **Don't** delete comments — that loses history.

Watch for **image attachments**: the human may paste reference images that land in `assets/` as hash-named PNGs (e.g. `094a0c7095b69de6.png`). Cross-reference their modification time with the comment's `createdAt` to find which images are intended for which comment. Always view them with Read before designing.

---

## 9. Talking to renderer-claude (feature_iteration.md)

A second Claude works on the renderer in a sibling repo. You communicate via `feature_iteration.md` only — append-only, monotonic IDs.

- **REQUEST** — a new renderer feature you need (e.g., gradient fills, new arrow type, font support). Include WHY and the simplest possible API you'd accept.
- **BUG** — a renderer issue (e.g., PrintView hangs when `strokeWidth>0 + shadow + radius` are combined on a rect). Attach a minimal repro element JSON.
- **NOTE** — short heads-up.

**Bundle** requests and bugs; don't fire them one-at-a-time. Wait ~10 min after a batch for renderer-claude to land changes.

---

## 10. Don't-do list

- Don't make the title bar tall. ~150 px is enough on the 8064×4032 canvas.
- Don't use stark teal/blue backgrounds. Cream + thin navy + white cards.
- Don't replace short text with a Powerpoint-style 5-bullet list. If the human's comment says "too text-heavy", build a **visual** with the relevant figure + 2 concise callouts.
- Don't stack `+3%/+16%/20 tokens` deltas without showing what they're *vs.* — make baseline pipeline diagrams.
- Don't draw bar charts with rect elements. Generate with matplotlib.
- Don't draw tables with rect/text. Use the `table` element.
- Don't combine `strokeWidth > 0` + `shadow` + `radius` on a rect — PrintView can hang. File a BUG with a repro.
- Don't add `\n` inside one text run expecting line breaks. Use one paragraph per line.
- Don't write inline JSON by hand into `deck.json` — use a small Python build script in `/tmp/`. They're easy to re-run and easy to read.
- Don't create custom HTML preview files. The PNG from `minerva render` is the only truth.
- Don't try to use Google Fonts without testing — confirm the family actually loads in CLI render before committing typography decisions to it.
- Don't iterate on one card while ignoring its neighbors. After a non-trivial change, re-render the whole slide and skim it at thumbnail size to catch regressions.

---

## 11. Suggested first session

1. Greet user, confirm paper title/topic and conference. Ask for figures available in the paper folder.
2. Set canvas size, build the title bar with logos + QR.
3. Draft 8 card frames with section headings only (`1 · THE GAP` … `8 · TAKE-AWAYS`).
4. Render, show the human the empty scaffolding.
5. Fill cards left-to-right, top-to-bottom. Use the *narrative* of the paper: gap → idea → method → main result → ablations → take-aways. Don't reproduce the paper section order verbatim.
6. After every 2–3 cards, re-render full slide and skim at thumbnail size to keep proportions honest.
7. When the human leaves comments, address them by replacing text-heavy panels with visuals (see 5.5 callouts) before adding more content.

Good posters are ~70% visual, ~30% text. The text that survives must be tight, declarative, and *load-bearing*. Cut adjectives. Use figures, callouts, deltas, mini-diagrams, and real charts.
