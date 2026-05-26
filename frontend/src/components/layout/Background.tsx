import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from "framer-motion";
import styles from './Background.module.css';

interface Particle {
  id: number;
  left: string;
  top: string;
  opacity: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
}

export default function Background() {
  const prefersReduced = useReducedMotion();
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setParticles(
        Array.from({ length: 15 }, (_, i) => ({
          id: i,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          opacity: 0.08 + Math.random() * 0.18,
          driftX: (Math.random() - 0.5) * 60,
          driftY: (Math.random() - 0.5) * 60,
          duration: 14 + Math.random() * 22,
          delay: Math.random() * 8,
        }))
      );
    });
  }, []);

  return (
    <div className={styles.background}>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className={styles.particle}
          style={{
            left: p.left,
            top: p.top,
            opacity: p.opacity,
          }}
          animate={
            prefersReduced
              ? {}
              : {
                  x: [0, p.driftX, -p.driftX * 0.6, p.driftX * 0.4, 0],
                  y: [0, p.driftY, -p.driftY * 0.5, p.driftY * 0.7, 0],
                }
          }
          transition={
            prefersReduced
              ? { duration: 0 }
              : {
                  duration: p.duration,
                  repeat: Infinity,
                  delay: p.delay,
                  ease: "easeInOut",
                }
          }
        />
      ))}
    </div>
  );
}
