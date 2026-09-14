import { messages } from './i18n/index.js';

/**
 * The mod root a conversion reads, or the localized reason there is none yet. Both shells run this
 * before starting a conversion, so a tampered page cannot start one without a mod.
 */
export function requireModRoot(availableModRoot: string | undefined): string {
  if (availableModRoot === undefined) throw new Error(messages().errors.modRequired);
  return availableModRoot;
}
