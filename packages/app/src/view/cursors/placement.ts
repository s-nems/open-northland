import type { PlacementGhost } from '@open-northland/render';
import type { CursorState } from './model.js';

/** The pointer reuses the placement preview's verdict; it never issues another host probe. */
export function placementPointer(active: boolean, ghost: PlacementGhost | null): CursorState | null {
  if (!active) return null;
  if (ghost === null) return 'not-allowed';
  if (ghost.kind === 'gate' && !ghost.ok) return 'not-allowed';
  if (ghost.kind === 'line' && !ghost.nodes.some((node) => node.state !== 'blocked')) return 'not-allowed';
  return 'build';
}
