import type { ContentSet } from '@open-northland/data';
import { systems, type UnlockStatus } from '@open-northland/sim';
import { professionDefForJob } from '../catalog/professions.js';
import { messages, professionLabel } from '../i18n/index.js';

export function technologyReason(content: ContentSet, status: UnlockStatus): string | null {
  if (!status.allowed) return messages().hud.technologyForbidden;
  if (status.enabled) return null;
  const jobs = (
    status.requiredJobs.length > 0 || status.requiredGoods.length > 0
      ? status.requiredJobs
      : status.enablingJobs
  ).flatMap((id) => technologyName(content, 'job', id) ?? []);
  // A missing good names the trades whose work discovers it, so the player knows whom to assign.
  const goods = status.requiredGoods.flatMap(({ good, jobs: producers }) => {
    const label = technologyName(content, 'good', good);
    if (label === undefined) return [];
    const byJobs = producers
      .filter((id) => !status.requiredJobs.includes(id))
      .flatMap((id) => technologyName(content, 'job', id) ?? []);
    return byJobs.length === 0 ? label : `${label} (${byJobs.join(', ')})`;
  });
  return `${messages().hud.technologyRequires} ${[...jobs, ...goods].join(', ')}`;
}

/** A vehicle type's name: every vehicle is also a good of the same id, whose catalog entry names it. */
export function vehicleLabel(
  content: { readonly vehicles: Readonly<ContentSet['vehicles']> },
  typeId: number,
): string | undefined {
  const row = content.vehicles.find((r) => r.typeId === typeId);
  if (row === undefined) return undefined;
  const labels: Readonly<Record<string, string | undefined>> = messages().goods;
  return labels[row.id];
}

type TechnologyContent = { readonly [K in 'buildings' | 'jobs' | 'goods']: Readonly<ContentSet[K]> };

/**
 * The localized name of a discoverable job, good or house, or `undefined` when no catalog names it: a
 * caller drops such an entry rather than print the content slug.
 */
export function technologyName(
  content: TechnologyContent,
  kind: 'job' | 'good' | 'house',
  typeId: number,
): string | undefined {
  if (kind === 'job') return jobName(content, typeId);
  const row = (kind === 'house' ? content.buildings : content.goods).find((r) => r.typeId === typeId);
  if (row === undefined) return undefined;
  const labels: Readonly<Record<string, string | undefined>> =
    kind === 'house' ? messages().building : messages().goods;
  return labels[row.id];
}

/** A job's name: the picker's profession, else a named off-roster trade, life stage or hero class. */
function jobName(content: TechnologyContent, typeId: number): string | undefined {
  const profession = professionDefForJob(typeId);
  if (profession !== undefined) return professionLabel(profession.key);
  const row = content.jobs.find((r) => r.typeId === typeId);
  if (row === undefined) return undefined;
  const trades: Readonly<Record<string, string | undefined>> = messages().profession;
  const roles: Readonly<Record<string, string | undefined>> = messages().roleNames;
  return (
    trades[row.id] ??
    roles[row.id] ??
    (systems.isHeroJobRow(row) ? messages().hud.groupPanel.role.hero : undefined)
  );
}

/** {@link technologyName} for a seam that takes a plain string; an unnamed entry reads empty, never as a slug. */
export function technologyLabel(
  content: TechnologyContent,
  kind: 'job' | 'good' | 'house',
  typeId: number,
): string {
  return technologyName(content, kind, typeId) ?? '';
}
