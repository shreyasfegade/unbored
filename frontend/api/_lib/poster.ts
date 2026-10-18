/**
 * Same-origin copies of catalog posters, for the share card. Neither poster
 * CDN sends CORS headers, and a cross-origin image drawn on a canvas makes it
 * impossible to export. Only the two poster URL shapes the catalog uses are
 * accepted, so this can't be used to fetch anything else.
 */
const ALLOWED: RegExp[] = [
  /^https:\/\/image\.tmdb\.org\/t\/p\/w(?:342|500|780)\/[A-Za-z0-9]+\.(?:jpg|png)$/,
  /^https:\/\/s4\.anilist\.co\/file\/anilistcdn\/media\/anime\/cover\/(?:medium|large|extraLarge)\/[A-Za-z0-9-]+\.(?:jpg|png)$/,
];

const MAX_BYTES = 2_000_000;

export const allowedPoster = (src: string | null): src is string => !!src && ALLOWED.some((re) => re.test(src));

export async function poster(req: Request): Promise<Response> {
  const src = new URL(req.url).searchParams.get("src");
  if (!allowedPoster(src)) return new Response("Not a catalog poster.", { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(src, { signal: AbortSignal.timeout(6000) });
  } catch {
    return new Response("Poster unavailable.", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !/^image\/(jpeg|png)$/.test(type)) return new Response("Poster unavailable.", { status: 502 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Poster too large.", { status: 502 });
  return new Response(body, {
    headers: {
      "Content-Type": type,
      // Poster files never change at a given path.
      "Cache-Control": "public, max-age=604800, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
