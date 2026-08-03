import {
  clipDirs,
  GALLERY_DIRS,
  type GalleryCellSpec,
  type GalleryClip,
  type GalleryDirection,
  type SpriteAtlas,
  type SpriteLayer,
} from '@open-northland/render';
import { characterLabel, headLabel, pickWalkRow, type VikingCharacter } from '../catalog/roster.js';
import type { BobSeqRow } from '../content/ir/rows.js';

/**
 * The browser-free data half of the `?anim` gallery: every function is pure over the loaded layers as
 * data, so the montage assembly and URL parsing run without a GPU.
 */

/** The base sequence whose head the empty-headed carry variants borrow. */
const WALK_SEQ = 'human_man_generic_walk';

/** Play every sequence, the walk once per head look, or the walk once per player colour. */
export type GalleryView = 'anim' | 'heads' | 'colors';

export function parseView(raw: string | null): GalleryView {
  if (raw === 'heads' || raw === 'looks') return 'heads';
  if (raw === 'colors' || raw === 'colours') return 'colors';
  return 'anim';
}

/** `?color=` selects a player-colour row; `null` keeps the un-recoloured baked look. */
export function parseColor(raw: string | null, count: number): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

export function parseDirection(raw: string | null): GalleryDirection {
  if (raw === null || raw === 'full' || raw === 'all') return 'full';
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < GALLERY_DIRS ? n : 'full';
}

/** Cosmetic only: the raw `[bobseq]` name still uniquely identifies the sequence. */
export function prettyClipLabel(name: string): string {
  return name
    .replace(/^human_(man|woman|child_boy|child_girl|child_baby)_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function clipFromRow(row: BobSeqRow): GalleryClip {
  return {
    label: prettyClipLabel(row.name),
    start: row.start,
    length: row.length,
    dirs: clipDirs(row.length),
  };
}

/**
 * A walk-layout carry variant whose own head bob is empty borrows the base walk head instead of being
 * drawn headless. The walk row is resolved from the unfiltered rows, so a `filter` still finds it.
 */
export function buildGalleryClips(
  rows: readonly BobSeqRow[],
  headAtlas: SpriteAtlas | undefined,
  filter = '',
): GalleryClip[] {
  const walkRow = rows.find((r) => r.name === WALK_SEQ);
  const headEmptyAt = (start: number): boolean => {
    const f = headAtlas?.frames.get(start);
    return f === undefined || f.width === 0 || f.height === 0;
  };
  const needle = filter.toLowerCase();
  return rows
    .filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
    .map((r) => {
      const base: GalleryClip = clipFromRow(r);
      if (
        walkRow !== undefined &&
        r.name !== WALK_SEQ &&
        r.length === walkRow.length &&
        headEmptyAt(r.start)
      ) {
        return { ...base, headStart: walkRow.start };
      }
      return base;
    });
}

export function buildAnimCells(
  rows: readonly BobSeqRow[],
  body: SpriteLayer,
  defaultHead: SpriteLayer | undefined,
  filter = '',
): GalleryCellSpec[] {
  const clips = buildGalleryClips(rows, defaultHead?.atlas, filter);
  const overlays = defaultHead !== undefined ? [defaultHead] : [];
  return clips.map((clip) => ({ clip, body, overlays }));
}

/** `heads[i]` lines up with `char.headBmds[i]`; `[]` when the body has no playable walk. */
export function buildHeadsCells(
  char: VikingCharacter,
  rows: readonly BobSeqRow[],
  body: SpriteLayer,
  heads: readonly (SpriteLayer | undefined)[],
  filter = '',
): GalleryCellSpec[] {
  const walkRow = pickWalkRow(rows);
  if (walkRow === undefined) return [];
  const walkClip = clipFromRow(walkRow);
  const needle = filter.toLowerCase();
  if (char.headBmds.length === 0) {
    const label = characterLabel(char);
    // Body-only creature (the baby): a single bare cell so the view isn't empty.
    return needle === '' || label.toLowerCase().includes(needle)
      ? [{ clip: walkClip, body, overlays: [], label }]
      : [];
  }
  const cells: GalleryCellSpec[] = [];
  for (let i = 0; i < char.headBmds.length; i++) {
    const bmd = char.headBmds[i];
    const layer = heads[i];
    if (bmd === undefined || layer === undefined) continue;
    const label = headLabel(bmd);
    if (needle !== '' && !label.toLowerCase().includes(needle) && !bmd.toLowerCase().includes(needle)) {
      continue;
    }
    cells.push({ clip: walkClip, body, overlays: [layer], label });
  }
  return cells;
}

/** `colorNames[i]` is player `i`; `[]` when the body has no playable walk. */
export function buildColorCells(
  rows: readonly BobSeqRow[],
  body: SpriteLayer,
  defaultHead: SpriteLayer | undefined,
  colorNames: readonly string[],
  filter = '',
): GalleryCellSpec[] {
  const walkRow = pickWalkRow(rows);
  if (walkRow === undefined) return [];
  const walkClip = clipFromRow(walkRow);
  const overlays = defaultHead !== undefined ? [defaultHead] : [];
  const needle = filter.toLowerCase();
  const cells: GalleryCellSpec[] = [];
  for (let i = 0; i < colorNames.length; i++) {
    const label = colorNames[i] ?? String(i);
    if (needle !== '' && !label.toLowerCase().includes(needle)) continue;
    cells.push({ clip: walkClip, body, overlays, label, player: i });
  }
  return cells;
}

/** `heads[i]` lines up with `char.headBmds[i]`. */
export interface RosterLoad {
  readonly char: VikingCharacter;
  readonly body: SpriteLayer;
  readonly heads: readonly (SpriteLayer | undefined)[];
  readonly rows: readonly BobSeqRow[];
}

export function buildRosterCells(loaded: readonly RosterLoad[], filter = ''): GalleryCellSpec[] {
  const needle = filter.toLowerCase();
  const cells: GalleryCellSpec[] = [];
  for (const { char, body, heads, rows } of loaded) {
    const walkRow = pickWalkRow(rows);
    if (walkRow === undefined) continue;
    const walkClip = clipFromRow(walkRow);
    if (char.headBmds.length === 0) {
      const label = characterLabel(char);
      // Body-only creature (the baby): one bare cell, no head overlay.
      if (needle === '' || label.toLowerCase().includes(needle)) {
        cells.push({ clip: walkClip, body, overlays: [], label });
      }
      continue;
    }
    for (let i = 0; i < char.headBmds.length; i++) {
      const layer = heads[i];
      const bmd = char.headBmds[i];
      if (layer === undefined || bmd === undefined) continue;
      const label = rosterLabel(char, bmd);
      if (needle !== '' && !label.toLowerCase().includes(needle)) continue;
      cells.push({ clip: walkClip, body, overlays: [layer], label });
    }
  }
  return cells;
}

export function rosterLabel(char: VikingCharacter, headBmd: string): string {
  const label = characterLabel(char);
  if (char.headBmds.length < 2) return label;
  const m = /_(\d+)$/.exec(headBmd);
  return m !== null ? `${label} ${m[1]}` : label;
}
