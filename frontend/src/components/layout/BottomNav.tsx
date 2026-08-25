import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useLibraryStore } from "../../stores/libraryStore";
import { SPRING } from "../../config/motion";
import styles from "./BottomNav.module.css";

/**
 * Every mode, labelled, one tap away.
 *
 * These features previously hung off unlabelled header icons and small text
 * links, so most of them were never found. Labels are deliberate: an icon-only
 * bar would reintroduce exactly that problem.
 */

interface Item {
  to: string;
  label: string;
  icon: ReactNode;
}

const ICONS = {
  pick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2.2 5.6L20 9.3l-4.2 3.8 1.2 5.9L12 16l-5 3 1.2-5.9L4 9.3l5.8-.7z" />
    </svg>
  ),
  browse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="7" height="7" rx="1.5" />
      <rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
    </svg>
  ),
  swipe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20s-6.5-4.3-8.5-8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 5c-2 3.7-8.5 8-8.5 8z" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" />
    </svg>
  ),
  you: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  ),
};

const ITEMS: Item[] = [
  { to: "/", label: "Pick", icon: ICONS.pick },
  { to: "/browse", label: "Browse", icon: ICONS.browse },
  { to: "/swipe", label: "Swipe", icon: ICONS.swipe },
  { to: "/library", label: "Library", icon: ICONS.library },
  { to: "/taste", label: "You", icon: ICONS.you },
];

// Full-bleed screens where a nav bar would only be in the way.
const HIDDEN_ON = [/^\/onboarding/, /^\/pick\//];

export default function BottomNav() {
  const { pathname } = useLocation();
  const savedCount = useLibraryStore((s) => s.watchlist.length);

  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  return (
    <nav className={styles.nav} aria-label="Main">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
        >
          {({ isActive }) => (
            <>
              {/* A single shared pill that springs between tabs as they activate. */}
              {isActive && (
                <motion.span
                  layoutId="navActive"
                  className={styles.indicator}
                  transition={SPRING.snappy}
                  aria-hidden="true"
                />
              )}
              <motion.span
                className={styles.icon}
                aria-hidden="true"
                animate={{ scale: isActive ? 1.12 : 1 }}
                transition={SPRING.snappy}
              >
                {item.icon}
                {item.to === "/library" && savedCount > 0 && (
                  <span className={styles.badge}>{savedCount > 9 ? "9+" : savedCount}</span>
                )}
              </motion.span>
              <span className={styles.label}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
