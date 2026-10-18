/**
 * The share card: a 1080×1350 PNG of the pick, drawn on a canvas in the
 * browser. Posters come through /api/poster (same origin), because neither
 * poster CDN allows cross-origin canvas reads.
 */
import type { MediaItem } from "../types/media";

export const CARD_W = 1080;
export const CARD_H = 1350;

const BG = "#0c0b09";
const PANEL = "#141310";
const TEXT = "#f6f3ec";
const SECONDARY = "#c4bdab";
const TERTIARY = "#8b8576";
const ACCENT = "#e8b478";
const DISPLAY = '"Playfair Display", Georgia, serif';
const BODY = 'Inter, -apple-system, "Segoe UI", sans-serif';

export class ShareCardError extends Error {}

/** Greedy word wrap to at most `maxLines`, ellipsising the last line. */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      // Out of room: ellipsise the last line we kept.
      let last = lines[maxLines - 1];
      while (last && measure(`${last}…`) > maxWidth) last = last.replace(/\s*\S+$/, "");
      lines[maxLines - 1] = `${last}…`;
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const posterProxyUrl = (src: string) => `/api/poster?src=${encodeURIComponent(src.replace("/w500/", "/w780/"))}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 6000);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface CardInput {
  media: MediaItem;
  reason: string | null;
  url: string;
}

export async function drawShareCard({ media, reason, url }: CardInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ShareCardError("canvas unavailable");

  try {
    await Promise.all([
      document.fonts?.load(`600 64px ${DISPLAY}`),
      document.fonts?.load(`400 30px ${BODY}`),
      document.fonts?.load(`italic 400 34px ${BODY}`),
    ]);
  } catch {
    /* fall back to system fonts */
  }
  const poster = media.poster_path ? await loadImage(posterProxyUrl(media.poster_path)) : null;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const pad = 80;
  let y = pad;

  // Kicker.
  ctx.fillStyle = ACCENT;
  ctx.font = `600 24px ${BODY}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("TONIGHT’S PICK", pad, y + 24);
  ctx.letterSpacing = "0px";
  y += 64;

  // Poster on the left, title block on the right.
  const pw = 360;
  const ph = 540;
  ctx.save();
  roundRect(ctx, pad, y, pw, ph, 20);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.clip();
  if (poster) {
    // Cover-fit.
    const scale = Math.max(pw / poster.width, ph / poster.height);
    const w = poster.width * scale;
    const h = poster.height * scale;
    ctx.drawImage(poster, pad + (pw - w) / 2, y + (ph - h) / 2, w, h);
  } else {
    ctx.fillStyle = TERTIARY;
    ctx.font = `600 120px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText(media.title.charAt(0).toUpperCase(), pad + pw / 2, y + ph / 2 + 40);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  roundRect(ctx, pad, y, pw, ph, 20);
  ctx.stroke();

  const tx = pad + pw + 56;
  const tw = CARD_W - pad - tx;
  let ty = y + 8;
  ctx.fillStyle = TEXT;
  ctx.font = `600 64px ${DISPLAY}`;
  for (const line of wrapText(media.title, tw, 4, (s) => ctx.measureText(s).width)) {
    ty += 72;
    ctx.fillText(line, tx, ty);
  }
  ty += 52;
  ctx.fillStyle = SECONDARY;
  ctx.font = `400 30px ${BODY}`;
  const kind = { movie: "Film", tv: "Series", anime: "Anime" }[media.media_type];
  const meta = [media.release_year, kind, media.runtime_minutes ? `${media.runtime_minutes} min` : null].filter(Boolean).join("  ·  ");
  ctx.fillText(meta, tx, ty);
  ty += 48;
  ctx.fillStyle = TERTIARY;
  ctx.font = `400 26px ${BODY}`;
  for (const line of wrapText(media.genres.slice(0, 3).join(", "), tw, 2, (s) => ctx.measureText(s).width)) {
    ctx.fillText(line, tx, ty);
    ty += 36;
  }

  // The reason, in the app's italic voice, centred in the space left above
  // the footer.
  y += ph;
  if (reason) {
    ctx.font = `italic 400 36px ${BODY}`;
    const lines = wrapText(reason, CARD_W - pad * 2 - 36, 6, (s) => ctx.measureText(s).width);
    const room = CARD_H - pad - 60 - y;
    y += Math.max(64, (room - lines.length * 52) / 2);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pad, y + 8, 4, lines.length * 52 - 8);
    ctx.fillStyle = SECONDARY;
    for (const line of lines) {
      y += 52;
      ctx.fillText(line, pad + 36, y - 12);
    }
  }

  // Footer.
  ctx.fillStyle = TEXT;
  ctx.font = `700 34px ${BODY}`;
  ctx.letterSpacing = "10px";
  ctx.fillText("UNBORED", pad, CARD_H - pad);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = TERTIARY;
  ctx.font = `400 24px ${BODY}`;
  ctx.textAlign = "right";
  ctx.fillText(url.replace(/^https?:\/\//, ""), CARD_W - pad, CARD_H - pad);
  ctx.textAlign = "left";

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new ShareCardError("couldn't encode the card");
  return blob;
}

export type ShareOutcome = "shared-image" | "shared-link" | "copied" | "cancelled" | "failed";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pick";

/** Share the card as an image where the device can, else the link. */
export async function sharePick(input: CardInput): Promise<ShareOutcome> {
  const text = `Tonight's pick: ${input.media.title}`;
  try {
    if (navigator.canShare) {
      const blob = await drawShareCard(input).catch(() => null);
      const file = blob && new File([blob], `unbored-${slug(input.media.title)}.png`, { type: "image/png" });
      if (file && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: text, text: `${text} ${input.url}` });
        return "shared-image";
      }
    }
    if (navigator.share) {
      await navigator.share({ url: input.url, title: text });
      return "shared-link";
    }
    await navigator.clipboard.writeText(input.url);
    return "copied";
  } catch (err) {
    return (err as Error)?.name === "AbortError" ? "cancelled" : "failed";
  }
}

/** Save the card as a PNG file. */
export async function downloadCard(input: CardInput): Promise<boolean> {
  try {
    const blob = await drawShareCard(input);
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `unbored-${slug(input.media.title)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return true;
  } catch {
    return false;
  }
}
