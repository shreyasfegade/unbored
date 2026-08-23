import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import styles from "./ScanningPhase.module.css";

interface ScanningPhaseProps {
  waitStage?: number;
}

const WAIT_MESSAGES: Record<number, string> = {
  1: "Still working…",
  2: "The server was asleep and is waking up — this can take up to a minute.",
};

interface Particle {
  id: number;
  x: number;
  y: number;
  delay: number;
}

export function ScanningPhase({ waitStage = 0 }: ScanningPhaseProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setParticles(
        Array.from({ length: 20 }, (_, i) => ({
          id: i,
          x: Math.random() * (typeof window !== "undefined" ? window.innerWidth : 800) - (typeof window !== "undefined" ? window.innerWidth / 2 : 400),
          y: Math.random() * (typeof window !== "undefined" ? window.innerHeight : 600) - (typeof window !== "undefined" ? window.innerHeight / 2 : 300),
          delay: Math.random() * 0.5,
        }))
      );
    });
  }, []);


  return (
    <div className={styles.container} aria-hidden="true">
      <div className={styles.pulseContainer}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className={styles.pulseRing}
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{
              duration: 2,
              delay: i * 0.4,
              ease: "easeOut",
              repeat: Infinity,
              repeatDelay: 0.6,
            }}
          />
        ))}
      </div>

      <div className={styles.particleLayer}>
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className={styles.convergingDot}
            initial={{
              x: p.x,
              y: p.y,
              opacity: 0.3,
              scale: 1,
            }}
            animate={{
              x: 0,
              y: 0,
              opacity: 0,
              scale: 0,
            }}
            transition={{
              duration: 2,
              delay: p.delay,
              ease: "easeIn",
            }}
          />
        ))}
      </div>

      {waitStage > 0 && (
        <p className={styles.takingLonger}>{WAIT_MESSAGES[waitStage]}</p>
      )}
    </div>
  );
}
