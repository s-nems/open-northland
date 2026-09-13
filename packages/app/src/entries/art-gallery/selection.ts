import type { GalleryEntry } from './catalog.js';
import type { GalleryState, GalleryTab } from './state.js';

export function tabOf(entry: GalleryEntry): GalleryTab {
  if (entry.kind === 'good') return 'goods';
  return entry.kind === 'character' ? 'animations' : entry.kind === 'building' ? 'buildings' : 'terrain';
}

export function gallerySelection(entries: readonly GalleryEntry[], state: GalleryState) {
  const selected = state.asset
    ? entries.find((entry) => entry.id === state.asset && tabOf(entry) === state.tab)
    : entries.find(
        (entry) =>
          tabOf(entry) === state.tab &&
          `${entry.name} ${entry.id}`.toLowerCase().includes(state.q.toLowerCase()) &&
          (state.tab !== 'terrain' || state.terrainKind === 'all' || entry.kind === state.terrainKind),
      );
  const compared = state.compare.flatMap((id) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry && entry.id !== selected?.id && tabOf(entry) === state.tab ? [entry] : [];
  });
  const missing = state.compare.filter((id) => !entries.some((entry) => entry.id === id));
  return { selected, compared, missing };
}
