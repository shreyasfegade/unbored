import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from "framer-motion";
import { useReducedMotion } from '../../hooks/useReducedMotion';
import Background from './Background';
import Header from './Header';
import { Toast } from '../ui/Toast';
import WakeGate from '../system/WakeGate';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
}

const ROUTE_NAME: Record<string, string> = {
  "/": "Home",
  "/onboarding": "Onboarding",
  "/enrich": "Tune your taste",
  "/settings": "Settings",
};

export default function AppShell({ children }: AppShellProps) {
  const prefersReduced = useReducedMotion();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [announce, setAnnounce] = useState("");
  const firstRender = useRef(true);

  // On route change, move focus to <main> (so keyboard users don't restart from
  // the top of the document) and announce the new page for screen readers.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
    const name = ROUTE_NAME[location.pathname] || (location.pathname.startsWith("/pick") ? "Your pick" : "Page");
    setAnnounce(`${name} page`);
  }, [location.pathname]);

  return (
    <motion.div
      className={styles.shell}
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <Background />
      <Header />
      <main id="main-content" className={styles.main} ref={mainRef} tabIndex={-1}>
        {children}
      </main>
      <p aria-live="polite" className={styles.routeAnnouncer}>{announce}</p>
      {/* Probes the API and only takes over when it's actually cold; it also
          replaces the old fire-and-forget warmup ping. */}
      <WakeGate />
      <Toast />
    </motion.div>
  );
}
