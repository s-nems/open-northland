import { ownCharacterJobSelection, ownCharacterSelection } from '@open-northland/art-contracts';
import type { SettlerCharacter } from '@open-northland/render';
import jobSelection from '../../assets/own/characters/job-selection.json';
import civilianSelection from '../../assets/own/characters/selection.json';
import { ADULT_CHARACTER_BY_JOB } from '../settler-gfx/index.js';

const jobs = ownCharacterJobSelection.parse(jobSelection);
const civiliansSelection = ownCharacterSelection.parse(civilianSelection);

export function requestedOwnAppearance(id: string, preview: string | null): boolean {
  return preview === null
    ? civiliansSelection.includes(id) || Object.values(jobs).includes(id)
    : id === preview;
}

export function selectOwnCharacters(
  loaded: ReadonlyMap<string, SettlerCharacter>,
  fallback: SettlerCharacter,
  preview: string | null,
): { default: SettlerCharacter; byJob: Readonly<Record<number, SettlerCharacter>> } | undefined {
  const civilians =
    preview === null
      ? civiliansSelection.flatMap((id) => {
          const character = loaded.get(id);
          return character === undefined ? [] : [character];
        })
      : [...loaded.values()];
  const first = civilians[0];
  if (first === undefined) return undefined;
  const byJob: Record<number, SettlerCharacter> = {};
  for (const [job, spec] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
    const id = jobs[spec];
    byJob[Number(job)] = preview === null && id !== undefined ? (loaded.get(id) ?? fallback) : fallback;
  }
  return {
    default: { ...first, bodyVariants: civilians.map((character) => character.body) },
    byJob,
  };
}
