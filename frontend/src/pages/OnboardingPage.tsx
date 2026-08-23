import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTasteStore } from '../stores/tasteStore';
import FavouritePicker from '../components/onboarding/FavouritePicker';
import ConnectAI from '../components/llm/ConnectAI';
import styles from './OnboardingPage.module.css';

type Step = 'welcome' | 'favourites' | 'connect';

// Enter-only. An exit animation that stalls would trap the user on a step, so
// steps swap immediately and the motion is purely decorative.
const stepVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const hasCompleted = useTasteStore((s) => s.hasCompletedOnboarding);
  const completeOnboarding = useTasteStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>('welcome');

  // Returning (already-onboarded) users go straight home; the connect step is
  // still reachable right after picking favourites in this same session.
  useEffect(() => {
    if (hasCompleted && step === 'welcome') navigate('/', { replace: true });
  }, [hasCompleted, step, navigate]);

  const finish = () => navigate('/', { replace: true });

  // Try-before-you-commit: skip favourites entirely and let the cold-start
  // engine hand over a strong popular pick, then invite tuning later.
  const skipToDemo = () => {
    completeOnboarding();
    navigate('/', { replace: true });
  };

  return (
    <div className={styles.page}>
      <>
        {step === 'welcome' && (
          <motion.div key="welcome" className={styles.welcome} variants={stepVariants} initial="initial" animate="animate">
            <span className={styles.kicker}>Decision paralysis, solved</span>
            <h1 className={styles.wordmark}>UNBORED</h1>
            <p className={styles.pitch}>
              Tell us a handful of things you love. We hand you <strong>one perfect pick</strong> —
              chosen and explained by AI.
            </p>
            <p className={styles.sub}>Takes about 30 seconds. No account, no scrolling.</p>

            <ol className={styles.steps}>
              <li><span>1</span> Pick a few things you love</li>
              <li><span>2</span> Connect your AI <em>(Gemini or DeepSeek)</em></li>
              <li><span>3</span> Get one pick, chosen for you</li>
            </ol>

            <motion.button className={styles.cta} onClick={() => setStep('favourites')} whileTap={{ scale: 0.97 }}>
              Get started
            </motion.button>
            <button className={styles.skipDemo} onClick={skipToDemo}>
              or just show me something →
            </button>
          </motion.div>
        )}

        {step === 'favourites' && (
          <motion.div key="favourites" className={styles.full} variants={stepVariants} initial="initial" animate="animate">
            <FavouritePicker onComplete={() => setStep('connect')} />
          </motion.div>
        )}

        {step === 'connect' && (
          <motion.div key="connect" className={styles.connect} variants={stepVariants} initial="initial" animate="animate">
            <span className={styles.kicker}>This is the part that matters</span>
            <h2 className={styles.connectHeading}>Connect your AI</h2>
            <p className={styles.connectPitch}>
              Unbored is really about <strong>AI picking for you</strong>. Bring your own Gemini or
              DeepSeek key and it chooses and explains your pick, grounded in the titles you love.
            </p>

            <div className={styles.compare}>
              <div className={`${styles.compareCol} ${styles.compareAi}`}>
                <span className={styles.compareTag}>✦ With your key</span>
                <p>AI reads your taste and hand-picks one title, with a reason in your words.</p>
              </div>
              <div className={styles.compareCol}>
                <span className={styles.compareTag}>Without</span>
                <p>A solid built-in engine pick — good, but not chosen <em>for you</em>.</p>
              </div>
            </div>

            <ConnectAI variant="onboarding" onConnected={finish} onSkip={finish} />
          </motion.div>
        )}
      </>
    </div>
  );
}
