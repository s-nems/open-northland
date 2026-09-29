import type { WeatherMode } from '@open-northland/lockstep';
import type { SceneTerrain } from '@open-northland/render';
import {
  AMBIENT_NO_WEATHER,
  type AmbientSectors,
  WEATHER_KINDS,
  WEATHER_SECTOR_NODES,
  type WeatherKind,
} from '@open-northland/render/data';

// The game's own weather for a match: which kind falls where, read off the ground. An OpenNorthland
// addition; where a map writes weather itself, by rectangle or by script, the map's weather stands.

export interface AmbientWeather {
  /** The match seed: every new game draws another schedule. */
  readonly seed: number;
  readonly mode: WeatherMode;
  readonly sectors: AmbientSectors;
}

interface GroundPatternRow {
  readonly editName?: string | undefined;
  readonly editGroups?: readonly string[] | undefined;
}

/** The ground pattern edit groups that name a biome. */
const WATER_GROUP = 'water all';
const SNOW_GROUPS: readonly string[] = ['snow all', 'ice all'];
const DESERT_GROUPS: readonly string[] = ['desertStone all', 'desertBrown all'];
/** Sand is a beach on a green map and open desert on a desert one. */
const SAND_GROUP = 'sand all';
/** Land share of sand and desert ground from which a map's sand counts as desert. Approximation. */
const DESERT_MAP_LAND_SHARE = 0.3;

type Ground = 'water' | WeatherKind;

/** Approximation: every land that is not snow, ice or desert is rained on, rock and swamp included. */
function groundOf(groups: readonly string[]): Ground {
  if (groups.includes(WATER_GROUP)) return 'water';
  if (SNOW_GROUPS.some((g) => groups.includes(g))) return 'snow';
  if (DESERT_GROUPS.some((g) => groups.includes(g))) return 'sand';
  if (groups.includes(SAND_GROUP)) return 'sand';
  return 'rain';
}

const isBeachSand = (groups: readonly string[]): boolean =>
  groups.includes(SAND_GROUP) && !DESERT_GROUPS.some((g) => groups.includes(g));

/** Null when the map carries no ground to read a biome from. */
export function ambientWeatherFor(
  terrain: SceneTerrain,
  patterns: readonly GroundPatternRow[],
  seed: number,
  mode: WeatherMode,
): AmbientWeather | null {
  const ground = terrain.ground;
  if (ground === undefined) return null;
  const rowByName = new Map(patterns.map((row) => [row.editName, row.editGroups ?? []]));
  const groups = ground.patterns.map((name) => rowByName.get(name) ?? []);
  const kinds = groups.map(groundOf);
  const beach = groups.map(isBeachSand);

  const sectorsX = Math.max(1, Math.ceil((terrain.width * 2) / WEATHER_SECTOR_NODES));
  const sectorsY = Math.max(1, Math.ceil((terrain.height * 2) / WEATHER_SECTOR_NODES));
  const kindCount = WEATHER_KINDS.length;
  const beachSlot = kindCount;
  const slots = kindCount + 1;
  const counts = new Uint32Array(sectorsX * sectorsY * slots);
  const total = new Uint32Array(slots);
  const count = (sector: number, dictIndex: number | undefined): void => {
    if (dictIndex === undefined) return;
    const kind = kinds[dictIndex];
    if (kind === undefined || kind === 'water') return;
    const slot = beach[dictIndex] === true ? beachSlot : WEATHER_KINDS.indexOf(kind);
    counts[sector * slots + slot] = (counts[sector * slots + slot] ?? 0) + 1;
    total[slot] = (total[slot] ?? 0) + 1;
  };
  for (let row = 0; row < terrain.height; row++) {
    const sy = Math.min(sectorsY - 1, Math.floor((row * 2) / WEATHER_SECTOR_NODES));
    for (let col = 0; col < terrain.width; col++) {
      const sx = Math.min(sectorsX - 1, Math.floor((col * 2 + (row & 1)) / WEATHER_SECTOR_NODES));
      const cell = row * terrain.width + col;
      count(sy * sectorsX + sx, ground.a[cell]);
      count(sy * sectorsX + sx, ground.b[cell]);
    }
  }

  const sand = WEATHER_KINDS.indexOf('sand');
  const rain = WEATHER_KINDS.indexOf('rain');
  const land = total.reduce((sum, n) => sum + n, 0);
  if (land === 0) return null;
  const desertMap = ((total[sand] ?? 0) + (total[beachSlot] ?? 0)) / land >= DESERT_MAP_LAND_SHARE;
  const beachAs = desertMap ? sand : rain;
  const majority = (at: (slot: number) => number): number => {
    const tally = new Array<number>(kindCount).fill(0);
    for (let slot = 0; slot < slots; slot++) {
      const k = slot === beachSlot ? beachAs : slot;
      tally[k] = (tally[k] ?? 0) + at(slot);
    }
    let best = AMBIENT_NO_WEATHER;
    let bestCount = 0;
    for (const [k, n] of tally.entries()) {
      if (n > bestCount) {
        best = k;
        bestCount = n;
      }
    }
    return best;
  };
  // Open water takes the map's own kind, so rain or snow does not stop at the shore.
  const mapKind = majority((slot) => total[slot] ?? 0);
  const sectorKinds = new Uint8Array(sectorsX * sectorsY);
  for (let sector = 0; sector < sectorKinds.length; sector++) {
    const kind = majority((slot) => counts[sector * slots + slot] ?? 0);
    sectorKinds[sector] = kind === AMBIENT_NO_WEATHER ? mapKind : kind;
  }
  return {
    seed,
    mode,
    sectors: { sectorsX, sectorsY, kinds: sectorKinds },
  };
}
