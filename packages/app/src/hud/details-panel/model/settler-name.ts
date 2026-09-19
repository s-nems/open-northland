import type { WorldSnapshot } from '@open-northland/sim';
import { characterName } from '../../../game/character-names/index.js';
import { PRIMARY_TRIBE } from '../../../game/rules.js';
import {
  isFemale,
  num,
  type SnapshotEntity,
  settlerJobType,
  settlerTribeOf,
  surnameSourceOf,
} from '../../../game/snapshot.js';
import { heroFallbackName, type UnitPanelModelContext } from './context.js';

type NameContext = Pick<UnitPanelModelContext, 'jobs' | 'mapText'>;

/** The name the map gave this settler, when it gave one and the map's table carries the string. */
function scriptedName(ctx: NameContext, ent: SnapshotEntity): string | undefined {
  const named = ent.components.ScriptedName as { stringId?: unknown } | undefined;
  const stringId = num(named?.stringId);
  return stringId === undefined ? undefined : ctx.mapText?.(stringId);
}

/** A settler's name everywhere the HUD shows one: the map's own, else a hero's conventional one, else
 *  the generated name. */
export function settlerDisplayName(ctx: NameContext, snapshot: WorldSnapshot, ent: SnapshotEntity): string {
  const jobType = settlerJobType(ent);
  return (
    scriptedName(ctx, ent) ??
    heroFallbackName(ctx, jobType) ??
    characterName(
      settlerTribeOf(ent) ?? PRIMARY_TRIBE,
      jobType,
      ent.components.Age !== undefined,
      ent.id,
      surnameSourceOf(snapshot, ent),
      isFemale(ent),
    )
  );
}
