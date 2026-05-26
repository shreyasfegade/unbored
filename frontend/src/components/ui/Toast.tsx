import { AnimatePresence, motion } from "framer-motion";
import { useToastStore } from "../../stores/toastStore";
import styles from "./Toast.module.css";

export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className={styles.container} aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={styles.toast}
            initial={{ y: 60, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28, mass: 0.8 }}
            onClick={() => removeToast(toast.id)}
            role="status"
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
