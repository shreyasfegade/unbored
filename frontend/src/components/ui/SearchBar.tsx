import { useEffect, useRef } from "react";
import styles from "./SearchBar.module.css";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading?: boolean;
  autoFocus?: boolean;
}

export function SearchBar({ value, onChange, placeholder, loading, autoFocus = false }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Opt-in, and never on phones — auto-focusing there pops the keyboard over
    // the poster grid the copy tells you to browse (and moves focus unbidden).
    if (autoFocus && window.matchMedia("(min-width: 768px)").matches) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <div className={styles.wrapper}>
      <span className={styles.icon} aria-hidden="true">
        {loading ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.2"/>
            <path d="M8 2a6 6 0 014.24 10.24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}
