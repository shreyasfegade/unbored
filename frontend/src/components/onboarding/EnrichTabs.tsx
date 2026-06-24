import { useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import styles from "./EnrichTabs.module.css";

export type EnrichTab = "movies" | "tv" | "anime";

interface EnrichTabsProps {
  activeTab: EnrichTab;
  onTabChange: (tab: EnrichTab) => void;
}

const TABS: { key: EnrichTab; label: string }[] = [
  { key: "movies", label: "Movies" },
  { key: "tv", label: "TV Shows" },
  { key: "anime", label: "Anime" },
];

export function EnrichTabs({ activeTab, onTabChange }: EnrichTabsProps) {
  const prefersReduced = useReducedMotion();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % TABS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + TABS.length) % TABS.length;
      }
      if (nextIndex !== null) {
        tabRefs.current[nextIndex]?.focus();
        onTabChange(TABS[nextIndex].key);
      }
    },
    [onTabChange]
  );

  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((tab, i) => (
        <motion.button
          key={tab.key}
          role="tab"
          aria-selected={activeTab === tab.key}
          ref={(el) => { tabRefs.current[i] = el; }}
          className={`${styles.tab} ${activeTab === tab.key ? styles.active : ""}`}
          onClick={() => onTabChange(tab.key)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          tabIndex={activeTab === tab.key ? 0 : -1}
          whileHover={prefersReduced ? {} : { scale: 1.04 }}
          whileTap={prefersReduced ? {} : { scale: 0.95 }}
        >
          {tab.label}
          {activeTab === tab.key && (
            <motion.div
              className={styles.indicator}
              layoutId="enrich-tab-indicator"
              transition={{ stiffness: 400, damping: 30, mass: 0.7 }}
            />
          )}
        </motion.button>
      ))}
    </div>
  );
}
