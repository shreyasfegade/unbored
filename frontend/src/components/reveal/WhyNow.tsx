import { motion } from "framer-motion";
import styles from "./WhyNow.module.css";

interface WhyNowProps {
  text: string;
  attribution?: string | null;
}

export function WhyNow({ text, attribution }: WhyNowProps) {
  return (
    <div className={styles.wrap}>
      <motion.p
        className={styles.text}
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 0.85 },
        }}
        transition={{ duration: 0.6 }}
      >
        {text}
      </motion.p>
      {attribution && <span className={styles.attribution}>{attribution}</span>}
    </div>
  );
}
