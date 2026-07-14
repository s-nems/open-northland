import { ONE } from '@open-northland/sim';

/** A fractional tile coordinate pair (col, row) in map space. */
export interface TilePoint {
  readonly col: number;
  readonly row: number;
}

/**
 * The tile an entity stands on, read from its plain-snapshot `Position` component (Fixed →
 * fractional tile), or null when the entity carries no well-formed Position. The one shared Position
 * reader for the audio layers (event one-shots, settler chatter).
 */
export function entityTile(components: Readonly<Record<string, unknown>>): TilePoint | null {
  const p = components.Position as { x?: unknown; y?: unknown } | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return { col: p.x / ONE, row: p.y / ONE };
}
