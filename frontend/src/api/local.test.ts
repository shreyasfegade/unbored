/** The catalog-backed API functions, against the real pack. */
import { beforeEach, describe, expect, it } from "vitest";
import { servePack } from "../test/servePack";
import { setCatalogForTests } from "../engine/pack";
import { getBrowseDeck, getBrowseShelf, getBrowseShelves } from "./browse";
import { getCatalogItem, getCatalogItems } from "./media";
import { searchMulti } from "./search";
import { fetchCuratedShortlist, fetchTasteProfile } from "./taste";
import type { ApiError } from "./client";

beforeEach(() => {
  setCatalogForTests(null);
  servePack();
});

describe("browse", () => {
  it("lists shelves and pages through one without repeats", async () => {
    const { data } = await getBrowseShelves();
    expect(data.shelves.length).toBeGreaterThan(3);
    const key = data.shelves[0].key;
    const first = (await getBrowseShelf(key, { offset: 0, limit: 10 })).data;
    const second = (await getBrowseShelf(key, { offset: 10, limit: 10 })).data;
    expect(first.items).toHaveLength(10);
    expect(first.next_offset).toBe(10);
    const ids = new Set([...first.items, ...second.items].map((m) => m.id));
    expect(ids.size).toBe(first.items.length + second.items.length);
  });

  it("filters by media type and drops empty rows", async () => {
    const { data } = await getBrowseShelves("anime");
    for (const s of data.shelves) expect(s.count).toBeGreaterThan(0);
    const page = (await getBrowseShelf(data.shelves[0].key, { mediaType: "anime" })).data;
    expect(page.items.every((m) => m.media_type === "anime")).toBe(true);
  });

  it("deals a deck with no repeats and no excluded titles", async () => {
    const first = (await getBrowseDeck({ limit: 30 })).data.items;
    const exclude = first.slice(0, 10).map((m) => m.id);
    const deck = (await getBrowseDeck({ limit: 30, exclude })).data.items;
    expect(new Set(deck.map((m) => m.id)).size).toBe(deck.length);
    expect(deck.some((m) => exclude.includes(m.id))).toBe(false);
  });

  it("strips engine-only fields from what it returns", async () => {
    const { data } = await getBrowseDeck({ limit: 1 });
    expect(data.items[0]).not.toHaveProperty("tone");
    expect(data.items[0]).not.toHaveProperty("quality");
  });
});

describe("media + search + taste", () => {
  it("resolves ids and 404s unknown ones", async () => {
    const { data } = await fetchCuratedShortlist();
    const id = data.items[0].id;
    expect((await getCatalogItem(id)).data.id).toBe(id);
    expect((await getCatalogItems([id, "nope"])).data.items.map((m) => m.id)).toEqual([id]);
    await expect(getCatalogItem("nope")).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<ApiError>);
  });

  it("searches with typo tolerance", async () => {
    const { data } = await searchMulti("interstelar");
    expect(data.results[0]?.title).toMatch(/Interstellar/);
  });

  it("summarises taste", async () => {
    const { data } = await fetchCuratedShortlist();
    const profile = (await fetchTasteProfile(data.items.slice(0, 5).map((m) => m.id))).data;
    expect(profile.resolved).toBe(5);
    expect(profile.genres.length).toBeGreaterThan(0);
  });

  it("reports a missing pack as a catalog error", async () => {
    setCatalogForTests(null);
    servePack({ "/data/": () => new Response("gone", { status: 500 }) });
    await expect(getBrowseShelves()).rejects.toMatchObject({ code: "CATALOG" } as Partial<ApiError>);
  });
});
