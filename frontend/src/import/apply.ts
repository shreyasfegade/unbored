import { useLibraryStore } from "../stores/libraryStore";
import { useTasteStore } from "../stores/tasteStore";
import type { ImportPlan } from "./plan";

/** Save an import in one write per store. Verdicts the person already gave by
 *  hand win over the file: an imported "seen" won't undo their "not for me". */
export function applyImport(plan: ImportPlan): void {
  useTasteStore.getState().addFavouriteIds(plan.favourites.map((m) => m.id));
  useLibraryStore.setState((s) => {
    const notInterested = new Set(s.notInterested);
    const seen = new Set(s.seen);
    for (const m of plan.notInterested) if (!seen.has(m.id)) notInterested.add(m.id);
    for (const m of plan.seen) if (!notInterested.has(m.id)) seen.add(m.id);
    return { seen: [...seen], notInterested: [...notInterested] };
  });
}
