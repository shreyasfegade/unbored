/**
 * Cache-busting stamp for catalog-derived responses.
 *
 * These endpoints were once served as `immutable` for a day, so browsers that
 * saw the old catalog will not revalidate them — a reload doesn't help, and a
 * rebuilt catalog would stay invisible for 24 hours. Sending a version the old
 * entries never carried makes those requests miss the stale cache entirely.
 *
 * Bump this whenever the catalog is rebuilt.
 */
export const CATALOG_VERSION = '3';
