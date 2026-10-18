/**
 * Loading the data pack (scripts/build_web_pack.py → public/data/).
 *
 * `manifest.json` is always revalidated; the files it names carry a content
 * hash in their name, so they're cached forever and checked against that hash
 * on arrival. Every caller shares one in-flight load.
 */
import type { Card, CardsDoc, PackManifest, ShelvesDoc } from "./types";

export class PackError extends Error {
  readonly kind: "network" | "corrupt";
  constructor(kind: "network" | "corrupt", message: string) {
    super(message);
    this.name = "PackError";
    this.kind = kind;
  }
}

export interface Catalog {
  manifest: PackManifest;
  cards: Card[];
  byId: Map<string, Card>;
  shelves: ShelvesDoc;
  attribution: string | null;
}

const BASE = `${import.meta.env?.BASE_URL ?? "/"}data/`;

async function fetchBytes(name: string, init?: RequestInit): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(BASE + name, init);
  } catch {
    throw new PackError("network", "Couldn't download the catalog.");
  }
  if (!res.ok) throw new PackError("network", `Catalog file ${name} returned ${res.status}.`);
  return res.arrayBuffer();
}

/** The 12-hex hash build_web_pack.py put in the file name, if any. */
function expectedHash(name: string): string | null {
  const m = /\.([0-9a-f]{12})\.[a-z]+$/.exec(name);
  return m ? m[1] : null;
}

async function verified(name: string): Promise<ArrayBuffer> {
  const buf = await fetchBytes(name);
  const want = expectedHash(name);
  const subtle = globalThis.crypto?.subtle;
  if (want && subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", buf));
    const got = Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
    if (got !== want) throw new PackError("corrupt", `Catalog file ${name} failed its integrity check.`);
  }
  return buf;
}

const decodeJson = <T>(buf: ArrayBuffer): T => JSON.parse(new TextDecoder().decode(buf)) as T;

export async function fetchManifest(): Promise<PackManifest> {
  const buf = await fetchBytes("manifest.json", { cache: "no-cache" });
  try {
    return decodeJson<PackManifest>(buf);
  } catch {
    throw new PackError("corrupt", "The catalog manifest is unreadable.");
  }
}

export function catalogFrom(manifest: PackManifest, cardsDoc: CardsDoc, shelves: ShelvesDoc): Catalog {
  const byId = new Map(cardsDoc.items.map((c) => [c.id, c] as const));
  return { manifest, cards: cardsDoc.items, byId, shelves, attribution: cardsDoc.attribution };
}

export async function fetchCatalog(manifest: PackManifest): Promise<Catalog> {
  const [cardsBuf, shelvesBuf] = await Promise.all([
    verified(manifest.files.cards),
    verified(manifest.files.shelves),
  ]);
  return catalogFrom(manifest, decodeJson<CardsDoc>(cardsBuf), decodeJson<ShelvesDoc>(shelvesBuf));
}

export function fetchEngineBin(manifest: PackManifest): Promise<ArrayBuffer> {
  return verified(manifest.files.engine);
}

let catalogPromise: Promise<Catalog> | null = null;

/** The catalog for the main thread (display, search, browse). Retries after a
 *  failure instead of caching the rejection. */
export function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = fetchManifest()
      .then(fetchCatalog)
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

/** Test seam: serve a prebuilt catalog instead of fetching. */
export function setCatalogForTests(catalog: Catalog | null): void {
  catalogPromise = catalog ? Promise.resolve(catalog) : null;
}
