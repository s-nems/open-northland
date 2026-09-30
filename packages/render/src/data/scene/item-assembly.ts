import { type EntitySnapshot, systems, type WorldSnapshot } from '@open-northland/sim';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';
import {
  assignBerryBushFields,
  assignBuildingFields,
  assignProjectileArc,
  assignSettlerFields,
  assignStockpileFields,
  pushSignpostItems,
} from './collect-fields.js';
import { spriteDepth } from './depth.js';
import type { EntityKind, MutableSpriteDrawItem } from './draw-item.js';
import { assignPalisadeFields, type PalisadeLayout } from './palisade-connections.js';
import type { SettlerPose } from './settler-pose.js';
import {
  assignStaticFields,
  readRoadSiteClaimed,
  readVehicleDriver,
  readVehicleFields,
} from './snapshot-readers/index.js';

export interface SceneBuild {
  readonly snapshot: WorldSnapshot;
  readonly items: MutableSpriteDrawItem[];
  readonly collected: Set<number>;
  readonly posByRef: ReadonlyMap<number, { x: number; y: number }>;
  readonly elevation: ElevationField | undefined;
  readonly playerColourOf: ((player: number) => number) | undefined;
  readonly palisades: PalisadeLayout;
}

export function assembleItem(
  build: SceneBuild,
  entity: EntitySnapshot,
  kind: EntityKind,
  tileX: number,
  tileY: number,
  screen: { x: number; y: number },
  pose: SettlerPose,
): MutableSpriteDrawItem {
  const { components } = entity;
  // Read here, not in the stockpile branch below, so it folds into the depth key.
  const isFlag = 'DeliveryFlag' in components;
  const lift = terrainLiftAt(build.elevation, tileX, tileY);
  // A projectile's ballistic height rides the same lift channel as terrain lift: a draw offset the
  // depth key never sees, so neither can reshuffle occlusion.
  let arcLift = 0;
  const item: MutableSpriteDrawItem = {
    kind,
    ref: entity.id,
    x: screen.x,
    y: screen.y,
    depth: spriteDepth(tileX, tileY, kind, isFlag),
    state: pose.state,
  };
  switch (kind) {
    case 'settler':
      assignSettlerFields(item, components, pose.actingAtomic, pose.targetFacing, build.snapshot.tick);
      break;
    case 'vehicle':
      readVehicleFields(item, components); // its `state` came with the pose
      readVehicleDriver(item, components, build.snapshot);
      break;
    case 'building':
      assignBuildingFields(item, components);
      break;
    case 'palisade':
      item.x += assignPalisadeFields(item, entity.id, components, build.palisades);
      break;
    case 'roadsite':
      item.roadSite = readRoadSiteClaimed(components) ? 'claimed' : 'unclaimed';
      if (item.roadSite === 'unclaimed') item.depth = spriteDepth(tileX, tileY, kind, false, true);
      break;
    case 'resource':
    case 'stump':
    case 'chest':
      assignStaticFields(item, kind, components);
      break;
    case 'fish':
      assignFishFields(item, components);
      break;
    case 'berrybush':
      assignBerryBushFields(item, components);
      break;
    case 'signpost':
      pushSignpostItems(
        build.items,
        build.collected,
        build.snapshot,
        item,
        components,
        tileX,
        tileY,
        lift,
        build.playerColourOf,
      );
      break;
    case 'projectile':
      arcLift = assignProjectileArc(item, components, { x: tileX, y: tileY });
      break;
    case 'stockpile':
    case 'grounddrop':
      assignStockpileFields(item, components, isFlag);
      break;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
    }
  }
  const drawLift = lift + arcLift;
  if (drawLift !== 0) item.lift = drawLift;
  if (build.playerColourOf !== undefined && item.player !== undefined) {
    item.player = build.playerColourOf(item.player);
  }
  return item;
}

function assignFishFields(item: MutableSpriteDrawItem, components: Readonly<Record<string, unknown>>): void {
  const fish = components.FishSwarm as { count?: unknown } | undefined;
  if (typeof fish?.count === 'number') {
    item.swarmCount = Math.max(0, Math.min(systems.MAX_FISH_PER_SWARM, Math.trunc(fish.count)));
  }
}
