import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig, motion } from "framer-motion";
import { useTasteStore } from './stores/tasteStore';
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

/**
 * Pages animate in and are never animated out.
 *
 * Routes used to be wrapped in `AnimatePresence mode="wait"`, which holds the
 * incoming page until the outgoing one finishes its exit animation. When that
 * exit never completed, the old page stayed mounted, the new one never
 * appeared, and React stopped committing anything at all — the whole app froze.
 * An animation must never decide whether content renders, so there is no exit
 * animation here: the router swaps pages immediately and motion is decoration.
 */
function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ width: '100%', height: '100%' }}
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
  return (
    // One switch makes every framer animation in the tree honour the user's OS
    // reduced-motion preference (JS-driven, so the CSS escape hatch can't).
    <MotionConfig reducedMotion="user">
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
