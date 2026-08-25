import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useTasteStore } from './stores/tasteStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { SPRING } from './config/motion';
import { ErrorBoundary } from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';
// Onboarding is the only route a first-time visitor can reach, so it loads
// eagerly; the rest are code-split so the welcome screen isn't behind the whole
// reveal subsystem, enrich, settings, and pick pages.
import OnboardingPage from './pages/OnboardingPage';
const HomePage = lazy(() => import('./pages/HomePage'));
const EnrichPage = lazy(() => import('./pages/EnrichPage'));
const BrowsePage = lazy(() => import('./pages/BrowsePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PickPage = lazy(() => import('./pages/PickPage'));
const SwipePage = lazy(() => import('./pages/SwipePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const TogetherPage = lazy(() => import('./pages/TogetherPage'));
const TasteProfilePage = lazy(() => import('./pages/TasteProfilePage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));

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
function Page({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      style={{ width: '100%' }}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.gentle}
    >
      {children}
    </motion.div>
  );
}

function AppRoutes() {
  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/"
          element={
            hasCompletedOnboarding
              ? <Page><HomePage /></Page>
              : <Navigate to="/onboarding" replace />
          }
        />
        <Route path="/onboarding" element={<Page><OnboardingPage /></Page>} />
        <Route path="/browse" element={<Page><BrowsePage /></Page>} />
        <Route path="/enrich" element={<Page><EnrichPage /></Page>} />
        <Route path="/settings" element={<Page><SettingsPage /></Page>} />
        <Route path="/taste" element={<Page><TasteProfilePage /></Page>} />
        <Route path="/account" element={<Page><AccountPage /></Page>} />
        {/* Group mode: the invite carries the host's taste, so a guest needs no
            account and the server keeps no session. */}
        <Route path="/together/:code?" element={<Page><TogetherPage /></Page>} />
        <Route path="/library" element={<Page><LibraryPage /></Page>} />
        <Route path="/swipe" element={<Page><SwipePage /></Page>} />
        {/* Shareable pick — no onboarding gate, so a recipient can see it. */}
        <Route path="/pick/:mediaId" element={<Page><PickPage /></Page>} />
      </Routes>
    </Suspense>
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
