import type { MapSiege } from '@open-northland/data';
import {
  type MapEscalationCatapultRecord,
  mapEscalationProgress,
  Owner,
  Vehicle,
  writeMapEscalation,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { World } from '../../ecs/world.js';
import { seatCatapults } from '../ai-shared/military/catapults.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { createVehicle } from '../vehicles/create.js';

// The fortress's catapults, remembered the way the map AI remembers its walls: what stands on the first
// turn is the list, and a lost one is raised again at its spot. The seat's own map-AI turn crews it.

/** The catapults of the fortress seat standing now, with the spot each guards. */
export function rememberCatapults(world: World, ctx: SystemContext, siege: MapSiege): void {
  const records: MapEscalationCatapultRecord[] = [];
  for (const e of seatCatapults(world, ctx, siege.stronghold.seat)) {
    const state = world.get(e, Vehicle);
    const spot = state.guard ?? vehicleAnchor(world, e);
    if (spot === null) continue;
    records.push({
      vehicleType: state.vehicleType,
      tribe: state.tribe,
      hx: spot.hx,
      hy: spot.hy,
      entity: e,
      lostTick: null,
    });
  }
  writeMapEscalation(world, (progress) => {
    progress.catapults = records;
  });
}

/** Mark each remembered catapult that is gone, or no longer the fortress's, as lost from now. */
export function noteLostCatapults(world: World, ctx: SystemContext, siege: MapSiege): void {
  const records = mapEscalationProgress(world).catapults ?? [];
  const seat = siege.stronghold.seat;
  const lost = records.flatMap((record, i) => {
    const e = record.entity;
    if (e === null) return [];
    const standing = world.has(e, Vehicle) && world.tryGet(e, Owner)?.player === seat;
    return standing ? [] : [i];
  });
  if (lost.length === 0) return;
  writeMapEscalation(world, (progress) => {
    for (const i of lost) {
      const record = progress.catapults?.[i];
      if (record === undefined) continue;
      record.entity = null;
      record.lostTick = ctx.tick;
    }
  });
}

/** Raise the first remembered catapult lost at least `respawnSeconds` ago at its spot; at most one. */
export function respawnCatapult(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  respawnSeconds: number,
): void {
  const records = mapEscalationProgress(world).catapults ?? [];
  const wait = respawnSeconds * TICKS_PER_SECOND;
  const i = records.findIndex((record) => record.lostTick !== null && ctx.tick - record.lostTick >= wait);
  const record = records[i];
  if (record === undefined) return;
  const e = createVehicle(world, ctx, {
    vehicleType: record.vehicleType,
    x: record.hx,
    y: record.hy,
    tribe: record.tribe,
    owner: siege.stronghold.seat,
  });
  if (e === null) return;
  writeMapEscalation(world, (progress) => {
    const held = progress.catapults?.[i];
    if (held === undefined) return;
    held.entity = e;
    held.lostTick = null;
  });
}
