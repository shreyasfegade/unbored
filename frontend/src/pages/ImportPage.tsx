import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { loadCatalog } from "../engine/pack";
import { toMedia } from "../api/catalog";
import { describeApiError, toApiError } from "../api/client";
import { ImportFormatError, parseExport, type ImportSource } from "../import/formats";
import { matchRows, type MatchResult } from "../import/match";
import { planImport, type ImportPlan } from "../import/plan";
import { applyImport } from "../import/apply";
import { useTasteStore } from "../stores/tasteStore";
import type { MediaItem } from "../types/media";
import styles from "./ImportPage.module.css";

type State =
  | { phase: "idle" }
  | { phase: "reading"; name: string }
  | { phase: "error"; message: string }
  | { phase: "preview"; name: string; source: ImportSource; total: number; skipped: number; catalogSize: number; result: MatchResult; plan: ImportPlan }
  | { phase: "done"; plan: ImportPlan };

const SOURCE_NAME: Record<ImportSource, string> = { letterboxd: "Letterboxd", imdb: "IMDb" };
const MAX_BYTES = 10 * 1024 * 1024;

/** File.text() where it exists; FileReader for older browsers. */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.readAsText(file);
  });
}

function Posters({ items }: { items: MediaItem[] }) {
  const shown = items.filter((m) => m.poster_path).slice(-6).reverse();
  if (!shown.length) return null;
  return (
    <div className={styles.posters} aria-hidden="true">
      {shown.map((m) => <img key={m.id} src={m.poster_path!} alt="" loading="lazy" />)}
    </div>
  );
}

export default function ImportPage() {
  const [params] = useSearchParams();
  const fromOnboarding = params.get("from") === "onboarding";
  const navigate = useNavigate();
  const completeOnboarding = useTasteStore((s) => s.completeOnboarding);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setState({ phase: "error", message: "That file is over 10 MB, which is bigger than any ratings export we know of." });
      return;
    }
    setState({ phase: "reading", name: file.name });
    try {
      const parsed = parseExport(await readText(file));
      if (!parsed.rows.length) {
        setState({ phase: "error", message: "That file has no titles in it." });
        return;
      }
      const catalog = await loadCatalog();
      const result = matchRows(parsed.rows, catalog.cards.map(toMedia));
      setState({
        phase: "preview",
        name: file.name,
        source: parsed.source,
        total: parsed.rows.length,
        skipped: parsed.skipped,
        catalogSize: catalog.cards.length,
        result,
        plan: planImport(result.matched),
      });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof ImportFormatError ? err.message : describeApiError(toApiError(err)),
      });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void read(file);
  };

  const commit = (plan: ImportPlan) => {
    applyImport(plan);
    if (fromOnboarding && plan.favourites.length) {
      completeOnboarding();
      navigate("/", { replace: true });
      return;
    }
    setState({ phase: "done", plan });
  };

  const reset = () => {
    setShowUnmatched(false);
    setState({ phase: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className={styles.page}>
      <span className={styles.kicker}>Bring your history</span>
      <h1 className={styles.heading}>Import your ratings</h1>
      <p className={styles.copy}>
        Start from what you&rsquo;ve already rated on Letterboxd or IMDb. The file is read on this
        device and never uploaded.
      </p>

      {(state.phase === "idle" || state.phase === "error" || state.phase === "reading") && (
        <>
          <label
            className={`${styles.drop} ${dragging ? styles.dropActive : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className={styles.file}
              disabled={state.phase === "reading"}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            />
            {state.phase === "reading" ? (
              <span className={styles.dropTitle}>Matching {state.name}&hellip;</span>
            ) : (
              <>
                <span className={styles.dropTitle}>Choose a CSV file</span>
                <span className={styles.dropHint}>or drop it here</span>
              </>
            )}
          </label>

          {state.phase === "error" && <p className={styles.error} role="alert">{state.message}</p>}

          <div className={styles.howto}>
            <div>
              <h2>Letterboxd</h2>
              <p>Settings → Import &amp; Export → Export your data. Unzip it and pick <code>ratings.csv</code>.</p>
            </div>
            <div>
              <h2>IMDb</h2>
              <p>Your ratings → the &ldquo;&#8943;&rdquo; menu → Export. Pick the downloaded CSV.</p>
            </div>
          </div>
        </>
      )}

      {state.phase === "preview" && (
        <section className={styles.preview} aria-label="Import preview">
          <p className={styles.summary}>
            <strong>{state.result.matched.length}</strong> of {state.total} titles from {SOURCE_NAME[state.source]} are
            in Unbored&rsquo;s catalog of {state.catalogSize.toLocaleString()}.
          </p>
          <Posters items={state.plan.favourites} />
          <ul className={styles.counts}>
            <li><strong>{state.plan.favourites.length}</strong> become favourites <span>rated 4★+ or 8/10+</span></li>
            <li><strong>{state.plan.notInterested.length}</strong> marked not for me <span>rated 2★ or 4/10 and under</span></li>
            <li><strong>{state.plan.seen.length}</strong> marked seen <span>never suggested again</span></li>
          </ul>
          {state.result.unmatched.length > 0 && (
            <div className={styles.unmatched}>
              <button className={styles.link} onClick={() => setShowUnmatched((v) => !v)} aria-expanded={showUnmatched}>
                {showUnmatched ? "Hide" : "Show"} the {state.result.unmatched.length} we couldn&rsquo;t match
              </button>
              {showUnmatched && (
                <ul>
                  {state.result.unmatched.slice(0, 50).map((r, i) => (
                    <li key={`${r.title}-${i}`}>{r.title}{r.year ? ` (${r.year})` : ""}</li>
                  ))}
                  {state.result.unmatched.length > 50 && <li>&hellip;and {state.result.unmatched.length - 50} more</li>}
                </ul>
              )}
            </div>
          )}
          {state.skipped > 0 && <p className={styles.note}>{state.skipped} single episodes or games were skipped.</p>}
          {state.result.matched.length === 0 ? (
            <p className={styles.note}>Nothing to import from this file. Try another export.</p>
          ) : null}
          <div className={styles.actions}>
            <button className={styles.primary} onClick={() => commit(state.plan)} disabled={!state.result.matched.length}>
              Import {state.result.matched.length} titles
            </button>
            <button className={styles.secondary} onClick={reset}>Choose another file</button>
          </div>
        </section>
      )}

      {state.phase === "done" && (
        <section className={styles.preview} aria-live="polite">
          <p className={styles.summary}>
            Imported. {state.plan.favourites.length} favourites added, and {state.plan.seen.length + state.plan.notInterested.length} titles
            won&rsquo;t be suggested again.
          </p>
          <div className={styles.actions}>
            <Link to="/" className={styles.primary}>Get a pick</Link>
            <Link to="/taste" className={styles.secondary}>See your taste</Link>
          </div>
        </section>
      )}

      {fromOnboarding && state.phase !== "done" && (
        <Link to="/onboarding" className={styles.back}>Pick favourites by hand instead</Link>
      )}
    </div>
  );
}
