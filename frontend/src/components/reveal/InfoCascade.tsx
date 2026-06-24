import { motion } from "framer-motion";
import type { ScoredMediaItem } from "../../types/recommendation";
import type { ConfidenceLevel } from "../../types/mood";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WhyNow } from "./WhyNow";
import { UpgradePrompt } from "./UpgradePrompt";
import { AlternatePicks } from "./AlternatePicks";
import { ActionButtons } from "./ActionButtons";
import styles from "./InfoCascade.module.css";

interface InfoCascadeProps {
  primary: ScoredMediaItem;
  confidence: ConfidenceLevel;
  rationale: string | null;
  pickedBy: "ai" | "engine" | null;
  provider: string | null;
  alternates: ScoredMediaItem[];
  onAlternateSelect: (index: number) => void;
  onRegenerate: () => void;
  onStartOver: () => void;
}

export function InfoCascade({
  primary,
  confidence,
  rationale,
  pickedBy,
  provider,
  alternates,
  onAlternateSelect,
  onRegenerate,
  onStartOver,
}: InfoCascadeProps) {
  const watchUrl = primary.media.title
    ? `https://www.google.com/search?q=watch+${encodeURIComponent(primary.media.title)}+${primary.media.release_year ?? ""}`
    : null;

  return (
    <motion.div
      className={styles.cascade}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: 0.3,
            delayChildren: 0,
          },
        },
      }}
    >
      <motion.h2
        className={styles.title}
        variants={{
          hidden: { y: 20, opacity: 0 },
          visible: { y: 0, opacity: 1 },
        }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {primary.media.title}
      </motion.h2>

      <motion.p
        className={styles.meta}
        variants={{
          hidden: { y: 20, opacity: 0 },
          visible: { y: 0, opacity: 1 },
        }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {primary.media.release_year}{primary.media.runtime_minutes ? ` · ${primary.media.runtime_minutes} min` : ""}
      </motion.p>

      {primary.media.genres.length > 0 && (
        <motion.div
          className={styles.genrePills}
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1 },
          }}
        >
          {primary.media.genres.slice(0, 4).map((genre) => (
            <span key={genre} className={styles.genrePill}>{genre}</span>
          ))}
        </motion.div>
      )}

      <motion.div
        variants={{
          hidden: { opacity: 0, scale: 0.9 },
          visible: { opacity: 1, scale: 1 },
        }}
        transition={{ duration: 0.4 }}
      >
        <ConfidenceBadge level={confidence} />
      </motion.div>

      {rationale && (
        <motion.div
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1 },
          }}
          transition={{ duration: 0.6 }}
        >
          <WhyNow
            text={rationale}
            attribution={
              pickedBy === "ai" && provider
                ? `AI pick · ${provider}`
                : "Engine pick"
            }
            emphasis={pickedBy === "ai"}
          />
        </motion.div>
      )}

      {pickedBy === "engine" && <UpgradePrompt />}

      <motion.div
        variants={{
          hidden: { y: 40, opacity: 0 },
          visible: { y: 0, opacity: 0.6 },
        }}
        transition={{ duration: 0.5 }}
      >
        <AlternatePicks alternates={alternates} onSelect={onAlternateSelect} />
      </motion.div>

      <motion.div
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1 },
        }}
        transition={{ duration: 0.3 }}
      >
        <ActionButtons
          onRegenerate={onRegenerate}
          onStartOver={onStartOver}
          watchUrl={watchUrl}
        />
      </motion.div>
    </motion.div>
  );
}
