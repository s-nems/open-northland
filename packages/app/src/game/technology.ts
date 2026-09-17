import type { ContentSet } from '@open-northland/data';
import type { Simulation } from '@open-northland/sim';
import { professionDefForJob } from '../catalog/professions.js';
import { messages, professionLabel } from '../i18n/index.js';

export function technologyReason(
  content: ContentSet,
  status: ReturnType<Simulation['unlockStatus']>,
): string | null {
  if (!status.allowed) return messages().hud.technologyForbidden;
  if (status.enabled) return null;
  const jobs = (
    status.requiredJobs.length > 0 || status.requiredGoods.length > 0
      ? status.requiredJobs
      : status.enablingJobs
  ).map((id) => technologyLabel(content, 'job', id));
  // A missing good names the trades whose work discovers it, so the player knows whom to assign.
  const goods = status.requiredGoods.map(({ good, jobs: producers }) => {
    const label = technologyLabel(content, 'good', good);
    const byJobs = producers.filter((id) => !status.requiredJobs.includes(id));
    return byJobs.length === 0
      ? label
      : `${label} (${byJobs.map((id) => technologyLabel(content, 'job', id)).join(', ')})`;
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
  const labels: Readonly<Record<string, string>> = messages().goods;
  return labels[row.id] ?? row.name;
}

export function technologyLabel(
  content: { readonly [K in 'buildings' | 'jobs' | 'goods']: Readonly<ContentSet[K]> },
  kind: 'job' | 'good' | 'house',
  typeId: number,
): string {
  const profession = kind === 'job' ? professionDefForJob(typeId) : undefined;
  if (profession !== undefined) return professionLabel(profession.key);
  const row = (kind === 'house' ? content.buildings : kind === 'job' ? content.jobs : content.goods).find(
    (r) => r.typeId === typeId,
  );
  if (row === undefined) return `#${typeId}`;
  const labels: Readonly<Record<string, string>> =
    kind === 'house' ? messages().building : kind === 'job' ? messages().profession : messages().goods;
  return labels[row.id] ?? ('name' in row ? row.name : undefined) ?? row.id;
}
