import { motion } from "framer-motion";
import styles from "./WhyNow.module.css";

interface WhyNowProps {
  text: string;
  attribution?: string | null;
  emphasis?: boolean;
}

export function WhyNow({ text, attribution, emphasis }: WhyNowProps) {
  return (
    <div className={styles.wrap}>
      {attribution && (
        <span className={`${styles.attribution} ${emphasis ? styles.ai : ""}`}>
          {emphasis && <span className={styles.spark} aria-hidden="true">✦</span>}
          {attribution}
        </span>
      )}
      <motion.p
        className={`${styles.text} ${emphasis ? styles.textAi : ""}`}
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
        transition={{ duration: 0.6 }}
      >
        {text}
      </motion.p>
    </div>
  );
}
