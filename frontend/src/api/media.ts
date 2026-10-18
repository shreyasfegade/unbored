import { notFound, toMedia, withCatalog } from './catalog';

// One catalog item by composite id — powers shareable /pick/:id links.
export const getCatalogItem = (id: string) =>
  withCatalog(({ byId }) => {
    const card = byId.get(id);
    if (!card) throw notFound(`Title ${id}`);
    return toMedia(card);
  });

// Many ids at once (order preserved, unknown ids skipped).
export const getCatalogItems = (ids: string[]) =>
  withCatalog(({ byId }) => ({
    items: ids.map((id) => byId.get(id)).filter((c) => c !== undefined).map(toMedia),
  }));
