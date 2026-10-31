import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { num, type SnapshotEntity, settlerJobType } from '../snapshot/index.js';
import { localizedName } from './localized-names.js';
import { petNames } from './pet-names.js';

export interface NameContext {
  readonly jobs: readonly ContentSet['jobs'][number][];
  readonly mapText?: ((id: number) => string | undefined) | undefined;
}

function nonblank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** One identity on every surface, including departed snapshots used by death notices. */
export function settlerName(ctx: NameContext, ent: SnapshotEntity): string {
  const scripted = ent.components.ScriptedName as { stringId?: unknown } | undefined;
  const stringId = num(scripted?.stringId);
  // A scripted name is the map author's, which a name the player gave does not outrank.
  const mapName = stringId === undefined ? undefined : nonblank(ctx.mapText?.(stringId));
  if (mapName !== undefined) return mapName;
  const identity = ent.components.NameIdentity as { pool?: unknown; name?: unknown } | undefined;
  const raw = nonblank(identity?.name);
  const pool = typeof identity?.pool === 'string' ? identity.pool : undefined;
  const job = ctx.jobs.find((j) => j.typeId === settlerJobType(ent));
  const heroes: Readonly<Record<string, string | undefined>> = messages().heroNames;
  const hero = job !== undefined && systems.isHeroJobRow(job) ? heroes[job.id] : undefined;
  // What the settler is called before the player names it: the hero's own name, the locale's
  // translation of the raw name, or that raw name.
  const known = hero ?? (raw === undefined ? undefined : localizedName(pool, raw)) ?? raw;
  const pet = petNames().get(ent.id);
  // The player's own name leads and the name it replaced rides beside it, so a settler they renamed
  // still reads as the one a notice, a tooltip or another seat's screen names.
  if (pet !== undefined) return known === undefined ? pet : `${pet} (${known})`;
  return known ?? `${messages().userMessages.unnamed.person} #${ent.id}`;
}
