import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useUIStore } from "../stores/uiStore";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const resetProfile = useTasteStore((s) => s.resetProfile);
  const resetRec = useRecommendationStore((s) => s.reset);
  const resetUI = useUIStore((s) => s.resetSelections);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const executeReset = useCallback(() => {
    resetProfile();
    resetRec();
    resetUI();
    localStorage.removeItem("unbored-taste");
    navigate("/onboarding", { replace: true });
  }, [resetProfile, resetRec, resetUI, navigate]);

  const itemVariant = {
    hidden: { opacity: 0, y: 16 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.15 + i * 0.08,
        duration: 0.35,
        ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
      },
    }),
  };

  return (
    <div className={styles.page}>
      <ConfirmDialog
        open={showResetConfirm}
        title="Reset your taste profile?"
        message="This permanently clears all your favourites, taste data, and recommendations. You'll need to go through onboarding again."
        confirmLabel="Reset everything"
        cancelLabel="Keep my profile"
        variant="danger"
        onConfirm={executeReset}
        onCancel={() => setShowResetConfirm(false)}
      />

      <motion.button
        className={styles.back}
        onClick={() => navigate("/")}
        initial={prefersReduced ? false : { opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        whileHover={prefersReduced ? {} : { x: -4 }}
        whileTap={prefersReduced ? {} : { scale: 0.95 }}
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

      <motion.div
        className={styles.section}
        variants={itemVariant}
        initial={prefersReduced ? false : "hidden"}
        animate="visible"
        custom={0}
      >
        <motion.button
          className={styles.actionBtn}
          onClick={() => navigate("/enrich")}
          whileHover={prefersReduced ? {} : { scale: 1.02 }}
          whileTap={prefersReduced ? {} : { scale: 0.96 }}
        >
          Enrich taste
        </motion.button>
      </motion.div>

      <motion.div
        className={styles.section}
        variants={itemVariant}
        initial={prefersReduced ? false : "hidden"}
        animate="visible"
        custom={1}
      >
        <motion.button
          className={styles.dangerBtn}
          onClick={() => setShowResetConfirm(true)}
          whileHover={prefersReduced ? {} : { scale: 1.02 }}
          whileTap={prefersReduced ? {} : { scale: 0.96 }}
        >
          Reset profile
        </motion.button>
        <p className={styles.dangerHint}>
          This clears your taste data. You'll need to go through onboarding again.
        </p>
      </motion.div>

      <motion.p
        className={styles.version}
        variants={itemVariant}
        initial={prefersReduced ? false : "hidden"}
        animate="visible"
        custom={2}
      >
        UNBORED v0.1.0
      </motion.p>
    </div>
  );
}
