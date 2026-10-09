import type { ContentSet } from './schema/content/content-set.js';

export function checkUnitVariants(content: ContentSet): string[] {
  const errors: string[] = [];
  const jobs = new Set(content.jobs.map((job) => job.typeId));
  const weapons = new Set(content.weapons.map((weapon) => `${weapon.tribeType}:${weapon.typeId}`));
  for (const tribe of content.tribes) {
    const seen = new Set<string>();
    for (const rule of tribe.unitVariants ?? []) {
      const key = `${rule.jobType}:${rule.scenario}`;
      if (seen.has(key)) errors.push(`tribe ${tribe.typeId} repeats unit variant ${key}`);
      seen.add(key);
      for (const job of [rule.jobType, rule.animationJobType, rule.graphicsJobType]) {
        if (job !== undefined && !jobs.has(job))
          errors.push(`tribe ${tribe.typeId} unit variant references unknown job ${job}`);
      }
      if (rule.weapon !== undefined && !weapons.has(`${rule.weapon.tribeType}:${rule.weapon.typeId}`)) {
        errors.push(
          `tribe ${tribe.typeId} unit variant references unknown weapon ${rule.weapon.tribeType}:${rule.weapon.typeId}`,
        );
      }
    }
  }
  return errors;
}
