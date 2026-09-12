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
  const jobs = status.enablingJobs.map((id) => {
    const profession = professionDefForJob(id);
    return profession !== undefined
      ? professionLabel(profession.key)
      : (content.jobs.find((j) => j.typeId === id)?.name ?? `#${id}`);
  });
  return `${messages().hud.technologyRequires} ${jobs.join(', ')}`;
}
