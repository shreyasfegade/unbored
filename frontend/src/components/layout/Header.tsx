import { Link } from 'react-router-dom';
import { motion } from "framer-motion";
import { useEffect, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useLlmStore } from '../../stores/llmStore';
import styles from './Header.module.css';

const letters = "UNBORED".split("");
const ANIMATED_KEY = "unbored-wordmark-animated";

export default function Header() {
  const prefersReduced = useReducedMotion();
  const aiConnected = useLlmStore((s) => s.validated);
  // Read once (pure) in an initialiser; persist in an effect — never write to
  // storage during render.
  const [hasAnimated] = useState(() => sessionStorage.getItem(ANIMATED_KEY) !== null);
  useEffect(() => {
    sessionStorage.setItem(ANIMATED_KEY, "1");
  }, []);

  return (
    <header className={styles.header}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <Link to="/" className={styles.wordmark} aria-label="Unbored home">
        {prefersReduced || hasAnimated ? (
          "UNBORED"
        ) : (
          <motion.span style={{ display: "inline-block" }}>
            {letters.map((char, i) => (
              <motion.span
                key={i}
                style={{ display: "inline-block" }}
                initial={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{
                  delay: 0.3 + i * 0.06,
                  duration: 0.4,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
              >
                {char}
              </motion.span>
            ))}
          </motion.span>
        )}
      </Link>
      <div className={styles.right}>
        {aiConnected && (
          <Link to="/settings" className={styles.aiBadge} title="AI picks are on — manage in Settings">
            <span className={styles.aiSpark} aria-hidden="true">✦</span> AI
          </Link>
        )}
        <Link to="/settings" className={styles.settingsLink} aria-label="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
