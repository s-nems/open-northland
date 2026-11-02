import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { num, type SnapshotEntity, settlerJobType } from '../snapshot/index.js';
import { localizedName } from './localized-names.js';
import { type NamedSettler, petNames } from './pet-names.js';

export interface NameContext {
  readonly jobs: readonly ContentSet['jobs'][number][];
  readonly mapText?: ((id: number) => string | undefined) | undefined;
}

function nonblank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function heroJobOf(ctx: NameContext, ent: SnapshotEntity): ContentSet['jobs'][number] | undefined {
  const job = ctx.jobs.find((j) => j.typeId === settlerJobType(ent));
  return job !== undefined && systems.isHeroJobRow(job) ? job : undefined;
}

/** The settler as its player's names know it: the entity and the generated name it carries. A settler
 *  of a tribe without a name pool has an empty one. */
export function namedSettlerOf(ent: SnapshotEntity): NamedSettler {
  const identity = ent.components.NameIdentity as { pool?: unknown; name?: unknown } | undefined;
  return {
    entity: ent.id,
    pool: typeof identity?.pool === 'string' ? identity.pool : '',
    raw: typeof identity?.name === 'string' ? identity.name : '',
  };
}

/** Whether the player may give `ent` a name of their own: a hero keeps its job's name and a scripted
 *  character the map's. Whose settler it is, the order gate decides. */
export function isRenamable(ctx: NameContext, ent: SnapshotEntity): boolean {
  return ent.components.ScriptedName === undefined && heroJobOf(ctx, ent) === undefined;
}

/** The name the player gave `ent`, or an empty string when they gave none. */
export function givenNameOf(ent: SnapshotEntity): string {
  return petNames().get(namedSettlerOf(ent)) ?? '';
}

/** One identity on every surface, including departed snapshots used by death notices. */
export function settlerName(ctx: NameContext, ent: SnapshotEntity): string {
  const scripted = ent.components.ScriptedName as { stringId?: unknown } | undefined;
  const stringId = num(scripted?.stringId);
  // A scripted name is the map author's, which a name the player gave does not outrank.
  const mapName = stringId === undefined ? undefined : nonblank(ctx.mapText?.(stringId));
  if (mapName !== undefined) return mapName;
  const settler = namedSettlerOf(ent);
  const raw = nonblank(settler.raw);
  const heroJob = heroJobOf(ctx, ent);
  const heroes: Readonly<Record<string, string | undefined>> = messages().heroNames;
  const hero = heroJob === undefined ? undefined : heroes[heroJob.id];
  // What the settler is called before the player names it: the hero's own name, the locale's
  // translation of the raw name, or that raw name.
  const known = hero ?? (raw === undefined ? undefined : localizedName(settler.pool, raw)) ?? raw;
  const given = petNames().get(settler);
  // The player's own name leads and the generated one rides beside it, so players who talk about a
  // settler still share a name for it.
  if (given !== undefined) return known === undefined ? given : `${given} (${known})`;
  return known ?? `${messages().userMessages.unnamed.person} #${ent.id}`;
}
