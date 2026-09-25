import { fullStateBlockAreaCells, type TerrainMapFile } from '@open-northland/data';
import type { LandscapeRemovalGroup, ScriptLandscapeType, TerrainMap } from '@open-northland/sim';
import { GATHERERS } from '../game/sandbox/ids/index.js';
import { withRecordDeposit } from '../game/sandbox/map-spawn.js';
import { resourceSpecFor } from '../game/sandbox/place/index.js';
import { buildCollisionTerrain } from './collision.js';
import type { ContentIr } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';
import {
  BUSH_WITH_FRUITS_LOGIC_TYPE,
  chestKindByLogicType,
  groundGoodByObjectName,
  harvestGoodByObjectName,
} from './map-resources.js';
import { CLOSED_GATE_LOGIC_ID, OPEN_GATE_LOGIC_ID, playerWallRows } from './palisade-rows.js';

// Shipped result reference memberships, with its spacing typos resolved to actual GfxLandscape EditNames.
const REMOVAL_NAMES: Readonly<Record<LandscapeRemovalGroup, readonly string[]>> = {
  blocker: ['block'],
  wave: ['fx wave', 'fx wave land'],
  fx1: ['fx fire small', 'fx smoke', 'fx fog', 'fx fog waterfall', 'fx fog waterfall00', 'fx waterfall'],
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
  const wallByType = playerWallRows(ir);
  const woodGoodType = ir.goods?.find((good) => good.id === 'wood')?.typeId;
  const gfxByName = new Map(
    (ir.landscapeGfx ?? []).flatMap((row) =>
      row.editName === undefined ? [] : [[row.editName, row.index] as const],
    ),
  );
  const gatherers = new Map(GATHERERS.map((g) => [g.id, g]));
  return (ir.landscapeGfx ?? []).map((g) => {
    const name = g.editName?.trim().toLowerCase() ?? '';
    const groups = (Object.keys(REMOVAL_NAMES) as LandscapeRemovalGroup[]).filter((group) =>
      REMOVAL_NAMES[group].includes(name),
    );
    const ref = g.editName === undefined ? undefined : harvestByName.get(g.editName);
    const gatherer = ref === undefined ? undefined : gatherers.get(ref.goodId);
    const chestKind = chestKindByType.get(g.logicType);
    const goodId = g.editName === undefined ? undefined : groundGoodByName.get(g.editName);
    const wall = wallByType.get(g.logicType);
    const counterpartName =
      wall?.logicId === CLOSED_GATE_LOGIC_ID
        ? `${g.editName ?? ''}_open`
        : wall?.logicId === OPEN_GATE_LOGIC_ID
          ? (g.editName ?? '').replace(/_open$/, '')
          : undefined;
    const counterpartGfxIndex = counterpartName === undefined ? undefined : gfxByName.get(counterpartName);
    let resource: ScriptLandscapeType['resource'];
    if (gatherer !== undefined && ref !== undefined) {
      const {
        x: _x,
        y: _y,
        ...spec
      } = withRecordDeposit(resourceSpecFor(gatherer, 0, 0), {
        ...ref,
        hx: 0,
        hy: 0,
        placement: 0,
      });
      resource = { ...spec, gfxIndex: g.index };
    }
    return {
      typeId: g.index,
      walk: fullStateBlockAreaCells(g.walkBlockAreas),
      build: fullStateBlockAreaCells(g.buildBlockAreas),
      groups,
      ...(resource === undefined ? {} : { resource }),
      ...(g.logicType === BUSH_WITH_FRUITS_LOGIC_TYPE ? { bushGfxIndex: g.index } : {}),
      ...(chestKind === undefined ? {} : { chest: { kind: chestKind, gfxIndex: g.index } }),
      ...(goodId === undefined ? {} : { good: { goodId } }),
      ...(wall === undefined
        ? {}
        : {
            wall: {
              logicType: g.logicType,
              maxHitpoints: wall.maxHitpoints,
              repairPerStrike: wall.repairPerStrike,
              construction: woodGoodType === undefined ? [] : [{ goodType: woodGoodType, amount: 1 }],
              ...(counterpartGfxIndex === undefined
                ? {}
                : { gate: { open: wall.logicId === OPEN_GATE_LOGIC_ID, counterpartGfxIndex } }),
            },
          }),
    };
  });
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
  const placements: NonNullable<TerrainMap['landscapes']>['placements'][number][] = [];
  if (objects !== undefined) {
    forEachPlacement(objects.placements, (hx, hy, dictionaryId, id) => {
      const name = objects.types[dictionaryId];
      const typeId = name === undefined ? undefined : idByName.get(name);
      if (typeId === undefined) return;
      const type = typeById.get(typeId);
      placements.push({
        id,
        typeId,
        hx,
        hy,
        level: objects.levels?.[id] ?? 1,
        ...(type?.resource !== undefined ||
        type?.bushGfxIndex !== undefined ||
        type?.chest !== undefined ||
        type?.good !== undefined ||
        type?.wall !== undefined
          ? { resourceBacked: true }
          : {}),
      });
    });
  }
  const landVertices = landVertexMask(map, ir);
  return {
    ...terrain,
    landscapes: { types, placements },
    ...(landVertices === undefined ? {} : { landVertices }),
  };
}

/** Approximation: both source triangles must be known dry land before their 2×2 nodes receive land-only tint. */
function landVertexMask(map: TerrainMapFile, ir: ContentIr): boolean[] | undefined {
  if (map.ground === undefined) return undefined;
  const waterByType = new Map((ir.trianglePatternTypes ?? []).map((t) => [t.type, t.isWater]));
  const typeByName = new Map((ir.gfxPatterns ?? []).map((p) => [p.editName, p.logicType]));
  const dry = map.ground.patterns.map((name) => {
    const type = typeByName.get(name);
    return type !== undefined && waterByType.get(type) === false;
  });
  const width = map.width * 2;
  const mask = new Array<boolean>(width * map.height * 2).fill(false);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = y * map.width + x;
      const a = map.ground.a[cell];
      const b = map.ground.b[cell];
      if (a === undefined || b === undefined || !dry[a] || !dry[b]) continue;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) mask[(2 * y + dy) * width + 2 * x + dx] = true;
    }
  }
  return mask;
}
