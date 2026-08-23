import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LazyMotion, domAnimation, MotionConfig, AnimatePresence, motion } from "framer-motion";
import { useTasteStore } from './stores/tasteStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';
// Onboarding is the only route a first-time visitor can reach, so it loads
// eagerly; the rest are code-split so the welcome screen isn't behind the whole
// reveal subsystem, enrich, settings, and pick pages.
import OnboardingPage from './pages/OnboardingPage';
const HomePage = lazy(() => import('./pages/HomePage'));
const EnrichPage = lazy(() => import('./pages/EnrichPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PickPage = lazy(() => import('./pages/PickPage'));
const SwipePage = lazy(() => import('./pages/SwipePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const TogetherPage = lazy(() => import('./pages/TogetherPage'));

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2, ease: [0.55, 0, 1, 0.45] as [number, number, number, number] } },
};

function AnimatedRoutes() {
  const location = useLocation();
  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);

  return (
    <Suspense fallback={null}>
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            hasCompletedOnboarding ? (
              <motion.div
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                style={{ width: '100%', height: '100%' }}
              >
                <HomePage />
              </motion.div>
            ) : (
              <Navigate to="/onboarding" replace />
            )
          }
        />
        <Route
          path="/onboarding"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <OnboardingPage />
            </motion.div>
          }
        />
        <Route
          path="/enrich"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <EnrichPage />
            </motion.div>
          }
        />
        <Route
          path="/settings"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <SettingsPage />
            </motion.div>
          }
        />
        {/* Group mode: the invite carries the host's taste, so a guest needs no
            account and the server keeps no session. */}
        <Route
          path="/together/:code?"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <TogetherPage />
            </motion.div>
          }
        />
        <Route
          path="/library"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <LibraryPage />
            </motion.div>
          }
        />
        <Route
          path="/swipe"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <SwipePage />
            </motion.div>
          }
        />
        {/* Shareable pick — no onboarding gate, so a recipient can see it. */}
        <Route
          path="/pick/:mediaId"
          element={
            <motion.div
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%', height: '100%' }}
            >
              <PickPage />
            </motion.div>
          }
        />
      </Routes>
    </AnimatePresence>
    </Suspense>
  );
}

function App() {
  return (
    <LazyMotion features={domAnimation}>
      {/* One switch makes every framer animation in the tree honour the user's
          OS reduced-motion preference (JS-driven, so the CSS escape hatch can't). */}
      <MotionConfig reducedMotion="user">
      <BrowserRouter>
        {/* Inside the router so a crash boundary can still navigate to safety. */}
        <ErrorBoundary label="app">
          <AppShell>
            <AnimatedRoutes />
          </AppShell>
        </ErrorBoundary>
      </BrowserRouter>
      </MotionConfig>
    </LazyMotion>
  );
}

export default App;
