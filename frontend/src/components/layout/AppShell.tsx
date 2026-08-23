import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Background from './Background';
import Header from './Header';
import { Toast } from '../ui/Toast';
import BottomNav from './BottomNav';
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
  "/library": "Your library",
  "/taste": "Your taste",
  "/together": "Watch together",
  "/swipe": "Swipe",
};

export default function AppShell({ children }: AppShellProps) {
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

  // Not animated. This wraps the entire app, and fading it in from transparent
  // meant one stalled animation frame hid everything — it was caught at opacity
  // 0.17 in a background tab, with the whole UI invisible but present.
  return (
    <div className={styles.shell}>
      <Background />
      <Header />
      <main id="main-content" className={styles.main} ref={mainRef} tabIndex={-1}>
        {children}
      </main>
      <BottomNav />
      <p aria-live="polite" className={styles.routeAnnouncer}>{announce}</p>
      {/* Probes the API and only takes over when it's actually cold; it also
          replaces the old fire-and-forget warmup ping. */}
      <WakeGate />
      <Toast />
    </div>
  );
}
