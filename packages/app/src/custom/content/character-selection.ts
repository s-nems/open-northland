import { customCharacterJobSelection, customCharacterSelection } from '@open-northland/art-contracts/custom';
import type { SettlerCharacter } from '@open-northland/render';
import jobSelection from '../../assets/custom/characters/job-selection.json';
import civilianSelection from '../../assets/custom/characters/selection.json';
import { ADULT_CHARACTER_BY_JOB, YOUNG_CHARACTER_BY_JOB } from '../../content/settler-gfx/index.js';

const jobs = customCharacterJobSelection.parse(jobSelection);
const civiliansSelection = customCharacterSelection.parse(civilianSelection);

export function requestedCustomAppearance(id: string, preview: string | null): boolean {
  return preview === null
    ? civiliansSelection.includes(id) || Object.values(jobs).includes(id)
    : id === preview;
}

export function selectCustomCharacters(
  loaded: ReadonlyMap<string, SettlerCharacter>,
  fallback: SettlerCharacter,
  preview: string | null,
):
  | {
      default: SettlerCharacter;
      byJob: Readonly<Record<number, SettlerCharacter>>;
      youngByJob: Readonly<Record<number, SettlerCharacter>>;
    }
  | undefined {
  const civilians =
    preview === null
      ? civiliansSelection.flatMap((id) => {
          const character = loaded.get(id);
          return character === undefined ? [] : [character];
        })
      : [...loaded.values()];
  const first = civilians[0];
  if (first === undefined) return undefined;
  const selectedByJob = (specByJob: Readonly<Record<number, string>>) => {
    const byJob: Record<number, SettlerCharacter> = {};
    for (const [job, spec] of Object.entries(specByJob)) {
      const id = jobs[spec];
      byJob[Number(job)] = preview === null && id !== undefined ? (loaded.get(id) ?? fallback) : fallback;
    }
    return byJob;
  };
  return {
    default: { ...first, variants: civilians },
    byJob: selectedByJob(ADULT_CHARACTER_BY_JOB),
    youngByJob: selectedByJob(YOUNG_CHARACTER_BY_JOB),
  };
}
