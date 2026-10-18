import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MediaItem } from "../../types/media";
import { WatchPanel } from "./WatchPanel";
import { primaryWatchUrl, watchOptions } from "./watchOptions";

const base = { id: "tmdb_1", title: "Dune", release_year: 2021 } as MediaItem;
const netflix = { id: 8, name: "Netflix", logo: "/n.jpg" };
const apple = { id: 2, name: "Apple TV", logo: null };
const play = { id: 3, name: "Google Play Movies", logo: null };
const LINK = "https://www.themoviedb.org/movie/1/watch?locale=IN";

describe("watchOptions", () => {
  it("treats a missing watch field as unchecked and an empty one as unavailable", () => {
    expect(watchOptions({}).kind).toBe("unchecked");
    expect(watchOptions({ watch: null }).kind).toBe("unchecked");
    expect(watchOptions({ watch: {} }).kind).toBe("none");
  });

  it("lists each store once when it both rents and sells", () => {
    const o = watchOptions({ watch: { IN: { link: LINK, rent: [apple, play], buy: [apple] } } });
    expect(o).toMatchObject({ kind: "providers", stream: [], rent: [apple, play], buy: [] });
  });

  it("falls back to AniList links only when India has nothing", () => {
    const any = { links: [{ name: "Crunchyroll", url: "https://cr.example/x" }] };
    expect(watchOptions({ watch: { any } }).kind).toBe("links");
    expect(watchOptions({ watch: { IN: { flatrate: [netflix] }, any } }).kind).toBe("providers");
  });

  it("points the main button at the best place it knows", () => {
    expect(primaryWatchUrl({ ...base, watch: { IN: { link: LINK, flatrate: [netflix] } } })).toBe(LINK);
    expect(primaryWatchUrl({ ...base, watch: { any: { links: [{ name: "X", url: "https://x.example" }] } } })).toBe("https://x.example");
    expect(primaryWatchUrl(base)).toContain("google.com/search?q=watch%20Dune%202021");
  });
});

describe("WatchPanel", () => {
  it("shows streaming services with the JustWatch credit", () => {
    render(<WatchPanel media={{ ...base, watch: { IN: { link: LINK, flatrate: [netflix], rent: [apple] } } }} />);
    expect(screen.getByRole("heading", { name: /where to watch in india/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /netflix/i })).toHaveAttribute("href", LINK);
    expect(screen.getByText("Apple TV")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "JustWatch" })).toBeInTheDocument();
  });

  it("says when it's only to rent or buy", () => {
    render(<WatchPanel media={{ ...base, watch: { IN: { link: LINK, buy: [play] } } }} />);
    expect(screen.getByText(/not on a subscription service in india/i)).toBeInTheDocument();
    expect(screen.getByText("Google Play Movies")).toBeInTheDocument();
  });

  it("has a designed empty state", () => {
    render(<WatchPanel media={{ ...base, watch: {} }} />);
    expect(screen.getByText(/not streaming, renting or selling in india/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /search the web/i })).toBeInTheDocument();
  });

  it("labels AniList links as not region-checked", () => {
    render(<WatchPanel media={{ ...base, watch: { any: { links: [{ name: "Crunchyroll", url: "https://cr.example" }] } } }} />);
    expect(screen.getByRole("link", { name: /crunchyroll/i })).toHaveAttribute("href", "https://cr.example");
    expect(screen.getByText(/not checked for india/i)).toBeInTheDocument();
  });

  it("renders nothing when the catalog has no availability data", () => {
    const { container } = render(<WatchPanel media={base} />);
    expect(container).toBeEmptyDOMElement();
  });
});
