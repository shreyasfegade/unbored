import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { getRecommendation } from "../api/recommend";
import { describeApiError } from "../api/client";
import { getCatalogItem } from "../api/media";
import { decodeTaste, encodeTaste } from "../utils/tasteLink";
import { sizedPoster } from "../utils/poster";
import PosterArt from "../components/poster/PosterArt";
import { MOOD_DISPLAY_LABELS, MOOD_EMOJIS, type MoodType, type TimeSlot } from "../types/mood";
import type { MediaItem } from "../types/media";
import type { RecommendationResponse } from "../types/recommendation";
import styles from "./TogetherPage.module.css";

const MOODS = Object.keys(MOOD_DISPLAY_LABELS) as MoodType[];
const SLOTS: { key: TimeSlot; label: string }[] = [
  { key: "short", label: "< 1 hr" },
  { key: "medium", label: "~ 2 hrs" },
  { key: "long", label: "All evening" },
];

export default function TogetherPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const myIds = useTasteStore((s) => s.favouriteIds);

  const theirIds = useMemo(() => (code ? decodeTaste(code) : []), [code]);
  const isGuest = Boolean(code);

  const [mood, setMood] = useState<MoodType>("thrilled");
  const [slot, setSlot] = useState<TimeSlot>("medium");
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [theirTitles, setTheirTitles] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show whose taste is in the room, so the pick reads as a real compromise.
  useEffect(() => {
    let cancelled = false;
    if (!theirIds.length) return;
    Promise.all(
      theirIds.slice(0, 6).map((id) => getCatalogItem(id).then((r) => r.data).catch(() => null)),
    ).then((items) => {
      if (!cancelled) setTheirTitles(items.filter((i): i is MediaItem => i !== null));
    });
    return () => { cancelled = true; };
  }, [theirIds]);

  const shareLink = useMemo(
    () => `${window.location.origin}/together/${encodeTaste(myIds)}`,
    [myIds],
  );

  const handleInvite = async () => {
    try {
      if (navigator.share) await navigator.share({ url: shareLink, title: "Let's watch something" });
      else {
        await navigator.clipboard.writeText(shareLink);
        addToast("Invite copied — send it to whoever you're watching with.");
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const findPick = async () => {
    setLoading(true);
    setError(null);
    try {
      // Both tastes go in as one profile: the engine's centroid then sits
      // between them, which is exactly the compromise we want.
      const merged = Array.from(new Set([...theirIds, ...myIds]));
      const res = await getRecommendation({
        favourite_ids: merged,
        excluded_ids: [],
        mood,
        time_available: slot,
        time_of_day: "evening",
        media_type: "surprise",
        era: "any",
      });
      setResult(res.data);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const combined = new Set([...theirIds, ...myIds]).size;
  const pick = result?.primary.media;

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate("/")}>← Back</button>

      <motion.h1
        className={styles.heading}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Watch together
      </motion.h1>

      {!isGuest ? (
        <>
          <p className={styles.subtitle}>
            Can&rsquo;t agree on something? Send a link to whoever you&rsquo;re watching with.
            They add what they love, we blend it with your taste, and you get one pick
            that suits you both.
          </p>

          <ol className={styles.steps}>
            <li><span>1</span> Send them your link</li>
            <li><span>2</span> They add a few favourites</li>
            <li><span>3</span> You both get one pick</li>
          </ol>

          <p className={styles.meta}>
            {myIds.length > 0
              ? `Your taste: ${myIds.length} titles`
              : "You haven't added any favourites yet — the pick will lean on theirs."}
          </p>
          <button className={styles.primary} onClick={handleInvite}>
            Copy invite link
          </button>
          <p className={styles.hint}>No account needed, for either of you.</p>
          {myIds.length === 0 && (
            <Link to="/browse" className={styles.secondaryLink}>
              Add your favourites first →
            </Link>
          )}
        </>
      ) : theirIds.length === 0 ? (
        <div className={styles.empty}>
          <p>That invite link doesn&rsquo;t look right.</p>
          <Link to="/together" className={styles.cta}>Start your own</Link>
        </div>
      ) : (
        <>
          <p className={styles.subtitle}>
            Someone wants to watch with you. Below is what they love — add anything
            you love too, pick a mood, and we&rsquo;ll find one thing that suits you
            both. Nothing is saved and neither of you needs an account.
          </p>

          {theirTitles.length > 0 && (
            <div className={styles.tasteRow}>
              {theirTitles.map((t) => (
                <span key={t.id} className={styles.chip}>{t.title}</span>
              ))}
            </div>
          )}

          <div className={styles.balance}>
            <span>{theirIds.length} theirs</span>
            <span className={styles.plus}>+</span>
            <span>{myIds.length} yours</span>
            <span className={styles.plus}>=</span>
            <span className={styles.total}>{combined} titles</span>
          </div>

          {myIds.length === 0 && (
            <p className={styles.warn}>
              You haven&rsquo;t added anything yet, so this would just be their taste.
              <Link to="/browse"> Add a few favourites</Link> to make it a real compromise.
            </p>
          )}

          <fieldset className={styles.picker}>
            <legend className={styles.legend}>What&rsquo;s the mood?</legend>
            <div className={styles.chips}>
              {MOODS.map((m) => (
                <button
                  key={m}
                  className={`${styles.choice} ${mood === m ? styles.choiceOn : ""}`}
                  onClick={() => setMood(m)}
                  aria-pressed={mood === m}
                >
                  {MOOD_EMOJIS[m]} {MOOD_DISPLAY_LABELS[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.picker}>
            <legend className={styles.legend}>How long have you got?</legend>
            <div className={styles.chips}>
              {SLOTS.map((s) => (
                <button
                  key={s.key}
                  className={`${styles.choice} ${slot === s.key ? styles.choiceOn : ""}`}
                  onClick={() => setSlot(s.key)}
                  aria-pressed={slot === s.key}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          <button className={styles.primary} onClick={findPick} disabled={loading}>
            {loading ? "Finding common ground…" : "Find something for both of us"}
          </button>

          {error && <p className={styles.error} role="alert">{error}</p>}

          {pick && (
            <motion.div
              className={styles.result}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Link to={`/pick/${pick.id}`} className={styles.poster}>
                {pick.poster_path ? (
                  <img src={sizedPoster(pick.poster_path, "hero")} alt="" />
                ) : (
                  <PosterArt item={pick} />
                )}
              </Link>
              <h2 className={styles.pickTitle}>{pick.title}</h2>
              <p className={styles.why}>{result?.rationale}</p>
              <button className={styles.secondary} onClick={findPick}>Try another</button>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
