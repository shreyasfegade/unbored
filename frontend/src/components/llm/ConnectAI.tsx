import { useState } from "react";
import { motion } from "framer-motion";
import { useLlmStore, type LlmProvider } from "../../stores/llmStore";
import { validateKey } from "../../api/llm";
import styles from "./ConnectAI.module.css";

interface ConnectAIProps {
  onConnected?: () => void;
  onSkip?: () => void;
  variant?: "onboarding" | "settings";
}

const PROVIDERS: { id: LlmProvider; label: string; help: string; url: string; free?: boolean }[] = [
  { id: "gemini", label: "Google Gemini", help: "Free key in ~30s", url: "https://aistudio.google.com/app/apikey", free: true },
  { id: "deepseek", label: "DeepSeek", help: "Low-cost, powerful", url: "https://platform.deepseek.com/api_keys" },
];

export default function ConnectAI({ onConnected, onSkip, variant = "onboarding" }: ConnectAIProps) {
  const connected = useLlmStore((s) => s.validated);
  const savedProvider = useLlmStore((s) => s.provider);
  const setKey = useLlmStore((s) => s.setKey);
  const clear = useLlmStore((s) => s.clear);

  const [provider, setProvider] = useState<LlmProvider>(savedProvider ?? "gemini");
  const [key, setKeyInput] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const active = PROVIDERS.find((p) => p.id === provider)!;

  const handleConnect = async () => {
    if (!key.trim()) return;
    setStatus("validating");
    setError(null);
    try {
      const res = await validateKey(provider, key.trim());
      if (res.ok) {
        setKey(provider, key.trim());
        setKeyInput("");
        setStatus("idle");
        onConnected?.();
      } else {
        setStatus("error");
        setError(res.error || "That key didn't work. Double-check and try again.");
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the validator. Check your connection and try again.");
    }
  };

  if (connected && variant === "settings") {
    return (
      <div className={styles.connectedCard}>
        <div className={styles.connectedRow}>
          <span className={styles.connectedDot} />
          <div>
            <p className={styles.connectedLabel}>AI connected</p>
            <p className={styles.connectedSub}>Picks reasoned by {savedProvider}</p>
          </div>
        </div>
        <button className={styles.disconnect} onClick={clear}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className={variant === "onboarding" ? styles.onboarding : styles.settings}>
      <div className={styles.providers}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`${styles.provider} ${provider === p.id ? styles.providerActive : ""}`}
            onClick={() => { setProvider(p.id); setStatus("idle"); setError(null); }}
          >
            <span className={styles.providerName}>{p.label}</span>
            <span className={styles.providerHelp}>{p.free ? "Free" : p.help}</span>
          </button>
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="password"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Paste your ${active.label} API key`}
          value={key}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
        />
        <motion.button
          className={styles.connect}
          disabled={!key.trim() || status === "validating"}
          onClick={handleConnect}
          whileTap={{ scale: 0.97 }}
        >
          {status === "validating" ? "Checking…" : "Connect"}
        </motion.button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.hint}>
        Don't have one?{" "}
        <a href={active.url} target="_blank" rel="noopener noreferrer">
          Get a {active.label} key →
        </a>{" "}
        It stays in your browser, never on our servers.
      </p>

      {onSkip && (
        <button className={styles.skip} onClick={onSkip}>
          Skip for now — use the built-in engine
        </button>
      )}
    </div>
  );
}
