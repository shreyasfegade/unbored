import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTasteStore } from '../stores/tasteStore';
import FavouritePicker from '../components/onboarding/FavouritePicker';
import ConnectAI from '../components/llm/ConnectAI';
import styles from './OnboardingPage.module.css';

type Step = 'welcome' | 'favourites' | 'connect';

const stepVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.22 } },
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const hasCompleted = useTasteStore((s) => s.hasCompletedOnboarding);
  const [step, setStep] = useState<Step>('welcome');

  // Returning (already-onboarded) users go straight home; the connect step is
  // still reachable right after picking favourites in this same session.
  useEffect(() => {
    if (hasCompleted && step === 'welcome') navigate('/', { replace: true });
  }, [hasCompleted, step, navigate]);

  const finish = () => navigate('/', { replace: true });

  return (
    <div className={styles.page}>
      <AnimatePresence mode="wait">
        {step === 'welcome' && (
          <motion.div key="welcome" className={styles.welcome} variants={stepVariants} initial="initial" animate="animate" exit="exit">
            <span className={styles.kicker}>Decision paralysis, solved</span>
            <h1 className={styles.wordmark}>UNBORED</h1>
            <p className={styles.pitch}>
              Tell us a handful of things you love. We hand you <strong>one perfect pick</strong> —
              chosen and explained by AI.
            </p>
            <p className={styles.sub}>Takes about 30 seconds. No account, no scrolling.</p>

            <ol className={styles.steps}>
              <li><span>1</span> Pick a few favourites</li>
              <li><span>2</span> Connect your AI <em>(optional)</em></li>
              <li><span>3</span> Get your pick</li>
            </ol>

            <motion.button className={styles.cta} onClick={() => setStep('favourites')} whileTap={{ scale: 0.97 }}>
              Get started
            </motion.button>
          </motion.div>
        )}

        {step === 'favourites' && (
          <motion.div key="favourites" className={styles.full} variants={stepVariants} initial="initial" animate="animate" exit="exit">
            <FavouritePicker onComplete={() => setStep('connect')} />
          </motion.div>
        )}

        {step === 'connect' && (
          <motion.div key="connect" className={styles.connect} variants={stepVariants} initial="initial" animate="animate" exit="exit">
            <span className={styles.kicker}>Last step — optional</span>
            <h2 className={styles.connectHeading}>Connect your AI</h2>
            <p className={styles.connectPitch}>
              This is where Unbored gets <strong>genuinely good</strong>. Bring your own Gemini or
              DeepSeek key and the AI chooses and explains your pick, grounded in what you love.
            </p>
            <p className={styles.connectSub}>
              Without a key you'll still get smart picks from our built-in engine — but a key is
              where the magic is.
            </p>
            <ConnectAI variant="onboarding" onConnected={finish} onSkip={finish} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
