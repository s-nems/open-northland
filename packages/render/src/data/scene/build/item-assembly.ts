import { type EntitySnapshot, systems, type WorldSnapshot } from '@open-northland/sim';
import { type ElevationField, terrainLiftAt } from '../../terrain/index.js';
import { drawPassOf, spriteDepth } from '../depth.js';
import { type EntityKind, type MutableSpriteDrawItem, newDrawItem } from '../draw-item.js';
import { flagOwnerOf } from '../flag-owner.js';
import { assignPalisadeFields, type PalisadeLayout } from '../palisades/connections.js';
import type { LaunchContext } from '../projectiles/launch.js';
import type { SettlerPose } from '../settler-pose.js';
import {
  assignStaticFields,
  readHaulingCartDriver,
  readOwnerPlayer,
  readRoadSiteClaimed,
  readVehicleDriver,
  readVehicleFields,
} from '../snapshot-readers/index.js';
import {
  assignBerryBushFields,
  assignBuildingFields,
  assignProjectileArc,
  assignSettlerFields,
  assignStockpileFields,
  pushSignpostItems,
} from './collect-fields.js';
import type { DrawList } from './draw-list.js';

export interface SceneBuild {
  readonly snapshot: WorldSnapshot;
  readonly list: DrawList;
  readonly collected: Set<number>;
  readonly posByRef: ReadonlyMap<number, { x: number; y: number }>;
  readonly elevation: ElevationField | undefined;
  readonly playerColourOf: ((player: number) => number) | undefined;
  readonly palisades: PalisadeLayout;
  readonly launch: LaunchContext;
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
  const lift = terrainLiftAt(build.elevation, tileX, tileY);
  // A projectile's ballistic height rides the same lift channel as terrain lift: a draw offset the
  // depth key never sees, so neither can reshuffle occlusion.
  let arcLift = 0;
  const item = newDrawItem(kind, entity.id, screen.x, screen.y, 0, pose.state);
  switch (kind) {
    case 'settler':
      assignSettlerFields(item, components, pose.actingAtomic, pose.targetFacing, build.snapshot.tick);
      readHaulingCartDriver(item, components, build.snapshot);
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
    case 'roadsite': {
      const player = readOwnerPlayer(components);
      if (player !== undefined) item.player = player;
      item.roadSite = readRoadSiteClaimed(components) ? 'claimed' : 'unclaimed';
      break;
    }
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
        build.list,
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
      arcLift = assignProjectileArc(item, entity.id, components, { x: tileX, y: tileY }, build.launch);
      break;
    case 'stockpile':
    case 'grounddrop': {
      const isFlag = 'DeliveryFlag' in components;
      assignStockpileFields(item, components, isFlag);
      if (isFlag) {
        const player = flagOwnerOf(build.snapshot, entity.id);
        if (player !== undefined) item.player = player;
      }
      break;
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
    }
  }
  item.depth = spriteDepth(tileX, tileY, kind, drawPassOf(item));
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
