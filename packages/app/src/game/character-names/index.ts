import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { num, type SnapshotEntity, settlerJobType } from '../snapshot.js';

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
  const mapName = stringId === undefined ? undefined : nonblank(ctx.mapText?.(stringId));
  const given = ent.components.GivenName as { name?: unknown } | undefined;
  const identity = ent.components.NameIdentity as { name?: unknown } | undefined;
  const job = ctx.jobs.find((j) => j.typeId === settlerJobType(ent));
  const heroes: Readonly<Record<string, string | undefined>> = messages().heroNames;
  const hero = job !== undefined && systems.isHeroJobRow(job) ? heroes[job.id] : undefined;
  return (
    mapName ??
    nonblank(given?.name) ??
    hero ??
    nonblank(identity?.name) ??
    `${messages().userMessages.unnamed.person} #${ent.id}`
  );
}
