import { motion } from "framer-motion";
import styles from "./PosterReveal.module.css";

interface PosterRevealProps {
  posterUrl: string | null;
  title: string;
}

export function PosterReveal({ posterUrl, title }: PosterRevealProps) {
  return (
    <motion.div className={styles.container}>
      <motion.div
        className={styles.glow}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      />

      <motion.img
        src={posterUrl ?? ""}
        alt={title}
        className={styles.poster}
        loading="lazy"
        width={300}
        height={450}
        initial={{
          scale: 0.3,
          opacity: 0,
          filter: "blur(20px)",
        }}
        animate={{
          scale: 1,
          opacity: 1,
          filter: "blur(0px)",
        }}
        transition={{
          type: "spring",
          stiffness: 200,
          damping: 20,
          mass: 1,
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </motion.div>
  );
}
