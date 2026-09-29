import {
  BufferImageSource,
  ExtensionType,
  extensions,
  type GLTextureUploader,
  type GlTexture,
  type TextureSource,
} from 'pixi.js';
import {
  type CharacterPalette,
  copyHumanPaletteIdentity,
  createHumanPaletteColours,
  createHumanPaletteIdentity,
  type HumanPaletteBook,
  type HumanPaletteIdentity,
  sameHumanPaletteIdentity,
} from '../data/palettes/human-palettes.js';
import type { PaletteLut } from './sprite-sheet.js';

/** A human's head row sits right under its body row. */
export const HUMAN_HEAD_ROW_OFFSET = 1;
const ROWS_PER_HUMAN = 2;
/** Rows wanted: 2,048 humans at once, far past a zoomed-out screen of a crowded map. Half of it is
 *  WebGL2's guaranteed `MAX_TEXTURE_SIZE`, the least {@link HumanPaletteLut.fitTo} can meet. */
export const HUMAN_LUT_ROWS = 4096;
/** Humans kept for the shared fallbacks a full LUT hands out (see {@link HumanPaletteLut.rowFor}). */
export const SHARED_HUMANS = 64;
/** Row pairs after the shared ones kept for the team palettes, one per player colour slot. */
export const TEAM_HUMANS = 16;
/** Team-colour slots and sexes a shared fallback key makes room for. */
const PLAYER_KEYS = 256;
const SEXES = 2;
/** Past this many changed humans in one flush, one whole upload beats per-human uploads. */
const WHOLE_UPLOAD_HUMANS = 256;
const LUT_WIDTH = 256;
const RGBA = 4;
const RGB = 3;
const OPAQUE = 255;
const ROW_BYTES = LUT_WIDTH * RGBA;
const WEBGL2 = 2;
const UPLOAD_METHOD = 'human-palette-rows';

/** What the LUT did since construction, read by its tests and by a browser probe through the debug
 *  handle's `sheet`. */
export interface HumanPaletteLutStats {
  /** Humans composed into a row. */
  composed: number;
  /** Human row pairs uploaded one by one. */
  rowUploads: number;
  /** Whole-texture uploads: the first, a context restore, a resize, or a flush past the threshold. */
  wholeUploads: number;
  /** Shared fallback rows handed out, one per call, while every private row was drawn this frame or last. */
  sharedFallbacks: number;
}

/** The armor recipe join: worn armor `goodType` to its `TArmorType`, and the soldier jobs, which apply
 *  tier 0's recipe while they wear none. */
export interface HumanArmorPalettes {
  readonly tierByGood: ReadonlyMap<number, number>;
  readonly soldierJobs: ReadonlySet<number>;
}

interface Entry {
  readonly key: number;
  readonly slot: number;
  readonly identity: HumanPaletteIdentity;
  lastFrame: number;
}

/** The LUT's texture: its CPU rows plus the humans whose rows changed since the last upload. */
class HumanPaletteRowsSource extends BufferImageSource {
  private dirty: Int32Array;
  private dirtyFlags: Uint8Array;
  private dirtyCount = 0;

  constructor(
    private rows: Uint8Array,
    height: number,
    private readonly stats: HumanPaletteLutStats,
  ) {
    super({ resource: rows, width: LUT_WIDTH, height, format: 'rgba8unorm', scaleMode: 'nearest' });
    this.uploadMethodId = UPLOAD_METHOD;
    this.dirty = new Int32Array(height / ROWS_PER_HUMAN);
    this.dirtyFlags = new Uint8Array(height / ROWS_PER_HUMAN);
  }

  replaceRows(rows: Uint8Array, height: number): void {
    this.rows = rows;
    this.resource = rows;
    this.dirty = new Int32Array(height / ROWS_PER_HUMAN);
    this.dirtyFlags = new Uint8Array(height / ROWS_PER_HUMAN);
    this.dirtyCount = 0;
    this.resize(LUT_WIDTH, height);
  }

  markDirty(human: number): void {
    if (this.dirtyFlags[human] === 1) return;
    this.dirtyFlags[human] = 1;
    this.dirty[this.dirtyCount++] = human;
  }

  get changed(): boolean {
    return this.dirtyCount > 0;
  }

  /** The {@link GLTextureUploader} body: the changed humans' row pairs, or everything when the GPU copy
   *  is new, resized or too far behind. */
  uploadTo(glTexture: GlTexture, gl: WebGLRenderingContext | WebGL2RenderingContext, version: number): void {
    const target = glTexture.target;
    const fresh = glTexture.width !== this.width || glTexture.height !== this.height;
    if (fresh) {
      gl.texImage2D(
        target,
        0,
        glTexture.internalFormat,
        this.width,
        this.height,
        0,
        glTexture.format,
        glTexture.type,
        this.rows,
      );
      glTexture.width = this.width;
      glTexture.height = this.height;
      this.stats.wholeUploads++;
    } else if (version < WEBGL2 || this.dirtyCount > WHOLE_UPLOAD_HUMANS) {
      gl.texSubImage2D(target, 0, 0, 0, this.width, this.height, glTexture.format, glTexture.type, this.rows);
      this.stats.wholeUploads++;
    } else {
      const gl2 = gl as WebGL2RenderingContext;
      for (let i = 0; i < this.dirtyCount; i++) {
        const row = (this.dirty[i] ?? 0) * ROWS_PER_HUMAN;
        gl2.texSubImage2D(
          target,
          0,
          0,
          row,
          LUT_WIDTH,
          ROWS_PER_HUMAN,
          glTexture.format,
          glTexture.type,
          this.rows,
          row * ROW_BYTES,
        );
      }
      this.stats.rowUploads += this.dirtyCount;
    }
    for (let i = 0; i < this.dirtyCount; i++) this.dirtyFlags[this.dirty[i] ?? 0] = 0;
    this.dirtyCount = 0;
  }
}

export const humanPaletteRowsUploader: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source, glTexture, gl, webGLVersion) {
    if (source instanceof HumanPaletteRowsSource) source.uploadTo(glTexture, gl, webGLVersion);
  },
};

let uploaderRegistered = false;

/** Teach WebGL renderers the LUT's row uploads; a renderer copies its uploaders when it is built, so
 *  this runs before any is. */
export function registerHumanPaletteUploader(): void {
  if (uploaderRegistered) return;
  uploaderRegistered = true;
  extensions.add({
    type: ExtensionType.TextureUploaderWebGL,
    name: UPLOAD_METHOD,
    ref: humanPaletteRowsUploader,
  });
}

/**
 * The human palette LUT: a row pair per human on screen, body then head, composed from the
 * `humanPalettes` lane when the human first shows or its identity changes, and uploaded row pair by row
 * pair. Rows go to whoever asks first and return once their human has missed a whole frame.
 */
export class HumanPaletteLut implements PaletteLut {
  readonly stats: HumanPaletteLutStats = { composed: 0, rowUploads: 0, wholeUploads: 0, sharedFallbacks: 0 };
  private rows: number;
  private readonly rowSource: HumanPaletteRowsSource;
  private buffer: Uint8Array;
  private readonly scratch = createHumanPaletteColours();
  private readonly sharedIdentity: HumanPaletteIdentity;
  private readonly lookIds = new WeakMap<CharacterPalette, number>();
  private nextLookId = 0;
  private entries = new Map<number, Entry>();
  private shared = new Map<number, Entry>();
  private slots: (Entry | undefined)[] = [];
  /** The player each team slot holds. */
  private teams: (number | undefined)[] = [];
  /** Private humans never handed out yet, then the eviction sweep's position. */
  private unused = 0;
  private hand = 0;
  private sharedHand = 0;
  /** Counts the frames that draw through this LUT; a row drawn in the current one is never given away. */
  private frame = 0;
  /** A sweep this frame found every private row drawn lately, so the rest of the frame skips it. */
  private exhausted = false;

  constructor(
    readonly book: HumanPaletteBook,
    readonly armor: HumanArmorPalettes,
    rows = HUMAN_LUT_ROWS,
  ) {
    this.rows = evenRows(rows);
    this.buffer = new Uint8Array(this.rows * ROW_BYTES);
    this.rowSource = new HumanPaletteRowsSource(this.buffer, this.rows, this.stats);
    this.sharedIdentity = createHumanPaletteIdentity({ body: '', head: '', random: [] });
  }

  /** The row count that gives `humans` humans a private row pair each, for a LUT sized to a known cast. */
  static rowsFor(humans: number): number {
    return (humans + SHARED_HUMANS + TEAM_HUMANS) * ROWS_PER_HUMAN;
  }

  get source(): TextureSource {
    return this.rowSource;
  }

  get colours(): number {
    return this.rows;
  }

  /** Shrink to what the device can hold; every human is recomposed on its next draw. */
  fitTo(maxTextureSize: number): void {
    const rows = evenRows(Math.min(this.rows, maxTextureSize));
    if (rows === this.rows) return;
    this.rows = rows;
    this.buffer = new Uint8Array(rows * ROW_BYTES);
    this.entries = new Map();
    this.shared = new Map();
    this.slots = [];
    this.teams = [];
    this.unused = 0;
    this.hand = 0;
    this.sharedHand = 0;
    this.exhausted = false;
    this.rowSource.replaceRows(this.buffer, rows);
  }

  /** Start a frame: rows asked for from here on count as drawn in it. */
  beginFrame(): void {
    this.frame++;
    this.exhausted = false;
  }

  /**
   * The body row of the human under `key` (an entity id) drawn this frame with `identity`; its head row
   * follows at {@link HUMAN_HEAD_ROW_OFFSET}. The row holds while the key is drawn every frame, and a
   * changed identity recomposes it in place. When every private row was drawn this frame or the last, the
   * human gets a row shared by its look, player and sex, composed with seed 0.
   */
  rowFor(key: number, identity: HumanPaletteIdentity): number {
    const held = this.entries.get(key);
    if (held !== undefined) return this.keep(held, identity);
    const slot = this.freePrivateSlot();
    if (slot < 0) return this.sharedRow(identity);
    return this.assign(this.entries, key, slot, identity);
  }

  /**
   * The body row of `player`'s unrolled team palette ({@link HumanPaletteBook.composeTeam}), composed on
   * first ask and held until the LUT is resized.
   */
  teamRow(player: number): number {
    const team = player % TEAM_HUMANS;
    const slot = this.privateSlots + SHARED_HUMANS + team;
    if (this.teams[team] !== player) {
      this.teams[team] = player;
      this.book.composeTeam(player, this.scratch);
      this.writeSlot(slot);
    }
    return slot * ROWS_PER_HUMAN;
  }

  /** Upload what changed since the last flush; call once the frame's rows are all asked for. */
  flush(): void {
    if (this.rowSource.changed) this.rowSource.update();
  }

  private get privateSlots(): number {
    return this.rows / ROWS_PER_HUMAN - SHARED_HUMANS - TEAM_HUMANS;
  }

  private keep(entry: Entry, identity: HumanPaletteIdentity): number {
    entry.lastFrame = this.frame;
    if (!sameHumanPaletteIdentity(entry.identity, identity)) {
      copyHumanPaletteIdentity(identity, entry.identity);
      this.compose(entry);
    }
    return entry.slot * ROWS_PER_HUMAN;
  }

  private assign(
    owners: Map<number, Entry>,
    key: number,
    slot: number,
    identity: HumanPaletteIdentity,
  ): number {
    const previous = this.slots[slot];
    if (previous !== undefined) (slot < this.privateSlots ? this.entries : this.shared).delete(previous.key);
    const copy = createHumanPaletteIdentity(identity.look);
    copyHumanPaletteIdentity(identity, copy);
    const entry: Entry = { key, slot, identity: copy, lastFrame: this.frame };
    owners.set(key, entry);
    this.slots[slot] = entry;
    this.compose(entry);
    return slot * ROWS_PER_HUMAN;
  }

  /**
   * A never-used private slot, else one drawn neither last frame nor this one; -1 when none is. A row
   * drawn last frame is never taken, since its human is likely still on screen and taking it would push
   * that human onto another row in turn.
   */
  private freePrivateSlot(): number {
    const count = this.privateSlots;
    if (this.unused < count) return this.unused++;
    if (this.exhausted) return -1;
    const slot = this.sweep(count, this.frame - 1);
    if (slot < 0) this.exhausted = true;
    return slot;
  }

  /** One lap of the private slots from the hand for one last drawn before `staleBefore`; -1 if none. */
  private sweep(count: number, staleBefore: number): number {
    for (let n = 0; n < count; n++) {
      const slot = this.hand;
      this.hand = (this.hand + 1) % count;
      const entry = this.slots[slot];
      if (entry === undefined || entry.lastFrame < staleBefore) return slot;
    }
    return -1;
  }

  /**
   * Approximation for an overfull screen: humans past the private rows share a row per look, player and
   * sex, without their own rolls. When even the shared rows were all drawn this frame the oldest is
   * recomposed for the newcomer, so its earlier holders show the newcomer's colours this frame.
   */
  private sharedRow(identity: HumanPaletteIdentity): number {
    this.stats.sharedFallbacks++;
    const fallback = this.sharedIdentity;
    fallback.look = identity.look;
    fallback.player = identity.player;
    fallback.female = identity.female;
    const key =
      (this.lookId(identity.look) * PLAYER_KEYS + identity.player) * SEXES + Number(identity.female);
    const held = this.shared.get(key);
    if (held !== undefined) return this.keep(held, fallback);
    const first = this.privateSlots;
    let slot = first + this.sharedHand;
    for (let n = 0; n < SHARED_HUMANS; n++) {
      const candidate = first + ((this.sharedHand + n) % SHARED_HUMANS);
      const entry = this.slots[candidate];
      if (entry === undefined || entry.lastFrame < this.frame) {
        slot = candidate;
        break;
      }
    }
    this.sharedHand = (slot - first + 1) % SHARED_HUMANS;
    return this.assign(this.shared, key, slot, fallback);
  }

  private lookId(look: CharacterPalette): number {
    let id = this.lookIds.get(look);
    if (id === undefined) {
      id = this.nextLookId++;
      this.lookIds.set(look, id);
    }
    return id;
  }

  private compose(entry: Entry): void {
    this.book.compose(entry.identity, this.scratch);
    this.writeSlot(entry.slot);
  }

  private writeSlot(slot: number): void {
    const row = slot * ROWS_PER_HUMAN;
    writeRow(this.buffer, row, this.scratch.body);
    writeRow(this.buffer, row + HUMAN_HEAD_ROW_OFFSET, this.scratch.head);
    this.rowSource.markDirty(slot);
    this.stats.composed++;
  }
}

function evenRows(rows: number): number {
  return Math.floor(rows / ROWS_PER_HUMAN) * ROWS_PER_HUMAN;
}

function writeRow(buffer: Uint8Array, row: number, rgb: Uint8Array): void {
  let at = row * ROW_BYTES;
  for (let i = 0; i < rgb.length; i += RGB) {
    buffer[at] = rgb[i] ?? 0;
    buffer[at + 1] = rgb[i + 1] ?? 0;
    buffer[at + 2] = rgb[i + 2] ?? 0;
    buffer[at + 3] = OPAQUE;
    at += RGBA;
  }
}
