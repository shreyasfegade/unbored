import { searchCatalog } from '../engine/search';
import { toMedia, withCatalog } from './catalog';

/** Search the catalog: title, original title, keywords, genres, typos. */
export const searchMulti = (query: string, type?: string) =>
  withCatalog(({ cards }) => {
    const q = query.slice(0, 100);
    if (!q.trim()) return { results: [], total_results: 0, query };
    const { results, total } = searchCatalog(cards, q, type);
    return { results: results.map(toMedia), total_results: total, query };
  });
