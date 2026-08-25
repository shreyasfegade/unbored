import { useState } from "react";
import { motion } from "framer-motion";
import { useAuthStore } from "../../stores/authStore";
import { SPRING, pressableFlat } from "../../config/motion";
import styles from "./AccountStep.module.css";

interface AccountStepProps {
  /** Called after a successful sign-up/sign-in, or when the user skips. */
  onDone: () => void;
}

/**
 * The optional "save your taste" step. Guest-first: a prominent skip always
 * finishes onboarding, and nothing picked so far is lost either way. On success
 * the existing profile-sync (useProfileSync in AppShell) carries the just-picked
 * favourites up to the account.
 */
export default function AccountStep({ onDone }: AccountStepProps) {
  const signUp = useAuthStore((s) => s.signUp);
  const signIn = useAuthStore((s) => s.signIn);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fn = mode === "signup" ? signUp : signIn;
    const { error: err } = await fn(email.trim(), password);
    setBusy(false);
    if (err) { setError(err); return; }
    onDone();
  };

  return (
    <motion.div
      className={styles.step}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.gentle}
    >
      <span className={styles.kicker}>Optional</span>
      <h2 className={styles.heading}>Save your taste</h2>
      <p className={styles.pitch}>
        Create an account so your picks, watchlist and settings follow you to your
        phone — and so you can join watch rooms as yourself. You can always do this later.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={6}
          required
        />
        <motion.button
          className={styles.primary}
          type="submit"
          disabled={busy}
          whileHover={pressableFlat.whileHover}
          whileTap={pressableFlat.whileTap}
          transition={pressableFlat.transition}
        >
          {busy ? "…" : mode === "signup" ? "Create account & continue" : "Sign in & continue"}
        </motion.button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <button
        className={styles.toggle}
        type="button"
        onClick={() => { setMode((m) => (m === "signup" ? "signin" : "signup")); setError(null); }}
      >
        {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>

      <button className={styles.skip} type="button" onClick={onDone}>
        Maybe later — keep it on this device
      </button>
    </motion.div>
  );
}
