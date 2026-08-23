/** Encode a taste (a list of catalog ids) into a URL-safe code, and back.
 *
 * The API is stateless, so a "watch together" session doesn't need a server
 * record — the invite link can simply carry the host's taste. Ids look like
 * `tmdb_27205` / `al_16498`, so the prefixes collapse to a single character and
 * the rest is base64url, keeping a 20-title link comfortably short.
 */

const PREFIX_TO_CODE: Record<string, string> = { tmdb_: 't', al_: 'a' };
const CODE_TO_PREFIX: Record<string, string> = { t: 'tmdb_', a: 'al_' };

function toB64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function encodeTaste(ids: string[]): string {
  const compact = ids
    .map((id) => {
      for (const [prefix, code] of Object.entries(PREFIX_TO_CODE)) {
        if (id.startsWith(prefix)) return code + id.slice(prefix.length);
      }
      return id; // unknown shape — carry it through untouched
    })
    .join('.');
  return toB64Url(compact);
}

export function decodeTaste(code: string): string[] {
  try {
    return fromB64Url(code)
      .split('.')
      .filter(Boolean)
      .map((part) => {
        const prefix = CODE_TO_PREFIX[part[0]];
        return prefix ? prefix + part.slice(1) : part;
      });
  } catch {
    return []; // a mangled link should show "invalid invite", not crash
  }
}
