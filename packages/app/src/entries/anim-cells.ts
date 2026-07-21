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
 * The browser-free data half of the `?anim` gallery ({@link import('./anim.js')}): turn decoded `[bobseq]`
 * rows into the {@link GalleryCellSpec}s the retained {@link import('@open-northland/render').AnimationGallery}
 * draws, and parse the gallery's URL knobs. Every function here is pure over its inputs (the loaded layers
 * as data), so the montage assembly + URL parsing are unit-tested without a GPU
 * (`packages/app/test/anim-gallery.test.ts`). The Pixi loop, atlas loading and DOM panel live in
 * `anim.ts` / `anim-overlay.ts`.
 */

/** The base locomotion sequence whose head the empty-headed carry variants borrow (see clip build). */
const WALK_SEQ = 'human_man_generic_walk';

/**
 * The gallery layouts: play every sequence (`anim`), play the walk once per head look (`heads`), or play
 * the walk once per player colour (`colors` — the team-colour montage).
 */
export type GalleryView = 'anim' | 'heads' | 'colors';

/**
 * Parse `?view=` — `heads`/`looks` → the looks montage, `colors`/`colours` → the player-colour
 * montage, anything else (incl. absent) → the animation view.
 */
export function parseView(raw: string | null): GalleryView {
  if (raw === 'heads' || raw === 'looks') return 'heads';
  if (raw === 'colors' || raw === 'colours') return 'colors';
  return 'anim';
}

/**
 * Parse `?color=` — an integer player-colour row `0..count-1` selects that colour for the anim/heads views;
 * absent or out of range → `null` (the un-recoloured baked look).
 */
export function parseColor(raw: string | null, count: number): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

/** Parse `?dir=` — `full`/absent → `'full'`, an integer `0..GALLERY_DIRS-1` → that block, else → `'full'`. */
export function parseDirection(raw: string | null): GalleryDirection {
  if (raw === null || raw === 'full' || raw === 'all') return 'full';
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < GALLERY_DIRS ? n : 'full';
}

/**
 * A readable label for a raw `[bobseq]` name: drop the `human_<species>_` prefix and turn the
 * `snake_case`/`CamelCase` remainder into spaced words (`human_man_Warrior_Broadsword_attack` → "Warrior
 * Broadsword attack"). Purely cosmetic — the raw name still uniquely identifies the sequence.
 */
export function prettyClipLabel(name: string): string {
  return name
    .replace(/^human_(man|woman|child_boy|child_girl|child_baby)_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

/** Turn one decoded `[bobseq]` row into a {@link GalleryClip} (its direction count from {@link clipDirs}). */
function clipFromRow(row: BobSeqRow): GalleryClip {
  return {
    label: prettyClipLabel(row.name),
    start: row.start,
    length: row.length,
    dirs: clipDirs(row.length),
  };
}

/**
 * Turn the decoded `[bobseq]` rows into {@link GalleryClip}s. Each clip gets its {@link clipDirs} direction
 * count; a `filter` substring narrows by name. The head fallback: a walk-layout carry variant
 * (`length === walk.length`, not walk itself) whose own head bob is empty (`headAtlas` has no non-zero
 * frame at its start) borrows the base `human_man_generic_walk` head, so it isn't drawn headless (the head
 * faces the walk heading while the body carries the load). `walkRow` is resolved from the unfiltered rows,
 * so `?filter=bread` still finds the walk head to borrow. Pure (given the head atlas as data).
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

/**
 * The cells for the animation view: every sequence of the body, each drawn with the character's default
 * head (`heads[0]`). Pure over the loaded layers — the join of {@link buildGalleryClips} with the shared
 * (body, head).
 */
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

/**
 * The cells for the heads view: the plain walk ({@link pickWalkRow}) played once per head look, each cell
 * captioned by its head. `heads[i]` lines up with `headBmds[i]` (both in roster/stem order). A `filter`
 * narrows by head label or bmd name. Returns `[]` when the body has no playable clip. Pure over the loaded
 * layers.
 */
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

/**
 * The cells for the colours view: the plain walk ({@link pickWalkRow}) played once per player colour, each
 * cell captioned by its colour name and tagged with its {@link GalleryCellSpec.player} row (so the paletted
 * gallery reads it through that LUT row). `colorNames[i]` is player `i`. A `filter` narrows by colour name.
 * Returns `[]` when the body has no playable walk. Pure over the loaded layers.
 */
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

/** One character's loaded layers + `[bobseq]` rows — the input {@link buildRosterCells} joins into cells. */
export interface RosterLoad {
  readonly char: VikingCharacter;
  readonly body: SpriteLayer;
  readonly heads: readonly (SpriteLayer | undefined)[];
  readonly rows: readonly BobSeqRow[];
}

/**
 * The roster montage's cells: for each loaded character, its plain walk ({@link pickWalkRow}) played once
 * per head look, captioned {@link rosterLabel}. `heads[i]` lines up with `char.headBmds[i]`. A `filter`
 * narrows by caption. Pure over the loaded layers.
 */
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
      if (layer === undefined || bmd === undefined) continue; // a listed head that failed to load — skip
      const label = rosterLabel(char, bmd);
      if (needle !== '' && !label.toLowerCase().includes(needle)) continue;
      cells.push({ clip: walkClip, body, overlays: [layer], label });
    }
  }
  return cells;
}

/** A compact roster caption: the character label, plus the head index when the body has several looks. */
export function rosterLabel(char: VikingCharacter, headBmd: string): string {
  const label = characterLabel(char);
  if (char.headBmds.length < 2) return label;
  const m = /_(\d+)$/.exec(headBmd);
  return m !== null ? `${label} ${m[1]}` : label;
}
