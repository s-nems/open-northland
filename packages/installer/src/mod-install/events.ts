import type { ModEvent } from '../shell-api.js';

/**
 * Installer events the progress throttle must not drop: a lost last tick leaves that phase's bar
 * parked short of full.
 */
export function isFinalModEvent(event: ModEvent): boolean {
  switch (event.kind) {
    case 'mod-warning':
      return true;
    case 'mod-download':
      // Without a content-length there is no recognizable last chunk.
      return event.total !== undefined && event.received >= event.total;
    case 'mod-extract':
      return event.done >= event.total;
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled mod event ${JSON.stringify(exhaustive)}`);
    }
  }
}
