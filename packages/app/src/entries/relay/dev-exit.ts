import type { RelayClient, RelaySocket } from '@open-northland/net-client';
import { swapToEntry } from '../../launch.js';
import { menuSearch } from '../../view/params.js';
import type { AssembledMapWorld } from '../map/boot.js';

export function devRelayExit(deps: {
  readonly canvas: HTMLCanvasElement;
  readonly client: RelayClient;
  readonly socket: RelaySocket;
  readonly world: () => AssembledMapWorld | null;
  readonly presentation: () => Promise<void>;
  readonly cleanup: () => void;
  readonly onFailure: (error: unknown) => void;
}) {
  let disposed = false;
  let leaving = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    deps.cleanup();
    if (deps.client.room !== null && deps.socket.connected) deps.client.leaveRoom();
    deps.client.receive({ kind: 'left' });
    deps.socket.close();
    // Pixi permanently loses its context on destruction; the next entry needs a fresh canvas.
    deps.canvas.replaceWith(deps.canvas.cloneNode(false));
    const world = deps.world();
    if (world !== null) {
      const release = () => world.app.destroy(false, { children: true });
      void deps.presentation().then(release, release);
    }
  }
  return {
    dispose,
    quit(): void {
      if (leaving) return;
      leaving = true;
      void swapToEntry(menuSearch(), dispose).catch((error: unknown) => {
        leaving = false;
        deps.onFailure(error);
      });
    },
  };
}
