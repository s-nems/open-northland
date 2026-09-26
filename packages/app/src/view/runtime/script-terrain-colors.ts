import type { SimEvent } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';
import type { SessionHost } from '../../session/index.js';

interface TerrainColorSurface {
  applyTerrainVertexColors(
    updates: readonly { readonly hx: number; readonly hy: number; readonly value: number }[],
    palette?: readonly number[],
  ): void;
}

/** The script's terrain tints kept on the surface: synced on its events, and never after `dispose`. */
export interface ScriptTerrainColors {
  readonly onEvents: (events: readonly SimEvent[]) => void;
  readonly dispose: () => void;
}

export async function mountScriptTerrainColors(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits'>,
  surface: TerrainColorSurface,
): Promise<ScriptTerrainColors> {
  const hasColors = host.missions?.missions.some((mission) =>
    mission.results.some((op) => op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'),
  );
  if (!hasColors) return { onEvents: () => undefined, dispose: () => undefined };
  const palette = await loadVertexPalette();
  // Each answer is the whole tint state, so only the latest asked is applied, and none once disposed.
  let asked = 0;
  let disposed = false;
  const sync = (): void => {
    const request = ++asked;
    void host.landscapeEdits().then((edits) => {
      if (request === asked && !disposed) surface.applyTerrainVertexColors(edits.tints, palette ?? undefined);
    });
  };
  sync();
  return {
    onEvents: (events) => {
      if (events.some((event) => event.kind === 'missionVertexColor')) sync();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
