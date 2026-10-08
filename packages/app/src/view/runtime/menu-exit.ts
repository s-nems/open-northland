import { diag } from '../../diag/index.js';
import { swapToEntry } from '../../launch.js';
import { releaseDocument } from '../navigation-guard.js';
import { menuSearch } from '../params.js';

/**
 * Quits a local world to the main menu inside this document, so a fullscreen window stays fullscreen.
 * A failed handover still reaches the menu through a navigation, at the cost of the window mode.
 */
export function createMenuExit(deps: {
  readonly teardown: () => void;
  readonly search?: () => string;
  readonly swap?: (search: string, teardown: () => void) => Promise<void>;
  readonly navigate?: (search: string) => void;
}): () => void {
  const swap = deps.swap ?? swapToEntry;
  const navigate =
    deps.navigate ??
    ((search: string): void => {
      releaseDocument();
      window.location.search = search;
    });
  let leaving = false;
  return () => {
    if (leaving) return;
    leaving = true;
    const search = (deps.search ?? menuSearch)();
    swap(search, deps.teardown).catch((error: unknown) => {
      diag.warn('boot', `menu handover failed, navigating instead: ${String(error)}`);
      navigate(search);
    });
  };
}
