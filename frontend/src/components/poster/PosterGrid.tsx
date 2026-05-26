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

  const reachedMax = selectedIds.length >= maxSelections;

  return (
    <div className={styles.grid}>
      {items.map((item, idx) => (
        <PosterCard
          key={item.id}
          item={item}
          isSelected={selectedIds.includes(item.id)}
          onToggle={onToggle}
          disabled={reachedMax && !selectedIds.includes(item.id)}
          index={idx}
        />
      ))}
    </div>
  );
}
