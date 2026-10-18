import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  if (typeof window === "undefined") return;
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

// Node-environment tests (the API functions) have no DOM to patch.
const hasDom = typeof window !== "undefined";

// jsdom implements neither, and components lean on both.
if (hasDom && !("IntersectionObserver" in globalThis)) {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
}

if (hasDom && !window.matchMedia) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

if (hasDom && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
