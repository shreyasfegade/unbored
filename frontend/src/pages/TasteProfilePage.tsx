import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { fetchTasteProfile, type TasteProfile } from "../api/taste";
import { describeApiError } from "../api/client";
import styles from "./TasteProfilePage.module.css";

const TONE_LABELS: Record<string, { label: string; low: string; high: string }> = {
  darkness_preference: { label: "Darkness", low: "Light", high: "Dark" },
  humor_affinity: { label: "Humour", low: "Serious", high: "Funny" },
  emotional_intensity: { label: "Intensity", low: "Easy", high: "Heavy" },
};

const TYPE_LABELS: Record<string, string> = { movie: "Films", tv: "TV", anime: "Anime" };

export default function TasteProfilePage() {
  const navigate = useNavigate();
  const favouriteIds = useTasteStore((s) => s.favouriteIds);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTasteProfile(favouriteIds)
      .then((res) => { if (!cancelled) setProfile(res.data); })
      .catch((err) => { if (!cancelled) setError(describeApiError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [favouriteIds]);

  const maxDecade = Math.max(1, ...(profile?.decades.map((d) => d.count) ?? [1]));
  const typeTotal = Object.values(profile?.media_types ?? {}).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>

      <motion.h1
        className={styles.heading}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Your taste
      </motion.h1>
      <p className={styles.subtitle}>What the engine sees when it picks for you.</p>

      {loading ? (
        <div className={styles.skeleton} aria-label="Loading your profile" />
      ) : error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : !profile || profile.resolved === 0 ? (
        <div className={styles.empty}>
          <p>Nothing to read yet — add a few favourites and this fills in.</p>
          <Link to="/enrich" className={styles.cta}>Build your taste</Link>
        </div>
      ) : (
        <div className={styles.sections}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Built from</h2>
            <div className={styles.statRow}>
              <Stat value={String(profile.resolved)} label="titles" />
              {profile.mean_rating != null && <Stat value={profile.mean_rating.toFixed(1)} label="avg rating" />}
              {profile.mean_runtime != null && <Stat value={`${profile.mean_runtime}m`} label="avg length" />}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Genres you gravitate to</h2>
            <ul className={styles.bars}>
              {profile.genres.map((g) => (
                <li key={g.name} className={styles.barRow}>
                  <span className={styles.barLabel}>{g.name}</span>
                  <span className={styles.barTrack}>
                    <motion.span
                      className={styles.barFill}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, (g.share / profile.genres[0].share) * 100)}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </span>
                  <span className={styles.barValue}>{Math.round(g.share * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Tone</h2>
            <ul className={styles.dials}>
              {Object.entries(profile.tone).map(([key, value]) => {
                const meta = TONE_LABELS[key] ?? { label: key, low: "low", high: "high" };
                return (
                  <li key={key} className={styles.dial}>
                    <span className={styles.dialLabel}>{meta.label}</span>
                    <span className={styles.dialTrack}>
                      <motion.span
                        className={styles.dialDot}
                        initial={{ left: "50%" }}
                        animate={{ left: `${Math.min(96, Math.max(4, value * 100))}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </span>
                    <span className={styles.dialEnds}>
                      <span>{meta.low}</span>
                      <span>{meta.high}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {profile.decades.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Eras</h2>
              <div className={styles.histogram}>
                {profile.decades.map((d) => (
                  <div key={d.decade} className={styles.histCol}>
                    <motion.div
                      className={styles.histBar}
                      initial={{ height: 0 }}
                      animate={{ height: `${(d.count / maxDecade) * 100}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                      title={`${d.count} title${d.count === 1 ? "" : "s"}`}
                    />
                    <span className={styles.histLabel}>{d.decade}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Format</h2>
            <div className={styles.split}>
              {Object.entries(profile.media_types).map(([type, count]) => (
                <div
                  key={type}
                  className={styles.splitPart}
                  style={{ flexGrow: count }}
                  title={`${count} ${type}`}
                >
                  <span className={styles.splitLabel}>
                    {TYPE_LABELS[type] ?? type} {Math.round((count / typeTotal) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          {(profile.top_directors.length > 0 ||
            profile.top_cast.length > 0 ||
            profile.top_studios.length > 0) && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Names that keep coming up</h2>
              {profile.top_directors.length > 0 && (
                <NameRow title="Directors" names={profile.top_directors} />
              )}
              {profile.top_studios.length > 0 && (
                <NameRow title="Studios" names={profile.top_studios} />
              )}
              {profile.top_cast.length > 0 && <NameRow title="Cast" names={profile.top_cast} />}
            </section>
          )}

          <Link to="/enrich" className={styles.cta}>Refine your taste</Link>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function NameRow({ title, names }: { title: string; names: string[] }) {
  return (
    <div className={styles.nameRow}>
      <span className={styles.nameKind}>{title}</span>
      <span className={styles.names}>
        {names.map((n) => (
          <span key={n} className={styles.name}>{n}</span>
        ))}
      </span>
    </div>
  );
}
