import { useState, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useUIStore } from "../stores/uiStore";
import { useLlmStore } from "../stores/llmStore";
import { useLibraryStore } from "../stores/libraryStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useToastStore } from "../stores/toastStore";
import { useAuthStore } from "../stores/authStore";
import { downloadProfile, applyProfileSnapshot } from "../utils/profileTransfer";
import type { MediaTypeChoice, EraPreference } from "../types/recommendation";
import type { TimeSlot } from "../types/mood";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import ConnectAI from "../components/llm/ConnectAI";
import styles from "./SettingsPage.module.css";

const MEDIA_OPTS: { key: MediaTypeChoice; label: string }[] = [
  { key: "surprise", label: "Surprise" },
  { key: "movie", label: "Movies" },
  { key: "tv", label: "TV" },
  { key: "anime", label: "Anime" },
];
const ERA_OPTS: { key: EraPreference; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "modern", label: "Modern" },
  { key: "classic", label: "Classic" },
];
const TIME_OPTS: { key: TimeSlot | "none"; label: string }[] = [
  { key: "none", label: "Ask me" },
  { key: "short", label: "< 1 hr" },
  { key: "medium", label: "~ 2 hrs" },
  { key: "long", label: "Evening" },
];

function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.segmented} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`${styles.segment} ${value === o.key ? styles.segmentOn : ""}`}
            onClick={() => onChange(o.key)}
            aria-pressed={value === o.key}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const resetProfile = useTasteStore((s) => s.resetProfile);
  const resetRec = useRecommendationStore((s) => s.reset);
  const resetUI = useUIStore((s) => s.resetSelections);
  const connected = useLlmStore((s) => s.validated);
  const clearLlm = useLlmStore((s) => s.clear);
  const addToast = useToastStore((s) => s.addToast);

  const clearLibrary = useLibraryStore((s) => s.clearLibrary);
  const watchlistCount = useLibraryStore((s) => s.watchlist.length);
  const seenCount = useLibraryStore((s) => s.seen.length);
  const skipCount = useLibraryStore((s) => s.notInterested.length);

  const prefs = usePreferencesStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const accountConfigured = useAuthStore((s) => s.configured);
  const signedIn = useAuthStore((s) => Boolean(s.user));
  const userEmail = useAuthStore((s) => s.user?.email ?? "");

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showLibConfirm, setShowLibConfirm] = useState(false);

  const executeReset = useCallback(() => {
    resetProfile();
    resetRec();
    resetUI();
    clearLlm();
    // Reset everything now genuinely means everything — the library survived
    // this before, which was a bug.
    clearLibrary();
    navigate("/onboarding", { replace: true });
  }, [resetProfile, resetRec, resetUI, clearLlm, clearLibrary, navigate]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const added = applyProfileSnapshot(String(reader.result));
        addToast(added > 0 ? `Imported — ${added} new favourite${added === 1 ? "" : "s"} added.` : "Profile imported.");
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Couldn't read that file.");
      }
    };
    reader.readAsText(file);
  };

  const itemVariant = {
    hidden: { opacity: 0, y: 16 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.1 + i * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] },
    }),
  };
  const section = (i: number) => ({
    variants: itemVariant,
    initial: prefersReduced ? false : ("hidden" as const),
    animate: "visible" as const,
    custom: i,
  });

  return (
    <div className={styles.page}>
      <ConfirmDialog
        open={showResetConfirm}
        title="Reset everything?"
        message="This permanently clears your favourites, taste data, library and recommendations. You'll go through onboarding again."
        confirmLabel="Reset everything"
        cancelLabel="Keep my profile"
        variant="danger"
        onConfirm={executeReset}
        onCancel={() => setShowResetConfirm(false)}
      />
      <ConfirmDialog
        open={showLibConfirm}
        title="Clear your library?"
        message="Removes your watchlist, and forgets what you've marked as seen or not for me. Your taste is untouched."
        confirmLabel="Clear library"
        cancelLabel="Keep it"
        variant="danger"
        onConfirm={() => { clearLibrary(); setShowLibConfirm(false); addToast("Library cleared."); }}
        onCancel={() => setShowLibConfirm(false)}
      />

      <motion.button
        className={styles.back}
        onClick={() => navigate("/")}
        initial={prefersReduced ? false : { opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        ← Back
      </motion.button>

      <motion.h1
        className={styles.heading}
        initial={prefersReduced ? false : { opacity: 0, y: -10, filter: "blur(3px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 0.15, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        Settings
      </motion.h1>

      {/* ── AI ─────────────────────────────────────────────────────── */}
      <motion.div className={`${styles.section} ${styles.aiSection}`} {...section(0)}>
        <span className={styles.sectionLabel}>Your AI</span>
        <p className={styles.aiBlurb}>
          {connected
            ? "AI is choosing and explaining your picks."
            : "Unbored is at its best with AI. Connect your own Gemini or DeepSeek key — it's kept in this browser and sent with each request over HTTPS, never stored on our servers."}
        </p>
        <ConnectAI variant="settings" />
      </motion.div>

      {/* ── Defaults ───────────────────────────────────────────────── */}
      <motion.div className={`${styles.section} ${styles.wide}`} {...section(1)}>
        <span className={styles.sectionLabel}>Defaults for a new pick</span>
        <Segmented label="Type" value={prefs.defaultMediaType} options={MEDIA_OPTS} onChange={prefs.setDefaultMediaType} />
        <Segmented label="Era" value={prefs.defaultEra} options={ERA_OPTS} onChange={prefs.setDefaultEra} />
        <Segmented
          label="Time"
          value={prefs.defaultTimeSlot ?? "none"}
          options={TIME_OPTS}
          onChange={(v) => prefs.setDefaultTimeSlot(v === "none" ? null : (v as TimeSlot))}
        />
      </motion.div>

      {/* ── Appearance & motion ────────────────────────────────────── */}
      <motion.div className={`${styles.section} ${styles.wide}`} {...section(2)}>
        <span className={styles.sectionLabel}>Appearance</span>
        <Segmented
          label="Poster size"
          value={prefs.density}
          options={[{ key: "comfortable", label: "Comfortable" }, { key: "compact", label: "Compact" }]}
          onChange={prefs.setDensity}
        />
        <label className={styles.toggleRow}>
          <span className={styles.fieldLabel}>Reduce motion</span>
          <input
            type="checkbox"
            className={styles.toggle}
            checked={prefs.reduceMotion}
            onChange={(e) => prefs.setReduceMotion(e.target.checked)}
          />
        </label>
        <p className={styles.hint}>Also follows your device setting; this forces it on.</p>
      </motion.div>

      {/* ── Library ────────────────────────────────────────────────── */}
      <motion.div className={`${styles.section} ${styles.wide}`} {...section(3)}>
        <span className={styles.sectionLabel}>Your library</span>
        <p className={styles.hint}>
          {watchlistCount} saved · {seenCount} seen · {skipCount} not for me
        </p>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => setShowLibConfirm(true)}
          disabled={watchlistCount + seenCount + skipCount === 0}
        >
          Clear library
        </button>
      </motion.div>

      {/* ── Move your profile ──────────────────────────────────────── */}
      <motion.div className={`${styles.section} ${styles.wide}`} {...section(4)}>
        <span className={styles.sectionLabel}>Move your profile</span>
        <p className={styles.hint}>Save a copy, or load it on another device. No account needed.</p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.actionBtn} onClick={downloadProfile}>Export</button>
          <button type="button" className={styles.actionBtn} onClick={() => fileRef.current?.click()}>Import</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} hidden />
      </motion.div>

      {/* ── Account ────────────────────────────────────────────────── */}
      {accountConfigured && (
        <motion.div className={`${styles.section} ${styles.wide}`} {...section(5)}>
          <span className={styles.sectionLabel}>Account</span>
          <p className={styles.hint}>
            {signedIn ? `Signed in as ${userEmail}` : "Sign in to sync across devices — optional."}
          </p>
          <button className={styles.actionBtn} onClick={() => navigate("/account")}>
            {signedIn ? "Manage account" : "Sign in"}
          </button>
        </motion.div>
      )}

      {/* ── More ───────────────────────────────────────────────────── */}
      <motion.div className={styles.section} {...section(6)}>
        <button className={styles.actionBtn} onClick={() => navigate("/enrich")}>Add more favourites</button>
        <Link to="/together" className={styles.linkBtn}>Watch together</Link>
      </motion.div>

      <motion.div className={styles.section} {...section(7)}>
        <button className={styles.dangerBtn} onClick={() => setShowResetConfirm(true)}>Reset everything</button>
        <p className={styles.dangerHint}>Clears your taste and library. You'll go through onboarding again.</p>
      </motion.div>

      <motion.p className={styles.version} {...section(8)}>UNBORED v3.0.0</motion.p>
      <motion.p className={styles.attribution} {...section(9)}>
        Movie &amp; TV data from{" "}
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">TMDB</a>;
        anime from{" "}
        <a href="https://anilist.co" target="_blank" rel="noopener noreferrer">AniList</a>.
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </motion.p>
    </div>
  );
}
