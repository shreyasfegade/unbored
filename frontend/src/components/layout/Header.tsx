import { Link } from 'react-router-dom';
import { motion } from "framer-motion";
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useStatusStore } from '../../stores/statusStore';
import styles from './Header.module.css';

const letters = "UNBORED".split("");
const ANIMATED_KEY = "unbored-wordmark-animated";

export default function Header() {
  const prefersReduced = useReducedMotion();
  const status = useStatusStore((s) => s.status);
  const isDemo = status?.catalogMode === 'demo';
  const hasAnimated = sessionStorage.getItem(ANIMATED_KEY) !== null;

  if (!hasAnimated) {
    sessionStorage.setItem(ANIMATED_KEY, "1");
  }

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
        {isDemo && (
          <Link to="/settings" className={styles.demoBadge} title="Running on the built-in demo catalog — add a TMDB key in Settings to go live">
            Demo
          </Link>
        )}
        <Link to="/settings" className={styles.settingsLink} aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M15.9 12.4l.9.7c.2.2.3.5.2.8l-.3.9c-.1.3-.4.5-.7.5l-1.2-.1c-.3 0-.6.2-.8.4l-.6 1c-.1.3-.4.4-.7.4H11.3c-.3 0-.6-.2-.7-.5l-.5-1c-.2-.3-.5-.4-.8-.4l-1.2.1c-.3 0-.6-.2-.7-.5l-.3-.9c-.1-.3 0-.6.2-.8l.9-.7c.2-.2.4-.5.4-.8l-.1-1.2c0-.3-.2-.6-.5-.7l-.9-.3c-.3-.1-.5-.4-.5-.7l.1-1.2c0-.3.2-.6.4-.8l1-.6c.3-.1.4-.4.4-.7l-.4-1.1c-.1-.3 0-.6.2-.8l.7-.9c.2-.2.5-.3.8-.2l1.2.3c.3.1.6 0 .8-.2l.6-1c.1-.3.4-.5.7-.5h1.2c.3 0 .6.2.7.5l.5 1c.2.2.5.4.8.4l1.2-.1c.3 0 .6.2.7.5l.3.9c.1.3 0 .6-.2.8l-.9.7c-.2.2-.4.5-.4.8l.1 1.2c0 .3.2.6.5.7l.9.3c.3.1.5.4.5.7l-.1 1.2c0 .3-.2.6-.4.8l-1 .6c-.3.1-.4.4-.4.7l.4 1.1c.1.3 0 .6-.2.8l-.7.9c-.2.2-.5.3-.8.2l-1.2-.3c-.3-.1-.6 0-.8.2l-.6 1c-.1.3-.4.5-.7.5h.1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        </Link>
      </div>
    </header>
  );
}
