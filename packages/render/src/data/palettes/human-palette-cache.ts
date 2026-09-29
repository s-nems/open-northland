import {
  copyHumanPaletteIdentity,
  createHumanPaletteColours,
  createHumanPaletteIdentity,
  type HumanPaletteBook,
  type HumanPaletteColours,
  type HumanPaletteIdentity,
  sameHumanPaletteIdentity,
} from './human-palettes.js';

/** Humans a CPU cache keeps composed; the HUD shows a few dozen at most. */
const DEFAULT_CAPACITY = 256;

/**
 * Composed palettes for CPU painters, by a caller key (an entity id). A key keeps the same colour arrays
 * while its identity holds, so a painter may cache work on them; a changed identity gets new arrays. The
 * oldest key goes first once the cache is full.
 */
export class HumanPaletteCache {
  private readonly entries = new Map<
    number,
    { readonly identity: HumanPaletteIdentity; readonly colours: HumanPaletteColours }
  >();

  constructor(
    private readonly book: HumanPaletteBook,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  colours(key: number, identity: HumanPaletteIdentity): HumanPaletteColours {
    const held = this.entries.get(key);
    if (held !== undefined && sameHumanPaletteIdentity(held.identity, identity)) return held.colours;
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
    const copy = createHumanPaletteIdentity(identity.look);
    copyHumanPaletteIdentity(identity, copy);
    const colours = createHumanPaletteColours();
    this.book.compose(copy, colours);
    this.entries.set(key, { identity: copy, colours });
    return colours;
  }
}
