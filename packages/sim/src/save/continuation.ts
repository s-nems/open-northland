import { mergeContinuation, type SavedCommand } from '../core/continuation.js';
import type { SaveGame } from './format.js';

/** Complete a tick-boundary capture after asynchronous transport acknowledgement, without reading
 * the world again. Existing readonly sections already belong to the detached captured save. */
export function withSaveContinuation(save: SaveGame, commands: readonly SavedCommand[]): SaveGame {
  return {
    header: save.header,
    sections: save.sections.map((section) =>
      section.id === 'commands'
        ? {
            ...section,
            continuation: mergeContinuation(section.continuation, commands, save.header.tick),
          }
        : section,
    ),
  };
}
