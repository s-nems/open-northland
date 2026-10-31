import type { ContentSet } from '@open-northland/data';
import { systems, type UnlockStatus, type WorldSnapshot } from '@open-northland/sim';
import { professionDefForJob } from '../catalog/professions.js';
import { formatMessage, messages, professionLabel } from '../i18n/index.js';
import { settlerExperienceOf, settlersOfTrade, settlerTribeOf } from './snapshot/index.js';

/** How far the best-trained person of the discovering trades is toward a missing good's `needforgood`
 *  threshold, in the requirement's repeats. */
export interface DiscoveryProgress {
  readonly current: number;
  readonly required: number;
}

/** A missing good's discovery progress given the trades whose work discovers it; null for a good no
 *  experience threshold gates. */
export type DiscoveryProgressRead = (good: number, jobs: readonly number[]) => DiscoveryProgress | null;

export function technologyReason(
  content: ContentSet,
  status: UnlockStatus,
  progressOf?: DiscoveryProgressRead,
): string | null {
  if (!status.allowed) return messages().hud.technologyForbidden;
  if (status.enabled) return null;
  return `${messages().hud.technologyRequires} ${technologyMissing(content, status, progressOf).join(', ')}`;
}

/** What an undiscovered status still waits for, each named for the player. */
export function technologyMissing(
  content: ContentSet,
  status: UnlockStatus,
  progressOf?: DiscoveryProgressRead,
): readonly string[] {
  const jobs = (
    status.requiredJobs.length > 0 || status.requiredGoods.length > 0
      ? status.requiredJobs
      : status.enablingJobs
  ).flatMap((id) => technologyName(content, 'job', id) ?? []);
  // A missing good names the trades whose work discovers it, even one missing itself, so the entry never
  // reads as a ware to deliver; a threshold adds how far their best-trained person has come.
  const goods = status.requiredGoods.flatMap(({ good, jobs: producers }) => {
    const label = technologyName(content, 'good', good);
    if (label === undefined) return [];
    const byJobs = producers.flatMap((id) => technologyName(content, 'job', id) ?? []).join(', ');
    const progress = progressOf?.(good, producers) ?? null;
    if (progress !== null && byJobs !== '')
      return formatMessage(messages().hud.technologyGoodProgress, { good: label, jobs: byJobs, ...progress });
    return byJobs === '' ? label : `${label} (${byJobs})`;
  });
  return [...jobs, ...goods];
}

/**
 * {@link DiscoveryProgressRead} for `player`'s people of `tribe`. The sim discovers a good when one
 * settler whose current trade discovers it meets every `needforgood` row, so a row's progress is its best
 * such settler's, and the first row none of them meets is the one shown.
 */
export function discoveryProgressOf(
  content: Pick<ContentSet, 'tribes' | 'jobExperience'>,
  snapshot: WorldSnapshot,
  player: number,
  tribe: number,
): DiscoveryProgressRead {
  const requirements = content.tribes.find((t) => t.typeId === tribe)?.jobRequirements ?? [];
  return (good, jobs) => {
    for (const requirement of requirements) {
      if (requirement.requirement !== 'need' || requirement.target !== 'good') continue;
      if (requirement.targetId !== good) continue;
      let current = 0;
      for (const job of jobs) {
        for (const settler of settlersOfTrade(snapshot, player, job)) {
          if (settlerTribeOf(settler) !== tribe) continue;
          const experience = settlerExperienceOf(settler.components);
          const repeats = systems.requirementRepeats(
            content.jobExperience,
            experience,
            requirement.experienceTypes,
          );
          current = Math.max(current, repeats);
        }
      }
      if (current < requirement.amount) return { current, required: requirement.amount };
    }
    return null;
  };
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
