import type { BrightnessField, ElevationField, MapObjectSprite } from '@open-northland/render';
import type { MissionScript, ScriptLandscapePlacement } from '@open-northland/sim';
import type { ContentIr } from './ir/rows.js';
import { loadMapObjects } from './objects.js';

export type ScriptLandscapeSprite = (placement: ScriptLandscapePlacement) => MapObjectSprite | undefined;

function spriteKey(typeId: number, hx: number, hy: number, level: number): string {
  return `${typeId},${hx},${hy},${level}`;
}

/** Script coordinates are immutable, so their atlas and placement joins can finish before the first tick. */
export async function loadScriptLandscapeSprites(
  script: MissionScript,
  ir: ContentIr,
  elevation: ElevationField,
  brightness: BrightnessField,
  loadObjects: typeof loadMapObjects = loadMapObjects,
): Promise<ScriptLandscapeSprite> {
  const records = new Map((ir.landscapeGfx ?? []).map((row) => [row.index, row]));
  const keys: string[] = [];
  const unique = new Set<string>();
  const types: string[] = [];
  const placements: number[] = [];
  const levels: number[] = [];
  for (const mission of script.missions) {
    for (const op of mission.results) {
      if (op.opcode !== 'SetLandscape') continue;
      const record = records.get(op.landscape);
      if (record?.editName === undefined || (record.frames?.length ?? 0) === 0) continue;
      const key = spriteKey(op.landscape, op.point.hx, op.point.hy, op.level);
      if (unique.has(key)) continue;
      unique.add(key);
      placements.push(op.point.hx, op.point.hy, types.length);
      types.push(record.editName);
      levels.push(op.level);
      keys.push(key);
    }
  }
  const loaded = await loadObjects({ types, placements, levels }, ir, elevation, brightness);
  const templates = new Map<string, MapObjectSprite>();
  for (const [index, sprite] of loaded.byPlacement) {
    const key = keys[index];
    if (key !== undefined) templates.set(key, sprite);
  }
  return (placement) => {
    const template = templates.get(spriteKey(placement.typeId, placement.hx, placement.hy, placement.level));
    return template === undefined ? undefined : { ...template };
  };
}
