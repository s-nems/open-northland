import type { SimEvent } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';
import type { SessionHost } from '../../session/index.js';

interface TerrainColorSurface {
  applyTerrainVertexColors(
    updates: readonly { readonly hx: number; readonly hy: number; readonly value: number }[],
    palette?: readonly number[],
  ): void;
}

export async function mountScriptTerrainColors(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits'>,
  surface: TerrainColorSurface,
): Promise<(events: readonly SimEvent[]) => void> {
  const hasColors = host.missions?.missions.some((mission) =>
    mission.results.some((op) => op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'),
  );
  if (!hasColors) return () => undefined;
  const palette = await loadVertexPalette();
  // Each answer is the whole tint state, so only the latest asked is applied.
  let asked = 0;
  const sync = (): void => {
    const request = ++asked;
    void host.landscapeEdits().then((edits) => {
      if (request === asked) surface.applyTerrainVertexColors(edits.tints, palette ?? undefined);
    });
  };
  sync();
  return (events) => {
    if (events.some((event) => event.kind === 'missionVertexColor')) sync();
  };
}
