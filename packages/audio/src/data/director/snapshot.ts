import { ONE } from '@vinland/sim';

/** A fractional tile coordinate pair (col, row) in map space. */
export interface TilePoint {
  readonly col: number;
  readonly row: number;
}

/**
 * The tile an entity stands on, read from its plain-snapshot `Position` component (Fixed →
 * fractional tile), or null when the entity carries no well-formed Position. The ONE shared reader
 * for every audio layer that locates a snapshot entity (event one-shots, settler chatter), so the
 * "how do I read a Position off the untyped snapshot" duck-typing lives in one place.
 */
export function entityTile(components: Readonly<Record<string, unknown>>): TilePoint | null {
  const p = components.Position as { x?: unknown; y?: unknown } | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return { col: p.x / ONE, row: p.y / ONE };
}
