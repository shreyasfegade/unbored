/**
 * Smoke tests for the two things that broke in production without anyone
 * noticing: the pick never rendered, and route changes left the previous page
 * mounted. Both were caused by content being gated on animations that never
 * finished, so these assert the *outcome* (content is on screen) rather than
 * any animation detail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pickResponse = {
  primary: {
    media: {
      id: "tmdb_475557",
      source: "tmdb_movie",
      title: "Joker",
      original_title: "Joker",
      overview: "A failed stand-up comedian turns to crime and chaos.",
      poster_path: "https://image.tmdb.org/t/p/w500/x.jpg",
      backdrop_path: null,
      genres: ["crime", "thriller"],
      keywords: [],
      vote_average: 8.1,
      vote_count: 27813,
      runtime_minutes: 122,
      release_year: 2019,
      media_type: "movie",
      status: "Released",
      popularity: 15,
      cast: [],
      director: "Todd Phillips",
      studio: null,
      release_date: "2019-10-01",
      year: 2019,
      episode_count: null,
      source_api: "tmdb",
    },
    score: 0.82,
    score_breakdown: { relevance: 0.87, mood: 0.73, runtime: 0.99, quality: 0.69, recency: 0.9 },
    rationale: "Right in your wheelhouse.",
  },
  alternates: [],
  rationale: "Right in your wheelhouse.",
  picked_by: "engine",
  provider: null,
  ai_status: "off",
  media_type_applied: true,
  confidence: "high",
  request_id: "test",
};

// One fake transport for every call the app makes, routed by URL.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  const get = vi.fn(async (url: string) => {
    if (url.includes("/api/health")) return { data: { status: "ok" } };
    if (url.includes("/api/browse/shelves")) return { data: { shelves: [] } };
    if (url.includes("/api/browse/")) return { data: { items: [], total: 0, next_offset: null } };
    if (url.includes("/api/search")) return { data: { results: [], items: [] } };
    return { data: {} };
  });
  const post = vi.fn(async (url: string) => {
    if (url.includes("/api/recommend")) return { data: pickResponse };
    return { data: {} };
  });
  return { ...actual, default: { get, post } };
});

async function renderApp() {
  localStorage.setItem(
    "unbored-taste",
    JSON.stringify({ state: { hasCompletedOnboarding: true, favouriteIds: ["tmdb_27205"] }, version: 0 }),
  );
  const { default: App } = await import("../App");
  return render(<App />);
}

beforeEach(() => {
  vi.resetModules();
});

describe("the pick flow", () => {
  it("shows the recommended title after choosing a mood and a time", async () => {
    const user = userEvent.setup();
    await renderApp();

    // HomePage is code-split, so give the chunk time to resolve. Mood and time
    // are radios, not buttons.
    const wait = { timeout: 8000 };
    await user.click(await screen.findByRole("radio", { name: /thrilled/i }, wait));
    await user.click(await screen.findByRole("radio", { name: /90\+ min/i }, wait));
    await user.click(await screen.findByRole("button", { name: /find my pick/i }, wait));

    // The reveal is staged over a couple of seconds; what matters is that it
    // arrives at all, which is exactly what regressed.
    await waitFor(() => expect(screen.getByText("Joker")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText(/How are you feeling/i)).not.toBeInTheDocument();
  }, 20000);
});

describe("route changes", () => {
  it("leaves exactly one page mounted", async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(await screen.findByText(/How are you feeling/i, {}, { timeout: 8000 })).toBeInTheDocument();

    // Via the bottom nav, which is now how every mode is reached.
    await user.click(screen.getByRole("link", { name: /^library$/i }));

    // Match the page heading, not the header link that shares its label.
    await screen.findByRole("heading", { name: /your library/i }, { timeout: 8000 });
    // The old page must be gone, not merely faded out and left in the tree.
    expect(screen.queryByText(/How are you feeling/i)).not.toBeInTheDocument();
  }, 20000);
});
