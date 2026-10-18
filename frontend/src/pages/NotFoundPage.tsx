import { Link, useLocation } from "react-router-dom";
import styles from "./NotFoundPage.module.css";

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className={styles.page}>
      <span className={styles.kicker}>404 · Reel not found</span>
      <h1 className={styles.heading}>Nothing&rsquo;s playing here</h1>
      <p className={styles.copy}>
        <code className={styles.path}>{pathname}</code> isn&rsquo;t a page in Unbored. The link may be
        old, or mistyped.
      </p>
      <div className={styles.actions}>
        <Link to="/" className={styles.primary}>Get a pick</Link>
        <Link to="/browse" className={styles.secondary}>Browse the catalog</Link>
      </div>
    </div>
  );
}
