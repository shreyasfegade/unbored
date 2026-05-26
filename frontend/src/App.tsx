import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LazyMotion, domAnimation, AnimatePresence, motion } from "framer-motion";
import { useTasteStore } from './stores/tasteStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';
import OnboardingPage from './pages/OnboardingPage';
import HomePage from './pages/HomePage';
import EnrichPage from './pages/EnrichPage';
import SettingsPage from './pages/SettingsPage';

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2, ease: [0.55, 0, 1, 0.45] as [number, number, number, number] } },
};

function AnimatedRoutes() {
  const location = useLocation();
  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);

  return (
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
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <LazyMotion features={domAnimation}>
        <BrowserRouter>
          <AppShell>
            <AnimatedRoutes />
          </AppShell>
        </BrowserRouter>
      </LazyMotion>
    </ErrorBoundary>
  );
}

export default App;
