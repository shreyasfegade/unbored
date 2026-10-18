/**
 * Python's `round(x, n)`: correctly rounded on the exact binary value, ties to
 * even. `Math.round(x * 10**n)` rounds the *scaled* float (0.04375 * 1e4 is
 * exactly 437.5 even though 0.04375 is stored just below it) and breaks ties
 * upward; either can flip a ranking against the reference engine.
 *
 * `toFixed` rounds the exact value (ties upward), and with enough digits it
 * prints the exact expansion, which is how a true tie is spotted.
 */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(Math.min(100, digits + 60));
  const tail = exact.split(".")[1]?.slice(digits) ?? "";
  if (/^50*$/.test(tail)) {
    const scale = 10 ** digits;
    const lo = Math.floor(Math.abs(x) * scale);
    const even = lo % 2 === 0 ? lo : lo + 1;
    return (Math.sign(x) * even) / scale;
  }
  return Number(x.toFixed(digits));
}
