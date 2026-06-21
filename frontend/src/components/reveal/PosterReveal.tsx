import { useState } from "react";
import { motion } from "framer-motion";
import type { MediaItem } from "../../types/media";
import PosterArt from "../poster/PosterArt";
import styles from "./PosterReveal.module.css";

interface PosterRevealProps {
  item: MediaItem;
}

export function PosterReveal({ item }: PosterRevealProps) {
  const [failed, setFailed] = useState(false);
  const showArt = !item.poster_path || failed;

  return (
    <motion.div className={styles.container}>
      <motion.div
        className={styles.glow}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      />

      <motion.div
        className={styles.poster}
        initial={{ scale: 0.3, opacity: 0, filter: "blur(20px)" }}
        animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 200, damping: 20, mass: 1 }}
      >
        {showArt ? (
          <PosterArt item={item} />
        ) : (
          <img
            src={item.poster_path ?? ""}
            alt={item.title}
            className={styles.img}
            loading="lazy"
            width={300}
            height={450}
            onError={() => setFailed(true)}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
