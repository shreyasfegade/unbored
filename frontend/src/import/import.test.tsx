import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { parseCsv } from "./csv";
import { ImportFormatError, parseExport, type ImportRow } from "./formats";
import { matchRows } from "./match";
import { MAX_IMPORTED_FAVOURITES, planImport } from "./plan";
import { applyImport } from "./apply";
import { servePack } from "../test/servePack";
import { setCatalogForTests } from "../engine/pack";
import { useTasteStore } from "../stores/tasteStore";
import { useLibraryStore } from "../stores/libraryStore";
import type { MediaItem } from "../types/media";
import ImportPage from "../pages/ImportPage";

const LETTERBOXD = `\uFEFFDate,Name,Year,Letterboxd URI,Rating
2024-01-02,Interstellar,2014,https://boxd.it/a,5
2024-01-03,"The Godfather",1972,https://boxd.it/b,4.5
2024-01-04,Spider-Man,2002,https://boxd.it/c,2
2024-01-05,"Some Film, With a Comma",2019,https://boxd.it/d,3
2024-01-06,The Shawshank Redemption,1995,https://boxd.it/e,
`;

const IMDB = `Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt0816692,9,2024-01-01,Interstellar,Interstellar,https://imdb.com/t,Movie,8.7,169,2014,Sci-Fi,2000000,2014-11-07,Christopher Nolan
tt0068646,3,2024-01-01,The Godfather,The Godfather,https://imdb.com/t,Movie,9.2,175,1972,Crime,2000000,1972-03-24,F
tt9999999,8,2024-01-01,Pilot,Pilot,https://imdb.com/t,TV Episode,8,40,2010,Drama,10,2010-01-01,X
`;

describe("csv", () => {
  it("handles quotes, doubled quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\nz,\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["z", ""]]);
  });
});

describe("formats", () => {
  it("reads Letterboxd ratings on a 10-point scale", () => {
    const { source, rows } = parseExport(LETTERBOXD);
    expect(source).toBe("letterboxd");
    expect(rows[0]).toEqual({ title: "Interstellar", year: 2014, rating10: 10, kind: "movie" });
    expect(rows[3].title).toBe("Some Film, With a Comma");
    expect(rows[4].rating10).toBeNull();
  });

  it("reads IMDb ratings and skips single episodes", () => {
    const { source, rows, skipped } = parseExport(IMDB);
    expect(source).toBe("imdb");
    expect(skipped).toBe(1);
    expect(rows[0]).toMatchObject({ imdbId: "tt0816692", rating10: 9, kind: "movie" });
  });

  it("explains a watchlist or an unknown file", () => {
    expect(() => parseExport("Position,Const,Created,Title\n1,tt1,2024,X")).toThrow(/watchlist/);
    expect(() => parseExport("foo,bar\n1,2")).toThrow(ImportFormatError);
  });
});

const item = (id: string, title: string, year: number, extra: Partial<MediaItem> = {}) =>
  ({ id, title, original_title: title, release_year: year, media_type: "movie", vote_count: 100, ...extra }) as MediaItem;

describe("matching", () => {
  const catalog = [
    item("a", "Dune", 2021),
    item("b", "Dune", 1984),
    item("c", "Amélie", 2001, { original_title: "Le Fabuleux Destin d'Amélie Poulain" }),
    item("d", "Dark", 2017, { media_type: "tv" }),
    item("e", "Heat", 1995, { imdb_id: "tt0113277" }),
  ];
  const row = (title: string, year: number | null, extra: Partial<ImportRow> = {}): ImportRow =>
    ({ title, year, rating10: 8, kind: "movie", ...extra });

  it("matches by IMDb id before title", () => {
    const r = matchRows([row("Something Else", 1990, { imdbId: "tt0113277" })], catalog);
    expect(r.matched[0].item.id).toBe("e");
  });

  it("uses the year to tell remakes apart, allowing a year of slack", () => {
    const r = matchRows([row("Dune", 2022), row("Dune", 1984), row("Dune", 2000)], catalog);
    expect(r.matched.map((m) => m.item.id)).toEqual(["a", "b"]);
    expect(r.unmatched.map((u) => u.year)).toEqual([2000]);
  });

  it("ignores accents and matches original titles", () => {
    expect(matchRows([row("amelie", 2001)], catalog).matched[0].item.id).toBe("c");
    expect(matchRows([row("Le fabuleux destin d’Amélie Poulain", 2001)], catalog).matched[0].item.id).toBe("c");
  });

  it("won't match a film row to a series", () => {
    expect(matchRows([row("Dark", 2017)], catalog).matched).toHaveLength(0);
    expect(matchRows([row("Dark", 2017, { kind: "tv" })], catalog).matched).toHaveLength(1);
  });

  it("folds a rewatch into one match", () => {
    const r = matchRows([row("Heat", 1995), row("Heat", 1995)], catalog);
    expect(r.matched).toHaveLength(1);
    expect(r.unmatched).toHaveLength(0);
  });
});

describe("plan", () => {
  const m = (id: string, rating10: number | null) => ({ row: { title: id, year: 2000, rating10, kind: null }, item: item(id, id, 2000) });

  it("maps ratings to favourites, not-for-me and seen", () => {
    const plan = planImport([m("loved", 10), m("liked", 8), m("meh", 6), m("bad", 4), m("unrated", null)]);
    expect(plan.favourites.map((x) => x.id)).toEqual(["liked", "loved"]);
    expect(plan.notInterested.map((x) => x.id)).toEqual(["bad"]);
    expect(plan.seen.map((x) => x.id)).toEqual(["loved", "liked", "meh", "unrated"]);
  });

  it("caps favourites, keeping the highest rated", () => {
    const many = Array.from({ length: 80 }, (_, i) => m(`t${i}`, i < 10 ? 10 : 8));
    const plan = planImport(many);
    expect(plan.favourites).toHaveLength(MAX_IMPORTED_FAVOURITES);
    expect(plan.favourites.slice(-10).every((x) => Number(x.id.slice(1)) < 10)).toBe(true);
  });

  it("doesn't overrule a verdict given by hand", () => {
    useLibraryStore.setState({ seen: ["x"], notInterested: ["y"], watchlist: [] });
    useTasteStore.setState({ favouriteIds: [] });
    applyImport({ favourites: [item("f", "f", 2000)], notInterested: [item("x", "x", 2000)], seen: [item("y", "y", 2000), item("z", "z", 2000)] });
    const lib = useLibraryStore.getState();
    expect(lib.seen.sort()).toEqual(["x", "z"]);
    expect(lib.notInterested).toEqual(["y"]);
    expect(useTasteStore.getState().favouriteIds).toEqual(["f"]);
  });
});

describe("Import page", () => {
  beforeEach(() => {
    setCatalogForTests(null);
    servePack();
    useLibraryStore.setState({ seen: [], notInterested: [], watchlist: [] });
    useTasteStore.setState({ favouriteIds: [] });
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/import"]}>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("previews a Letterboxd export against the real catalog, then saves it", async () => {
    const user = userEvent.setup();
    renderPage();
    const file = new File([LETTERBOXD], "ratings.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/choose a csv file/i), file);
    await screen.findByText(/titles from letterboxd are/i);
    // Interstellar, The Godfather, Spider-Man and Shawshank (1994 vs 1995) are in the catalog.
    expect(screen.getByText(/titles from letterboxd/i).textContent).toMatch(/4 of 5/);
    await user.click(screen.getByRole("button", { name: /show the 1 we couldn/i }));
    expect(screen.getByText("Some Film, With a Comma (2019)")).toBeInTheDocument();
    expect(useTasteStore.getState().favouriteIds).toEqual([]);

    await user.click(screen.getByRole("button", { name: /import 4 titles/i }));
    await waitFor(() => expect(useTasteStore.getState().favouriteIds).toEqual(["tmdb_238", "tmdb_157336"]));
    expect(useLibraryStore.getState().notInterested).toEqual(["tmdb_557"]);
    expect(screen.getByRole("link", { name: /get a pick/i })).toBeInTheDocument();
  });

  it("shows a readable error for the wrong file", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.upload(screen.getByLabelText(/choose a csv file/i), new File(["a,b\n1,2"], "x.csv", { type: "text/csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t read that file/i);
  });
});
