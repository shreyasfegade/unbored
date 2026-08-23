import type { MediaItem } from '../../types/media';
import PosterCard from './PosterCard';
import styles from './PosterGrid.module.css';

interface PosterGridProps {
  items: MediaItem[];
  selectedIds: string[];
  onToggle: (item: MediaItem) => void;
  maxSelections?: number;
  loading?: boolean;
}

function PosterGridSkeleton() {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className={styles.skeleton} />
      ))}
    </div>
  );
}

export default function PosterGrid({ items, selectedIds, onToggle, maxSelections = 5, loading }: PosterGridProps) {
  if (loading) {
    return <PosterGridSkeleton />;
  }

  const selected = new Set(selectedIds); // O(1) membership instead of O(n) includes
  const reachedMax = selected.size >= maxSelections;

  return (
    <div className={styles.grid}>
      {items.map((item, idx) => {
        const isSelected = selected.has(item.id);
        return (
          <PosterCard
            key={item.id}
            item={item}
            isSelected={isSelected}
            onToggle={onToggle}
            disabled={reachedMax && !isSelected}
            index={idx}
          />
        );
      })}
    </div>
  );
}
