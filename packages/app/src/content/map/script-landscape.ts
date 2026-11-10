import { type FootprintCell, fullStateBlockAreaCells, type TerrainMapFile } from '@open-northland/data';
import {
  LandscapePlacements,
  type LandscapeRemovalGroup,
  type ScriptLandscapeType,
  type TerrainMap,
} from '@open-northland/sim';
import { GATHERERS } from '../../game/sandbox/ids/index.js';
import { withRecordDeposit } from '../../game/sandbox/map-spawn.js';
import { resourceSpecFor } from '../../game/sandbox/place/index.js';
import type { ContentIr } from '../ir/rows.js';
import { buildCollisionTerrain } from './collision.js';
import {
  gateCounterpartName,
  OPEN_GATE_LOGIC_ID,
  playerWallRows,
  scaledWallRules,
  wallStrengthScales,
} from './palisade-rows.js';
import { forEachPlacement, PLACEMENT_STRIDE } from './placements.js';
import {
  berryBushRecordByName,
  chestKindByLogicType,
  groundGoodByObjectName,
  harvestGoodByObjectName,
} from './resources.js';

// Original behavior: each group removal matches these exact GfxLandscape EditNames. The shipped result
// reference lists FX1 with small fire and smoke and Smoke without small fire or land waves; the original
// does not.
const REMOVAL_NAMES: Readonly<Record<LandscapeRemovalGroup, readonly string[]>> = {
  blocker: ['block'],
  wave: ['fx wave', 'fx wave land'],
  fx1: ['fx fog', 'fx fog waterfall', 'fx fog waterfall00', 'fx waterfall'],
  fx2: [
    'fx fire',
    'fx fire 2',
    'fx fire house 0',
    'fx fire house 1',
    'fx fire house 2',
    'fx fire small',
    'fx smoke',
  ],
  smoke: [
    'fx smoke',
    'fx fire',
    'fx fire 2',
    'fx fire small',
    'fx wave land',
    'fx fire incense',
    'fx fog',
    'fx fog waterfall',
    'fx fog waterfall00',
    'fx waterfall',
  ],
};

export function scriptLandscapeTypes(ir: ContentIr): ScriptLandscapeType[] {
  const harvestByName = harvestGoodByObjectName(ir);
  const groundGoodByName = groundGoodByObjectName(ir);
  const chestKindByType = chestKindByLogicType(ir);
  const bushByName = berryBushRecordByName(ir);
  const wallByType = playerWallRows(ir);
  const wallScales = wallStrengthScales(ir);
  const woodGoodType = ir.goods?.find((good) => good.id === 'wood')?.typeId;
  const gfxByName = new Map(
    (ir.landscapeGfx ?? []).flatMap((row) =>
      row.editName === undefined ? [] : [[row.editName, row.index] as const],
    ),
  );
  const gatherers = new Map(GATHERERS.map((g) => [g.id, g]));
  const logicTypes = new Map((ir.landscape ?? []).map((t) => [t.typeId, t]));
  return (ir.landscapeGfx ?? []).map((g) => {
    const logic = logicTypes.get(g.logicType);
    const name = g.editName?.trim().toLowerCase() ?? '';
    const groups = (Object.keys(REMOVAL_NAMES) as LandscapeRemovalGroup[]).filter((group) =>
      REMOVAL_NAMES[group].includes(name),
    );
    const ref = g.editName === undefined ? undefined : harvestByName.get(g.editName);
    const gatherer = ref === undefined ? undefined : gatherers.get(ref.goodId);
    const chestKind = chestKindByType.get(g.logicType);
    const bush = g.editName === undefined ? undefined : bushByName.get(g.editName);
    const goodId = g.editName === undefined ? undefined : groundGoodByName.get(g.editName);
    const wall = wallByType.get(g.logicType);
    const counterpartName =
      wall === undefined ? undefined : gateCounterpartName(wall.logicId, g.editName ?? '');
    const wallScale = wallScales.get(g.index) ?? 1;
    const counterpartGfxIndex = counterpartName === undefined ? undefined : gfxByName.get(counterpartName);
    let resource: ScriptLandscapeType['resource'];
    if (gatherer !== undefined && ref !== undefined) {
      const { x: _x, y: _y, ...spec } = withRecordDeposit(resourceSpecFor(gatherer, 0, 0), ref);
      resource = { ...spec, gfxIndex: g.index };
    }
    return {
      typeId: g.index,
      walk: fullStateBlockAreaCells(g.walkBlockAreas),
      build: fullStateBlockAreaCells(g.buildBlockAreas),
      // A wall's level is its hitpoints, not a size, so a wall always blocks whole.
      ...(wall === undefined
        ? { blockAreas: { walk: g.walkBlockAreas ?? [], build: g.buildBlockAreas ?? [] } }
        : {}),
      groups,
      ...(logic?.maxValency === undefined
        ? {}
        : { maxLevel: Math.min(g.maxValency ?? logic.maxValency, logic.maxValency) }),
      ...(logic === undefined
        ? {}
        : {
            ground: {
              anywhere: logic.allowedOnEverything === true,
              land: logic.allowedOnLand === true,
              water: logic.allowedOnWater === true,
            },
          }),
      ...(g.attachAreas === undefined || g.attachAreas.length === 0
        ? {}
        : { attach: g.attachAreas.flatMap(([dx, dy, run]) => attachRun(dx, dy, run)) }),
      ...(resource === undefined ? {} : { resource }),
      ...(bush === undefined ? {} : { bush }),
      ...(chestKind === undefined ? {} : { chest: { kind: chestKind, gfxIndex: g.index } }),
      ...(goodId === undefined ? {} : { good: { goodId } }),
      ...(wall === undefined
        ? {}
        : {
            wall: {
              ...scaledWallRules(wall, wallScale),
              construction: woodGoodType === undefined ? [] : [{ goodType: woodGoodType, amount: 1 }],
              ...(counterpartGfxIndex === undefined
                ? {}
                : { gate: { open: wall.logicId === OPEN_GATE_LOGIC_ID, counterpartGfxIndex } }),
            },
          }),
    };
  });
}

function attachRun(dx: number, dy: number, run: number): FootprintCell[] {
  return Array.from({ length: Math.max(0, run) }, (_, i) => ({ dx: dx + i, dy }));
}

/** Scripted objects own their mutable collision; the base grid contains only ground classes. */
export function buildScriptLandscapeTerrain(map: TerrainMapFile, ir: ContentIr): TerrainMap {
  const { objects, ...ground } = map;
  const terrain = buildCollisionTerrain(ground, ir);
  const types = scriptLandscapeTypes(ir);
  const typeById = new Map(types.map((type) => [type.typeId, type]));
  const idByName = new Map(
    (ir.landscapeGfx ?? []).flatMap((g) =>
      g.editName === undefined ? [] : [[g.editName, g.index] as const],
    ),
  );
  const placements = new LandscapePlacements(
    objects === undefined ? 0 : Math.floor(objects.placements.length / PLACEMENT_STRIDE),
  );
  if (objects !== undefined) {
    forEachPlacement(objects.placements, (hx, hy, dictionaryId, id) => {
      const name = objects.types[dictionaryId];
      const typeId = name === undefined ? undefined : idByName.get(name);
      if (typeId === undefined) return;
      const type = typeById.get(typeId);
      const resourceBacked =
        type?.resource !== undefined ||
        type?.bush !== undefined ||
        type?.chest !== undefined ||
        type?.good !== undefined ||
        type?.wall !== undefined;
      placements.push(id, typeId, hx, hy, objects.levels?.[id] ?? 1, resourceBacked);
    });
  }
  return { ...terrain, landscapes: { types, placements } };
}
