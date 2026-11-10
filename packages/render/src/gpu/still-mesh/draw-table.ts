import { BatchTextureArray, type Texture, type TextureSource } from 'pixi.js';
import { palettedLutOf } from '../pixel-art/registry.js';

/** A quad as a table sees it: the texture its sprite draws, and that texture's LUT as last read. */
export interface TableQuad {
  readonly sprite: { readonly texture: Texture };
  /** The texture {@link lut} was read for; a rebuild asks again only once the sprite's texture changes. */
  lutTexture: Texture | null;
  lut: TextureSource | undefined;
  /** The table its draw bound when it was last placed and the slot of its page there, as its owner
   *  wrote them: where the page still sits, a fill finds its slot without a lookup. */
  readonly table: unknown;
  readonly textureId: number;
}

function lutOf(quad: TableQuad, texture: Texture): TextureSource | undefined {
  if (quad.lutTexture !== texture) {
    quad.lutTexture = texture;
    quad.lut = palettedLutOf(texture);
  }
  return quad.lut;
}

/**
 * One still-mesh draw's texture list: the pages its quads sample, from slot 0, and the one palette LUT
 * its paletted quads read, which the draw binds past the pages as a paletted world batch does.
 * Consecutive draws of a band share a table until a quad's page or LUT does not fit it, which is where
 * Pixi would break a batch for its textures too. A band rebuild fills its tables afresh, but a page keeps
 * the slot it held before unless a new page needs it, so a rebuild rarely moves a quad to another slot.
 */
export class DrawTable extends BatchTextureArray {
  lut: TextureSource | null = null;
  /** Each listed page's slot. */
  private readonly slots = new Map<TextureSource, number>();
  /** Per slot, the fill that last claimed it: a slot the running fill has not claimed is free. */
  private readonly claimed: Uint32Array;
  private fill = 1;
  private claimedCount = 0;

  /** @param joined told of each page or LUT the table takes on. */
  constructor(
    private readonly maxPages: number,
    private readonly joined: (source: TextureSource) => void,
  ) {
    super();
    this.claimed = new Uint32Array(maxPages);
  }

  /** Start a fill: every slot is free again, though a page keeps its slot until another page takes it. */
  begin(): void {
    this.fill++;
    this.claimedCount = 0;
    this.lut = null;
  }

  /**
   * End a fill: drop the slots past the last claimed one, and point a slot left unclaimed between them at
   * a claimed page if its own page was destroyed, since a draw binds every listed slot.
   */
  finish(): void {
    while (this.count > 0 && this.claimed[this.count - 1] !== this.fill) {
      this.forget(this.count - 1);
      this.count--;
    }
    let stand: TextureSource | undefined;
    for (let slot = 0; slot < this.count && stand === undefined; slot++)
      if (this.claimed[slot] === this.fill) stand = this.textures[slot];
    for (let slot = 0; slot < this.count; slot++) {
      const page = this.textures[slot];
      if (stand === undefined || page === undefined || !page.destroyed) continue;
      this.forget(slot);
      this.textures[slot] = stand;
    }
  }

  override clear(): void {
    super.clear();
    this.slots.clear();
    this.claimed.fill(0);
    this.begin();
  }

  /** Whether `quads` fit together: their LUT is the table's or the table has none, and their pages the
   *  running fill has not claimed yet fit its free slots. A destroyed page fits no table. */
  fits(quads: readonly TableQuad[]): boolean {
    let lut = this.lut;
    let added = 0;
    for (let q = 0; q < quads.length; q++) {
      const quad = quads[q];
      if (quad === undefined) continue;
      const texture = quad.sprite.texture;
      const source: TextureSource | null = texture.source;
      if (source === null || source.destroyed) return false;
      const quadLut = lutOf(quad, texture);
      if (quadLut !== undefined) {
        if (lut === null) lut = quadLut;
        else if (lut !== quadLut) return false;
      }
      const slot = this.slotOf(quad, source);
      if ((slot !== undefined && this.claimed[slot] === this.fill) || listedBefore(quads, q, source))
        continue;
      added++;
    }
    return this.claimedCount + added <= this.maxPages;
  }

  /** The slot of the page `quad`'s sprite draws, its page and LUT joining the table; null when either
   *  does not fit. */
  join(quad: TableQuad): number | null {
    const texture = quad.sprite.texture;
    const lut = lutOf(quad, texture);
    if (lut !== undefined && this.lut !== null && this.lut !== lut) return null;
    const source = texture.source;
    let slot = this.slotOf(quad, source);
    if (slot === undefined) {
      const free = this.freeSlot();
      if (free === null) return null;
      if (free < this.count) this.forget(free);
      else this.count++;
      this.textures[free] = source;
      this.slots.set(source, free);
      this.joined(source);
      slot = free;
    }
    if (this.claimed[slot] !== this.fill) {
      this.claimed[slot] = this.fill;
      this.claimedCount++;
    }
    if (lut !== undefined && this.lut === null) {
      this.lut = lut;
      this.joined(lut);
    }
    return slot;
  }

  /** The slot listing `source`: the one `quad` last drew it from while the page still sits there (a slot
   *  standing in for a destroyed page holds a listed page too, which draws from it as well), else the
   *  table's own lookup. */
  private slotOf(quad: TableQuad, source: TextureSource): number | undefined {
    const held = quad.textureId;
    if (quad.table === this && held < this.count && this.textures[held] === source) return held;
    return this.slots.get(source);
  }

  /** Unlist the page in `slot`. A slot that holds a stand-in for a destroyed page holds a page listed at
   *  another slot, whose own listing stays. */
  private forget(slot: number): void {
    const page = this.textures[slot];
    if (page !== undefined && this.slots.get(page) === slot) this.slots.delete(page);
  }

  /** A slot for a page not listed: past the listed ones while there is room, so no listed page loses its
   *  slot, else the first one the running fill has not claimed. */
  private freeSlot(): number | null {
    if (this.claimedCount >= this.maxPages) return null;
    if (this.count < this.maxPages) return this.count;
    for (let slot = 0; slot < this.count; slot++) if (this.claimed[slot] !== this.fill) return slot;
    return null;
  }
}

/** Whether a quad before `q` draws from `source`, which then needs no slot of its own. */
function listedBefore(quads: readonly TableQuad[], q: number, source: TextureSource): boolean {
  for (let p = 0; p < q; p++) if (quads[p]?.sprite.texture.source === source) return true;
  return false;
}
