import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "../stores/authStore";
import { useToastStore } from "../stores/toastStore";
import { useSyncStore } from "../stores/syncStore";
import styles from "./AccountPage.module.css";

type Mode = "signin" | "signup";

export default function AccountPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { ready, user, configured, signIn, signUp, signOut } = useAuthStore();
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fn = mode === "signin" ? signIn : signUp;
    const { error: err } = await fn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    addToast(mode === "signin" ? "Signed in — your taste will sync." : "Account created — you're signed in.");
  };

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>
      <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        Account
      </motion.h1>

      {!configured ? (
        <p className={styles.subtitle}>
          Accounts aren&rsquo;t set up on this deployment. Everything still works —
          your taste and library live in this browser.
        </p>
      ) : !ready ? (
        <div className={styles.skeleton} aria-label="Checking your session" />
      ) : user ? (
        <>
          <p className={styles.subtitle}>
            Signed in as <strong>{user.email}</strong>. Your taste, library and
            settings sync to this account.
          </p>
          <div className={styles.syncRow}>
            <span className={`${styles.syncDot} ${styles[`sync_${status}`] ?? ""}`} />
            <span className={styles.syncText}>
              {status === "syncing" && "Syncing…"}
              {status === "synced" && (lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}` : "Synced")}
              {status === "error" && "Not synced — will retry"}
              {status === "idle" && "Up to date"}
            </span>
          </div>
          <button
            className={styles.secondary}
            onClick={async () => { await signOut(); addToast("Signed out. Your data stays on this device."); }}
          >
            Sign out
          </button>
          <p className={styles.hint}>Signing out leaves everything on this device.</p>
        </>
      ) : (
        <>
          <p className={styles.subtitle}>
            Optional. Sign in to use Unbored on your phone too, and to join watch
            rooms as yourself. Your taste stays yours.
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
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
            <button className={styles.primary} type="submit" disabled={busy}>
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button
            className={styles.toggle}
            onClick={() => { setMode((m) => (m === "signin" ? "signup" : "signin")); setError(null); }}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
