/** The reveal's extras: trailer, "Why not X?" against the real engine, and the share card. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { servePack } from "../../test/servePack";
import { setCatalogForTests } from "../../engine/pack";
import { setReadyForTests } from "../../engine/host";
import { engine } from "../../engine/client";
import { Trailer } from "../trailer/Trailer";
import { WhyNot } from "../whynot/WhyNot";
import { compare } from "../whynot/compare";
import { posterProxyUrl, sharePick, wrapText } from "../../share/shareCard";
import type { MediaItem } from "../../types/media";
import type { RecommendationRequest, ScoredMediaItem } from "../../types/recommendation";

const media = (extra: Partial<MediaItem> = {}) => ({ id: "x", title: "Dune", release_year: 2021, genres: ["sci-fi"], media_type: "movie", ...extra }) as MediaItem;
const scored = (b: Partial<ScoredMediaItem["score_breakdown"]>, score: number, m = media()): ScoredMediaItem => ({
  media: m,
  score,
  score_breakdown: { relevance: 0.5, mood: 0.5, runtime: 0.5, quality: 0.5, recency: 0.5, ...b },
});

afterEach(() => vi.unstubAllGlobals());

describe("Trailer", () => {
  it("loads nothing from YouTube until asked", async () => {
    const { container } = render(<Trailer media={media({ trailer: { site: "youtube", key: "abcDEF12345" } })} />);
    expect(container.querySelector("iframe")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /play the dune trailer/i }));
    const frame = container.querySelector("iframe")!;
    expect(frame.src).toBe("https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1&mute=1&rel=0&playsinline=1");
  });

  it("renders nothing without a usable trailer", () => {
    expect(render(<Trailer media={media()} />).container).toBeEmptyDOMElement();
    expect(render(<Trailer media={media({ trailer: { site: "youtube", key: "bad key/../" } })} />).container).toBeEmptyDOMElement();
  });
});

describe("compare", () => {
  it("names the biggest shortfalls and what the other title does better", () => {
    const c = compare(scored({ mood: 0.9, runtime: 0.8 }, 0.8), scored({ mood: 0.3, runtime: 0.6, quality: 0.9 }, 0.6), "Heat");
    expect(c.behind).toEqual(["mood", "runtime"]);
    expect(c.ahead).toEqual(["quality"]);
    expect(c.sentence).toBe("Heat loses mostly on mood fit and fit for your time, though it beats your pick on rating.");
  });

  it("is honest when the other title scores as well or the AI chose", () => {
    expect(compare(scored({}, 0.6), scored({}, 0.7), "Heat").sentence).toMatch(/level with your pick/);
    expect(compare(scored({}, 0.6), scored({}, 0.7), "Heat", true).sentence).toMatch(/the AI chose yours/);
    expect(compare(scored({}, 0.62), scored({ mood: 0.48 }, 0.6), "Heat").sentence).toMatch(/trails by a little/);
  });
});

describe("Why not X", () => {
  const request: RecommendationRequest = {
    favourite_ids: ["tmdb_157336", "tmdb_27205"],
    mood: "thrilled",
    time_available: "long",
    time_of_day: "evening",
    media_type: "movie",
    era: "any",
    excluded_ids: [],
  };

  beforeEach(() => {
    setCatalogForTests(null);
    setReadyForTests(null);
    servePack();
  });

  it("scores a searched title against the pick with the real engine", async () => {
    const { response } = await engine.recommend(request);
    const user = userEvent.setup();
    render(<WhyNot pick={response.primary} request={request} pickedByAi={false} />);
    await user.click(screen.getByRole("button", { name: /why this and not something else/i }));
    await user.type(screen.getByLabelText(/name a title/i), "godfather");
    await user.click(await screen.findByRole("button", { name: /^the godfather 1972/i }));
    expect(await screen.findByRole("heading", { name: `The Godfather vs ${response.primary.media.title}` })).toBeInTheDocument();
    expect(screen.getByText(/ranked #\d+ of \d+ for this request|scored on its own/i)).toBeInTheDocument();
    expect(screen.getByText("Fits the mood")).toBeInTheDocument();

    const direct = await engine.explain(request, "tmdb_238");
    expect(direct.scored.media.id).toBe("tmdb_238");
    expect(direct.rank).toBeGreaterThan(1);
  }, 20000);
});

describe("share card", () => {
  it("wraps text and ellipsises the overflow", () => {
    const measure = (s: string) => s.length;
    expect(wrapText("one two three four five", 9, 5, measure)).toEqual(["one two", "three", "four five"]);
    expect(wrapText("one two three four five", 9, 2, measure)).toEqual(["one two", "three…"]);
    expect(wrapText("supercalifragilistic", 5, 2, measure)).toEqual(["supercalifragilistic"]);
  });

  it("asks for posters through the same-origin proxy at a sharper size", () => {
    expect(posterProxyUrl("https://image.tmdb.org/t/p/w500/a.jpg")).toBe(
      "/api/poster?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw780%2Fa.jpg",
    );
  });

  it("falls back to copying the link where sharing files isn't possible", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await sharePick({ media: media(), reason: "r", url: "https://u.example/pick/x" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://u.example/pick/x");
  });

  it("treats a dismissed share sheet as cancelled, not failed", async () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    vi.stubGlobal("navigator", { share: vi.fn(async () => { throw abort; }) });
    expect(await sharePick({ media: media(), reason: null, url: "u" })).toBe("cancelled");
  });
});
