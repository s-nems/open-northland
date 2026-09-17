import type { VoiceClass } from '@open-northland/data';
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

/** The owning player from the entity's plain-snapshot `Owner` component, or undefined for a neutral
 *  entity. */
export function entityOwner(components: Readonly<Record<string, unknown>>): number | undefined {
  const o = components.Owner as { player?: unknown } | undefined;
  return typeof o?.player === 'number' ? o.player : undefined;
}

/** A creature's tribe from its plain-snapshot `Settler` component (a person's or an animal's), or
 *  undefined for an entity that is no creature. */
export function creatureTribe(components: Readonly<Record<string, unknown>>): number | undefined {
  const s = components.Settler as { tribe?: unknown } | undefined;
  return typeof s?.tribe === 'number' ? s.tribe : undefined;
}

/** Whether the creature is a person: a `Settler` carrying the `Person` marker, not wildlife. */
export function isPerson(components: Readonly<Record<string, unknown>>): boolean {
  return components.Person !== undefined;
}

/**
 * The class the original keys a human's voice by: a child while it still carries `Age` (the sim removes
 * it at adulthood), else a woman by the `Female` marker, else a man.
 */
export function voiceClassOf(components: Readonly<Record<string, unknown>>): VoiceClass {
  if (components.Age !== undefined) return 'child';
  return components.Female !== undefined ? 'female' : 'male';
}
