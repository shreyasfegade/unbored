// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedPoster, poster } from "./poster";

const TMDB = "https://image.tmdb.org/t/p/w500/tV712n7bMaRuaKyltFl65HPNRiP.jpg";
const call = (src: string) => poster(new Request(`http://x/api/poster?src=${encodeURIComponent(src)}`));

afterEach(() => vi.unstubAllGlobals());

describe("poster proxy", () => {
  it("accepts only catalog poster URLs", () => {
    expect(allowedPoster(TMDB)).toBe(true);
    expect(allowedPoster("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg")).toBe(true);
    for (const bad of [
      "https://image.tmdb.org/t/p/original/x.jpg",
      "https://image.tmdb.org/t/p/w500/../../x.jpg",
      "https://image.tmdb.org.evil.com/t/p/w500/x.jpg",
      "http://image.tmdb.org/t/p/w500/x.jpg",
      "https://example.com/x.jpg",
    ]) expect(allowedPoster(bad)).toBe(false);
  });

  it("refuses anything else without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call("https://example.com/a.jpg")).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the image through with long caching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })));
    const res = await call(TMDB);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("won't relay a non-image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    expect((await call(TMDB)).status).toBe(502);
  });
});
