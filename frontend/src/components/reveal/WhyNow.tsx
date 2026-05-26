import { motion } from "framer-motion";
import styles from "./WhyNow.module.css";

interface WhyNowProps {
  text: string;
}

export function WhyNow({ text }: WhyNowProps) {
  return (
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
  );
}
