import { el } from './dom.js';

/** The card's mutually exclusive sections; one is visible at a time. */
export const SETUP_PHASE_IDS = ['pick', 'run', 'done', 'failed', 'blocked'] as const;

export type SetupPhase = (typeof SETUP_PHASE_IDS)[number];

export function showPhase(name: SetupPhase): void {
  for (const id of SETUP_PHASE_IDS) el(id).classList.toggle('hidden', id !== name);
}
