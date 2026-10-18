import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { AIStatus, AITier, ScoredMediaItem } from "../../types/recommendation";
import type { ConfidenceLevel } from "../../types/mood";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WhyNow } from "./WhyNow";
import { UpgradePrompt } from "./UpgradePrompt";
import { AlternatePicks } from "./AlternatePicks";
import { ActionButtons } from "./ActionButtons";
import { WatchPanel } from "../watch/WatchPanel";
import { primaryWatchUrl } from "../watch/watchOptions";
import { Trailer } from "../trailer/Trailer";
import { WhyNot } from "../whynot/WhyNot";
import { useRecommendationStore } from "../../stores/recommendationStore";
import styles from "./InfoCascade.module.css";

interface InfoCascadeProps {
  primary: ScoredMediaItem;
  confidence: ConfidenceLevel | null;
  rationale: string | null;
  pickedBy: "ai" | "engine" | null;
  provider: string | null;
  aiStatus: AIStatus;
  aiTier: AITier | null;
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
  aiTier,
  mediaTypeApplied,
  alternates,
  onAlternateSelect,
  onRegenerate,
  onStartOver,
}: InfoCascadeProps) {
  const watchUrl = primaryWatchUrl(primary.media);
  const request = useRecommendationStore((s) => s.request);

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
              pickedBy !== "ai" || !provider
                ? "Engine pick"
                : aiTier === "free"
                  ? "AI pick · Gemini, shared free tier"
                  : `AI pick · ${provider}`
            }
            emphasis={pickedBy === "ai"}
          />
        </motion.div>
      )}

      {/* Only pitch "connect AI" when there's no AI at all. When AI was there
          but didn't answer, say what happened instead. */}
      {pickedBy === "engine" && aiStatus === "off" && <UpgradePrompt />}
      {pickedBy === "engine" && aiStatus !== "off" && aiStatus !== "used" && (
        <motion.p
          className={styles.notice}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        >
          {aiStatus === "limited" && aiTier === "free" ? (
            <>
              Today&rsquo;s free AI picks are used up, so the engine chose this one. They reset
              tomorrow, or <Link to="/settings">connect your own key</Link> for unlimited.
            </>
          ) : aiStatus === "limited" ? (
            "Your AI key is rate-limited right now, so the engine picked this time."
          ) : aiTier === "free" ? (
            "The AI was slow to respond, so the engine picked this time. Try again for an AI-chosen pick."
          ) : (
            "Your AI was slow to respond, so the engine picked this time. Try again for an AI-chosen pick."
          )}
        </motion.p>
      )}

      <motion.div
        style={{ width: "100%" }}
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        transition={{ duration: 0.4 }}
      >
        <WatchPanel media={primary.media} />
      </motion.div>

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
          reason={rationale}
        />
      </motion.div>

      {/* Exploring, after deciding: the trailer and "why not X?". */}
      <motion.div
        className={styles.extras}
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        transition={{ duration: 0.3 }}
      >
        <Trailer key={`t-${primary.media.id}`} media={primary.media} />
        {request && <WhyNot key={primary.media.id} pick={primary} request={request} pickedByAi={pickedBy === "ai"} />}
      </motion.div>
    </motion.div>
  );
}
