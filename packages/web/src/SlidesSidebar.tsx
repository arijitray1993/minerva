import { useStore } from "./store";
import { plainText } from "./text";

export function SlidesSidebar() {
  const deck = useStore((s) => s.deck);
  const currentSlideId = useStore((s) => s.currentSlideId);
  const setCurrentSlide = useStore((s) => s.setCurrentSlide);
  const removeSlide = useStore((s) => s.removeSlide);

  if (!deck) return <div className="sidebar-slides" />;

  return (
    <div className="sidebar-slides">
      {deck.slides.map((slide, i) => {
        const titleEl = slide.elements.find((e) => e.type === "text");
        const summary = titleEl && titleEl.type === "text" ? plainText(titleEl.content).slice(0, 40) : `Slide ${i + 1}`;
        return (
          <div
            key={slide.id}
            className={`slide-thumb ${slide.id === currentSlideId ? "active" : ""}`}
            onClick={() => setCurrentSlide(slide.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (deck.slides.length > 1 && confirm(`Delete slide ${i + 1}?`)) removeSlide(slide.id);
            }}
            title="Click to open, right-click to delete"
          >
            <div className="num">{i + 1}</div>
            <div className="preview">{summary || `Slide ${i + 1}`}</div>
          </div>
        );
      })}
    </div>
  );
}
