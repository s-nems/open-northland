import type { FogGhost, FogGhostMemory, SeatFogMemory, ViewerFogMemory } from '@open-northland/render';
import { SHARED_SIGHT_VIEWER } from '@open-northland/sim';
import type { HarvestState, StaticLayerMemory } from '../../map-objects/static-layer.js';

/** `[entity, placement, state]`, one held harvestable quad of {@link StaticLayerMemory.held}. */
const HELD_QUAD_FIELDS = 3;

/**
 * What the viewer remembers of the fog, part of the client memory a save keeps: each remembered seat's
 * statics and road network, and the map's static layer as the drawn seat last saw it.
 */
export interface FogMemory extends ViewerFogMemory {
  /** The world the memory was taken in. */
  readonly mapId: string | null;
  /** The saving client's local seat; a spectator keeps the fallback one. */
  readonly seat: number | null;
  readonly layer: StaticLayerMemory | null;
}

/** The fog memory `raw` holds, or null when any part is malformed: a lost memory never fails a load. */
export function fogMemoryOf(raw: unknown): FogMemory | null {
  if (!isRecord(raw)) return null;
  const { mapId, seat, memories, layer } = raw;
  if (mapId !== null && typeof mapId !== 'string') return null;
  if (seat !== null && !isCount(seat)) return null;
  if (!Array.isArray(memories)) return null;
  const seats = memories.map(seatMemoryOf);
  const layerMemory = layer === null ? null : layerOf(layer);
  if (!seats.every((memory) => memory !== undefined) || layerMemory === undefined) return null;
  return { mapId, seat, memories: seats, layer: layerMemory };
}

function seatMemoryOf(value: unknown): SeatFogMemory | undefined {
  if (!isRecord(value) || !isCounts(value.roads)) return undefined;
  const statics = staticsOf(value.statics);
  return statics === undefined ? undefined : { statics, roads: value.roads };
}

function staticsOf(value: unknown): FogGhostMemory | undefined {
  if (!isRecord(value)) return undefined;
  const { player, ghosts, reconSeeded } = value;
  if (!isViewer(player) || typeof reconSeeded !== 'boolean' || !Array.isArray(ghosts)) return undefined;
  if (!ghosts.every(isFogGhost)) return undefined;
  return { player, ghosts, reconSeeded };
}

/** A fog view's `player`: a seat, or the players' sight together. */
function isViewer(value: unknown): value is number {
  return value === SHARED_SIGHT_VIEWER || isCount(value);
}

function layerOf(value: unknown): StaticLayerMemory | undefined {
  if (!isRecord(value)) return undefined;
  const { removed, held } = value;
  if (!isCounts(removed) || !Array.isArray(held)) return undefined;
  if (!held.every(isHeldQuad)) return undefined;
  return { removed, held };
}

const GHOST_KINDS: readonly string[] = [
  'building',
  'palisade',
  'resource',
  'stump',
  'chest',
  'stockpile',
  'vehicle',
] satisfies readonly FogGhost['kind'][];
const SITE_STATES: readonly unknown[] = ['unclaimed', 'claimed'];

/** One check per {@link FogGhost} field, so a field the ghost gains must name how it reads back. */
const GHOST_FIELDS: Readonly<Record<keyof FogGhost, (value: unknown) => boolean>> = {
  ref: isCount,
  kind: (value) => typeof value === 'string' && GHOST_KINDS.includes(value),
  tileX: isFiniteNumber,
  tileY: isFiniteNumber,
  shiftX: isFiniteNumber,
  owner: isCount,
  landscapeOverlayMask: isCount,
  typeId: isFiniteNumber,
  hpFrac: isFiniteNumber,
  builtPct: isFiniteNumber,
  goodType: isFiniteNumber,
  fill: isFiniteNumber,
  level: isFiniteNumber,
  levels: isFiniteNumber,
  gfxIndex: isFiniteNumber,
  tribe: isFiniteNumber,
  palisadePosts: (value) =>
    Array.isArray(value) &&
    value.every((post) => isRecord(post) && Object.values(post).every(isFiniteNumber)),
  palisadeSite: (value) => SITE_STATES.includes(value),
  roadSite: (value) => SITE_STATES.includes(value),
  facing: isFiniteNumber,
  player: isFiniteNumber,
};

function isFogGhost(value: unknown): value is FogGhost {
  if (!isRecord(value) || !['ref', 'kind', 'tileX', 'tileY'].every((key) => key in value)) return false;
  return Object.entries(value).every(([key, field]) => {
    const check = Object.hasOwn(GHOST_FIELDS, key) ? GHOST_FIELDS[key as keyof FogGhost] : undefined;
    return check?.(field) === true;
  });
}

function isHeldQuad(value: unknown): value is [number, number, HarvestState] {
  if (!Array.isArray(value) || value.length !== HELD_QUAD_FIELDS) return false;
  const [entity, placement, state] = value as unknown[];
  return (
    isCount(entity) &&
    isCount(placement) &&
    (state === null || typeof state === 'string' || isFiniteNumber(state))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCounts(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isCount);
}
