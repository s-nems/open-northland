import type { ModEvent } from '../ipc.js';

/**
 * Which installer events outrank the renderer's progress throttle: dropping a phase's last tick
 * would leave its bar parked short of full for the rest of the install.
 */
export function isFinalModEvent(event: ModEvent): boolean {
  switch (event.kind) {
    case 'mod-warning':
      return true;
    case 'mod-download':
      // No content-length means no recognizable last chunk; the extract phase's tick moves the bar on.
      return event.total !== undefined && event.received >= event.total;
    case 'mod-extract':
      return event.done >= event.total;
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled mod event ${JSON.stringify(exhaustive)}`);
    }
  }
}
