import { useEffect, type ReactNode } from 'react';
import { motion } from "framer-motion";
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useStatusStore } from '../../stores/statusStore';
import Background from './Background';
import Header from './Header';
import { Toast } from '../ui/Toast';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const prefersReduced = useReducedMotion();
  const fetchStatus = useStatusStore((s) => s.fetch);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <motion.div
      className={styles.shell}
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <Background />
      <Header />
      <main id="main-content" className={styles.main}>
        {children}
      </main>
      <Toast />
    </motion.div>
  );
}
