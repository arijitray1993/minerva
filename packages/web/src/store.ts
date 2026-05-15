import { create } from "zustand";
import type { DeckT, ElementT, SlideT } from "@minerva/schema";

type HistoryEntry = { deck: DeckT };

type State = {
  deck: DeckT | null;
  currentSlideId: string | null;
  selectedIds: string[];
  history: HistoryEntry[];
  historyIndex: number;
  /** When true, suppress sending changes back to the server (e.g. while applying a server-sourced update). */
  applyingRemote: boolean;
};

type Actions = {
  setDeck: (deck: DeckT, fromRemote?: boolean) => void;
  setCurrentSlide: (slideId: string) => void;
  setSelection: (ids: string[]) => void;
  updateElement: (slideId: string, elementId: string, patch: Partial<ElementT>) => void;
  addElement: (slideId: string, el: ElementT) => void;
  removeElement: (slideId: string, elementId: string) => void;
  reorderElement: (slideId: string, elementId: string, op: "front" | "back" | "forward" | "backward") => void;
  addSlide: () => void;
  removeSlide: (slideId: string) => void;
  reorderSlides: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  setDeckTitle: (title: string) => void;
};

export const useStore = create<State & Actions>((set, get) => ({
  deck: null,
  currentSlideId: null,
  selectedIds: [],
  history: [],
  historyIndex: -1,
  applyingRemote: false,

  setDeck: (deck, fromRemote) => {
    set((s) => {
      const slideExists = deck.slides.some((sl) => sl.id === s.currentSlideId);
      const next: Partial<State> = {
        deck,
        currentSlideId: slideExists ? s.currentSlideId : deck.slides[0]?.id ?? null,
        applyingRemote: !!fromRemote,
      };
      // History reset on full deck replacement (initial load or remote sync).
      if (fromRemote || s.history.length === 0) {
        next.history = [{ deck }];
        next.historyIndex = 0;
      }
      return next;
    });
    if (fromRemote) {
      // Drop the applyingRemote flag on the next tick so save effects fire normally afterwards.
      queueMicrotask(() => set({ applyingRemote: false }));
    }
  },

  setCurrentSlide: (slideId) => set({ currentSlideId: slideId, selectedIds: [] }),
  setSelection: (ids) => set({ selectedIds: ids }),

  updateElement: (slideId, elementId, patch) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      const idx = slide.elements.findIndex((e) => e.id === elementId);
      if (idx < 0) return;
      slide.elements[idx] = { ...slide.elements[idx], ...patch } as ElementT;
    }),

  addElement: (slideId, el) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      slide.elements.push(el);
    }),

  removeElement: (slideId, elementId) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      slide.elements = slide.elements.filter((e) => e.id !== elementId);
    }),

  reorderElement: (slideId, elementId, op) =>
    mutate(set, get, (deck) => {
      const slide = findSlide(deck, slideId);
      if (!slide) return;
      const i = slide.elements.findIndex((e) => e.id === elementId);
      if (i < 0) return;
      const [el] = slide.elements.splice(i, 1);
      const last = slide.elements.length;
      let j: number;
      switch (op) {
        case "back": j = 0; break;
        case "front": j = last; break;
        case "backward": j = Math.max(0, i - 1); break;
        case "forward": j = Math.min(last, i + 1); break;
      }
      slide.elements.splice(j, 0, el);
    }),

  addSlide: () =>
    mutate(set, get, (deck) => {
      const id = `slide-${deck.slides.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
      deck.slides.push({ id, elements: [], background: { fill: "#ffffff" } });
    }),

  removeSlide: (slideId) =>
    mutate(set, get, (deck) => {
      deck.slides = deck.slides.filter((s) => s.id !== slideId);
      if (deck.slides.length === 0) {
        deck.slides.push({ id: "slide-1", elements: [], background: { fill: "#ffffff" } });
      }
    }),

  reorderSlides: (from, to) =>
    mutate(set, get, (deck) => {
      const [m] = deck.slides.splice(from, 1);
      deck.slides.splice(to, 0, m);
    }),

  setDeckTitle: (title) =>
    mutate(set, get, (deck) => {
      deck.title = title;
    }),

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    set({ deck: deepClone(history[i].deck), historyIndex: i });
  },
  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    set({ deck: deepClone(history[i].deck), historyIndex: i });
  },
}));

function mutate(
  set: (s: Partial<State>) => void,
  get: () => State & Actions,
  fn: (deck: DeckT) => void
) {
  const s = get();
  if (!s.deck) return;
  const next = deepClone(s.deck);
  fn(next);
  const trimmed = s.history.slice(0, s.historyIndex + 1);
  trimmed.push({ deck: next });
  // Cap history.
  const MAX = 100;
  const start = Math.max(0, trimmed.length - MAX);
  const sliced = trimmed.slice(start);
  set({ deck: next, history: sliced, historyIndex: sliced.length - 1 });
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function findSlide(deck: DeckT, slideId: string): SlideT | undefined {
  return deck.slides.find((s) => s.id === slideId);
}

export function findElement(deck: DeckT, id: string): { slide: SlideT; el: ElementT } | undefined {
  for (const slide of deck.slides) {
    const el = slide.elements.find((e) => e.id === id);
    if (el) return { slide, el };
  }
  return undefined;
}
