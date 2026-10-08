import { groupFiles, type SoundIndex } from './bank.js';
import { UI_CUE_FILES } from './ui-cues.js';

/**
 * The order the bank is decoded in ahead of play, so a first click or first fight finds its wav
 * already decoded. Tiers run from what the player hears first and waits for most (a click, an
 * order's answer or refusal) to what only fills the background (talk, terrain beds).
 */
export const PRELOAD_TIERS = ['interface', 'jingle', 'action', 'chatter', 'ambient'] as const;
export type PreloadTier = (typeof PRELOAD_TIERS)[number];

/** The tiers the sample cache holds for the whole map: never evicted, however long since they rang. */
export const PINNED_PRELOAD_TIERS: ReadonlySet<PreloadTier> = new Set(['interface', 'jingle', 'action']);

/**
 * The bank's voice folders. A logic-sound group filed there is an animation's talk line, not a work
 * or combat sound, so it waits with the chatter.
 */
export const TALK_FOLDERS: readonly string[] = ['humantalk/', 'generic/'];

export interface PreloadEntry {
  readonly file: string;
  readonly tier: PreloadTier;
}

function isTalk(files: readonly string[]): boolean {
  return files.some((file) => TALK_FOLDERS.some((folder) => file.startsWith(folder)));
}

/** Every wav the index can play, once each, in {@link PRELOAD_TIERS} order. A wav two tiers share
 *  belongs to the earlier one. */
export function preloadPlan(index: SoundIndex): readonly PreloadEntry[] {
  const pools: Record<PreloadTier, (readonly string[])[]> = {
    interface: [Object.values(UI_CUE_FILES)],
    jingle: [...index.jinglesByMusicType.values()],
    action: [],
    chatter: [],
    ambient: [[...index.ambientLoopByName.values()]],
  };
  const named = (tier: PreloadTier, group: string | undefined): void => {
    const files = group === undefined ? undefined : groupFiles(index, group);
    if (files !== undefined) pools[tier].push(files);
  };
  for (const byClass of index.humanVoices.values()) {
    for (const voices of byClass.values()) {
      for (const group of voices.respondOk) named('interface', group);
      for (const group of voices.respondNo) named('interface', group);
      named('action', voices.scream);
      named('chatter', voices.generic);
    }
  }
  for (const files of index.groupsByLogicSoundType.values())
    pools[isTalk(files) ? 'chatter' : 'action'].push(files);
  for (const call of index.animalCalls.values()) named('chatter', call.group);

  const plan: PreloadEntry[] = [];
  const seen = new Set<string>();
  for (const tier of PRELOAD_TIERS) {
    for (const files of pools[tier]) {
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        plan.push({ file, tier });
      }
    }
  }
  return plan;
}
