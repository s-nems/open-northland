import type { SimEvent, Simulation } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';

interface TerrainColorSurface {
  applyTerrainVertexColors(
    updates: readonly { readonly hx: number; readonly hy: number; readonly value: number }[],
    palette?: readonly number[],
  ): void;
}

export async function mountScriptTerrainColors(
  sim: Simulation,
  surface: TerrainColorSurface,
): Promise<(events: readonly SimEvent[]) => void> {
  const hasColors = sim.missions?.missions.some((mission) =>
    mission.results.some((op) => op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'),
  );
  if (!hasColors) return () => undefined;
  const palette = await loadVertexPalette();
  const sync = (): void => {
    surface.applyTerrainVertexColors(sim.landscapeEdits().tints, palette ?? undefined);
  };
  sync();
  return (events) => {
    if (events.some((event) => event.kind === 'missionVertexColor')) sync();
  };
}
