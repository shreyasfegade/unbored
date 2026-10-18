import { useEffect, useId, useState } from "react";
import { searchMulti } from "../../api/search";
import { engine } from "../../engine/client";
import type { ExplainResult } from "../../engine/host";
import type { MediaItem } from "../../types/media";
import type { RecommendationRequest, ScoredMediaItem } from "../../types/recommendation";
import { SIGNALS, compare } from "./compare";
import styles from "./WhyNot.module.css";

const TYPE_LABEL: Record<string, string> = { movie: "Film", tv: "Series", anime: "Anime" };

type State =
  | { phase: "closed" }
  | { phase: "search" }
  | { phase: "scoring"; target: MediaItem }
  | { phase: "result"; target: MediaItem; result: ExplainResult }
  | { phase: "error"; target: MediaItem };

/**
 * "Why not X?": name any title and see how the engine scored it against the
 * pick for this same request, signal by signal. Runs the real engine in the
 * worker, so the numbers are the ones the pick was chosen with. Mount it with
 * key={pick id} so a new pick starts it fresh.
 */
export function WhyNot({ pick, request, pickedByAi }: { pick: ScoredMediaItem; request: RecommendationRequest; pickedByAi: boolean }) {
  const [state, setState] = useState<State>({ phase: "closed" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const inputId = useId();

  useEffect(() => {
    if (state.phase !== "search") return;
    let live = true;
    const t = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      searchMulti(query)
        .then(({ data }) => live && setResults(data.results.filter((m) => m.id !== pick.media.id).slice(0, 5)))
        .catch(() => live && setResults([]));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, state.phase, pick.media.id]);

  const score = async (target: MediaItem) => {
    setState({ phase: "scoring", target });
    try {
      const result = await engine.explain(request, target.id);
      setState({ phase: "result", target, result });
    } catch {
      setState({ phase: "error", target });
    }
  };

  if (state.phase === "closed") {
    return (
      <button className={styles.open} onClick={() => setState({ phase: "search" })}>
        Why this and not something else?
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="Compare another title">
      {state.phase === "search" && (
        <>
          <label className={styles.label} htmlFor={inputId}>Name a title you expected instead</label>
          <input
            id={inputId}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Interstellar"
            autoComplete="off"
            autoFocus
          />
          {results.length > 0 ? (
            <ul className={styles.results}>
              {results.map((m) => (
                <li key={m.id}>
                  <button className={styles.result} onClick={() => score(m)}>
                    <span>{m.title}</span>
                    <span className={styles.resultMeta}>{[m.release_year, TYPE_LABEL[m.media_type]].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <p className={styles.muted}>Nothing in the catalog by that name.</p>
          ) : null}
          <button className={styles.link} onClick={() => setState({ phase: "closed" })}>Close</button>
        </>
      )}

      {state.phase === "scoring" && <p className={styles.muted} aria-live="polite">Scoring {state.target.title}&hellip;</p>}

      {state.phase === "error" && (
        <>
          <p className={styles.muted} role="alert">Couldn&rsquo;t score {state.target.title}. Try again in a moment.</p>
          <button className={styles.link} onClick={() => score(state.target)}>Retry</button>
        </>
      )}

      {state.phase === "result" && (() => {
        const other = state.result.scored;
        const cmp = compare(pick, other, state.target.title, pickedByAi);
        return (
          <>
            <h3 className={styles.heading}>{state.target.title} vs {pick.media.title}</h3>
            <p className={styles.rank}>
              {state.result.retrieved
                ? `Ranked #${state.result.rank} of ${state.result.total} for this request.`
                : `Didn't reach the ${state.result.total} titles the engine compares closely; scored on its own it would sit around #${state.result.rank}.`}
            </p>
            <p className={styles.sentence}>{cmp.sentence}</p>
            <dl className={styles.bars}>
              {SIGNALS.map(({ key, label }) => (
                <div key={key} className={styles.bar}>
                  <dt>{label}</dt>
                  <dd>
                    <span className={styles.track} title={`${pick.media.title}: ${Math.round(pick.score_breakdown[key] * 100)}`}>
                      <span className={styles.fillPick} style={{ width: `${pick.score_breakdown[key] * 100}%` }} />
                    </span>
                    <span className={styles.track} title={`${state.target.title}: ${Math.round(other.score_breakdown[key] * 100)}`}>
                      <span className={styles.fillOther} style={{ width: `${other.score_breakdown[key] * 100}%` }} />
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className={styles.legend}>
              <span className={styles.keyPick} aria-hidden="true" /> {pick.media.title}
              <span className={styles.keyOther} aria-hidden="true" /> {state.target.title}
            </p>
            <div className={styles.row}>
              <button className={styles.link} onClick={() => { setQuery(""); setState({ phase: "search" }); }}>Try another</button>
              <button className={styles.link} onClick={() => setState({ phase: "closed" })}>Close</button>
            </div>
          </>
        );
      })()}
    </section>
  );
}
