import { motion } from "framer-motion";
import type { ScoredMediaItem } from "../../types/recommendation";
import type { ConfidenceLevel } from "../../types/mood";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WhyNow } from "./WhyNow";
import { UpgradePrompt } from "./UpgradePrompt";
import { AlternatePicks } from "./AlternatePicks";
import { ActionButtons } from "./ActionButtons";
import styles from "./InfoCascade.module.css";

type AIStatus = "off" | "used" | "timeout" | "error";

interface InfoCascadeProps {
  primary: ScoredMediaItem;
  confidence: ConfidenceLevel | null;
  rationale: string | null;
  pickedBy: "ai" | "engine" | null;
  provider: string | null;
  aiStatus: AIStatus;
  mediaTypeApplied: boolean;
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
  aiStatus,
  mediaTypeApplied,
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

      {confidence && (
        <motion.div
          variants={{
            hidden: { opacity: 0, scale: 0.9 },
            visible: { opacity: 1, scale: 1 },
          }}
          transition={{ duration: 0.4 }}
        >
          <ConfidenceBadge level={confidence} />
        </motion.div>
      )}

      {!mediaTypeApplied && (
        <motion.p
          className={styles.notice}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        >
          Nothing matched that type right now — here's the closest pick instead.
        </motion.p>
      )}

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

      {/* Only pitch "connect AI" when no key is connected. If a connected key
          merely failed (timeout/error), say that honestly instead of implying
          the user should connect the AI they already connected. */}
      {pickedBy === "engine" && aiStatus === "off" && <UpgradePrompt />}
      {pickedBy === "engine" && (aiStatus === "error" || aiStatus === "timeout") && (
        <motion.p
          className={styles.notice}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        >
          Your AI was slow to respond, so the engine picked this time. Try again for an AI-chosen pick.
        </motion.p>
      )}

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
          shareId={primary.media.id}
          media={primary.media}
        />
      </motion.div>
    </motion.div>
  );
}
