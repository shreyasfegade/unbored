import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Background from './Background';
import Header from './Header';
import { Toast } from '../ui/Toast';
import BottomNav from './BottomNav';
import WakeGate from '../system/WakeGate';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useUIStore } from '../../stores/uiStore';
import { useProfileSync } from '../../hooks/useProfileSync';
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
  "/account": "Account",
};

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [announce, setAnnounce] = useState("");
  const firstRender = useRef(true);
  const density = usePreferencesStore((s) => s.density);
  // Mounted once here so there's a single sync subscriber for the whole app.
  useProfileSync();

  // Reflect the density preference on <html> so the poster-tile CSS vars pick it
  // up everywhere at once.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // On a fresh session (no persisted UI selections yet), seed the mood-flow
  // defaults from the durable preferences, so a chosen default type/era/time is
  // pre-selected without overriding a mid-session change.
  useEffect(() => {
    if (sessionStorage.getItem("unbored-ui")) return;
    const p = usePreferencesStore.getState();
    const ui = useUIStore.getState();
    ui.setMediaType(p.defaultMediaType);
    ui.setEra(p.defaultEra);
    if (p.defaultTimeSlot) ui.setTimeSlot(p.defaultTimeSlot);
  }, []);

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
