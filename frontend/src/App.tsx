import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useTasteStore } from './stores/tasteStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { SPRING } from './config/motion';
import { ErrorBoundary } from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';
import { RouteFrame } from './components/system/RouteFrame';
import { lazyRetry } from './lib/lazyRetry';
// Onboarding is the only route a first-time visitor can reach, so it loads
// eagerly; the rest are code-split so the welcome screen isn't behind the whole
// reveal subsystem, enrich, settings, and pick pages.
import OnboardingPage from './pages/OnboardingPage';
const HomePage = lazyRetry(() => import('./pages/HomePage'));
const EnrichPage = lazyRetry(() => import('./pages/EnrichPage'));
const BrowsePage = lazyRetry(() => import('./pages/BrowsePage'));
const SettingsPage = lazyRetry(() => import('./pages/SettingsPage'));
const PickPage = lazyRetry(() => import('./pages/PickPage'));
const SwipePage = lazyRetry(() => import('./pages/SwipePage'));
const LibraryPage = lazyRetry(() => import('./pages/LibraryPage'));
const TogetherPage = lazyRetry(() => import('./pages/TogetherPage'));
const TasteProfilePage = lazyRetry(() => import('./pages/TasteProfilePage'));
const AccountPage = lazyRetry(() => import('./pages/AccountPage'));
const NotFoundPage = lazyRetry(() => import('./pages/NotFoundPage'));
const ImportPage = lazyRetry(() => import('./pages/ImportPage'));

/**
 * Pages ease in on mount and are never animated out — enter-only, always
 * mounted.
 *
 * This is NOT the pattern that froze the app before. That was
 * `AnimatePresence mode="wait"` wrapping the routes: it held the incoming page
 * until the outgoing one finished an exit animation that never completed, so
 * React stopped committing entirely. Here there is no AnimatePresence and no
 * exit — the router swaps pages instantly and this wrapper animates the new one
 * in as decoration. A stalled frame can at worst leave the page a few pixels low
 * and briefly translucent; it can never withhold the content. Reduced motion
 * skips it. (AppShell, the whole-app wrapper, is deliberately never animated.)
 */
function Page({ label, children }: { label: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  // Freeze-proofing the freeze-proofing: framer's animation loop is paused while
  // the tab is hidden, so a page that MOUNTS in a background tab would sit stuck
  // at its `initial` opacity 0 and render invisible until the user interacts.
  // If the document is hidden at mount, skip the enter entirely and render the
  // final state — the animation is pure decoration and never worth a blank page.
  const animate = !reduce && typeof document !== 'undefined' && !document.hidden;
  return (
    <motion.div
      style={{ width: '100%' }}
      initial={animate ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.gentle}
    >
      <RouteFrame label={label}>{children}</RouteFrame>
    </motion.div>
  );
}

function AppRoutes() {
  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);

  return (
    <Routes>
      <Route
        path="/"
        element={
          hasCompletedOnboarding
            ? <Page label="home"><HomePage /></Page>
            : <Navigate to="/onboarding" replace />
        }
      />
      <Route path="/onboarding" element={<Page label="onboarding"><OnboardingPage /></Page>} />
      <Route path="/browse" element={<Page label="browse"><BrowsePage /></Page>} />
      <Route path="/enrich" element={<Page label="enrich"><EnrichPage /></Page>} />
      <Route path="/settings" element={<Page label="settings"><SettingsPage /></Page>} />
      <Route path="/import" element={<Page label="import"><ImportPage /></Page>} />
      <Route path="/taste" element={<Page label="taste"><TasteProfilePage /></Page>} />
      <Route path="/account" element={<Page label="account"><AccountPage /></Page>} />
      {/* Group mode: a live room on Supabase Realtime; no account needed. */}
      <Route path="/together/:code?" element={<Page label="together"><TogetherPage /></Page>} />
      <Route path="/library" element={<Page label="library"><LibraryPage /></Page>} />
      <Route path="/swipe" element={<Page label="swipe"><SwipePage /></Page>} />
      {/* Shareable pick — no onboarding gate, so a recipient can see it. */}
      <Route path="/pick/:mediaId" element={<Page label="pick"><PickPage /></Page>} />
      <Route path="*" element={<Page label="404"><NotFoundPage /></Page>} />
    </Routes>
  );
}

function App() {
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  return (
    // "user" honours the OS setting; the in-app toggle can force it to "always".
    // Either way this is JS-driven, so framer animations obey it (CSS can't).
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <BrowserRouter>
        {/* Inside the router so a crash boundary can still navigate to safety. */}
        <ErrorBoundary label="app">
          <AppShell>
            <AppRoutes />
          </AppShell>
        </ErrorBoundary>
      </BrowserRouter>
    </MotionConfig>
  );
}

export default App;
