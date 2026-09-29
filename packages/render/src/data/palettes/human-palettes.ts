import type { HumanPalettes, RandomPalettePatch } from '@open-northland/data';

/** Colours per palette, one 16-colour band per band id. */
const PALETTE_COLOURS = 256;
const BAND_COLOURS = 16;
const RGB = 3;
/** Bytes of one composed palette: 256 RGB triples. */
export const HUMAN_PALETTE_BYTES = PALETTE_COLOURS * RGB;
const BAND_BYTES = BAND_COLOURS * RGB;
/** Recipe band ids from here on address the head palette (`id - 16`), below it the body palette. */
const HEAD_BAND_BASE = PALETTE_COLOURS / BAND_COLOURS;
const HEX_BYTE_DIGITS = 2;
const HEX_RADIX = 16;

/** The cart recipes a crewed handcart or ox cart applies to its driver. */
export type CartRecipe = 'handcart' | 'oxcart';

/** The palette part of one `[jobbasegraphics]` look: its two bases and its `gfxpaletterandom` recipes. */
export interface CharacterPalette {
  /** `gfxpalettebasebody` base name. */
  readonly body: string;
  /** `gfxpalettebasehead` base name. */
  readonly head: string;
  /** Recipe names, one of which each human rolls. */
  readonly random: readonly string[];
}

/** Everything that decides one human's composed palettes. */
export interface HumanPaletteIdentity {
  look: CharacterPalette;
  /** Team-colour slot, which picks the player recipe. */
  player: number;
  /** Picks the `woman_NN` player recipe over `player_NN`; girls included. */
  female: boolean;
  /** The `[jobchangegraphics]` recipe of the current job, if it has one. */
  jobChange: string | undefined;
  /** Worn `TArmorType`, which picks a `human_armor_NNN` recipe. */
  armorTier: number | undefined;
  cart: CartRecipe | undefined;
  /** The good type the human carries, whose recipe goes on last. */
  carried: number | undefined;
  /** Stable per human; every roll derives from it. */
  seed: number;
}

export function createHumanPaletteIdentity(look: CharacterPalette): HumanPaletteIdentity {
  return {
    look,
    player: 0,
    female: false,
    jobChange: undefined,
    armorTier: undefined,
    cart: undefined,
    carried: undefined,
    seed: 0,
  };
}

export function sameHumanPaletteIdentity(a: HumanPaletteIdentity, b: HumanPaletteIdentity): boolean {
  return (
    a.look === b.look &&
    a.player === b.player &&
    a.female === b.female &&
    a.jobChange === b.jobChange &&
    a.armorTier === b.armorTier &&
    a.cart === b.cart &&
    a.carried === b.carried &&
    a.seed === b.seed
  );
}

export function copyHumanPaletteIdentity(from: HumanPaletteIdentity, to: HumanPaletteIdentity): void {
  to.look = from.look;
  to.player = from.player;
  to.female = from.female;
  to.jobChange = from.jobChange;
  to.armorTier = from.armorTier;
  to.cart = from.cart;
  to.carried = from.carried;
  to.seed = from.seed;
}

/** One human's composed palettes, {@link HUMAN_PALETTE_BYTES} RGB bytes each. */
export interface HumanPaletteColours {
  readonly body: Uint8Array;
  readonly head: Uint8Array;
}

export function createHumanPaletteColours(): HumanPaletteColours {
  return { body: new Uint8Array(HUMAN_PALETTE_BYTES), head: new Uint8Array(HUMAN_PALETTE_BYTES) };
}

type PatchSource = { readonly ramp: Uint8Array | undefined } | { readonly copyBand: number };

interface BandRoll {
  readonly band: number;
  readonly sources: readonly PatchSource[];
  readonly weights: readonly number[];
  readonly total: number;
}

/** Recipe stages, each rolling from a stream of its own, so a later stage (armor, a cart) never shifts
 *  what an earlier one rolled. */
const STAGE_PLAYER = 1;
const STAGE_PICK = 2;
const STAGE_RANDOM = 3;
const STAGE_JOB_CHANGE = 4;
const STAGE_ARMOR = 5;
const STAGE_CART = 6;
const STAGE_GOOD = 7;
/** An empty set of bands; a band set holds one bit per band id. */
const NO_BANDS = 0;

/**
 * The `humanPalettes` lane made ready to compose: colours decoded, each recipe grouped into its band
 * rolls. `fallbackBase` stands in for a look base the lane does not carry; `parentJobs` maps a job to the
 * `jobtypes.ini` base job its change recipe falls back to.
 */
export class HumanPaletteBook {
  private readonly bases = new Map<string, Uint8Array>();
  private readonly recipes = new Map<string, readonly BandRoll[]>();
  private readonly players = new Map<number, { readonly male: string; readonly female: string }>();
  /** Each `(tribe, job)` record's recipe; null for a record that applies none. */
  private readonly jobChanges = new Map<number, string | null>();
  /** {@link jobChangeRecipe} answers by `(tribe, job)` key, the parent chain already followed. */
  private readonly resolvedJobChanges = new Map<number, string | null>();
  private readonly armorRecipes: readonly string[];
  private readonly cartRecipes: Readonly<Record<CartRecipe, string>>;
  private readonly goodRecipes = new Map<number, string>();
  private readonly rng = new PaletteRng();

  constructor(
    lane: HumanPalettes,
    private readonly fallbackBase: string,
    private readonly parentJobs: ReadonlyMap<number, number> = new Map(),
  ) {
    for (const [name, hex] of Object.entries(lane.bases)) this.bases.set(name, decodeHex(hex));
    const ramps = new Map<string, Uint8Array>();
    for (const [name, hex] of Object.entries(lane.ramps)) ramps.set(name, decodeHex(hex));
    for (const recipe of lane.recipes) this.recipes.set(recipe.name, bandRolls(recipe.patches, ramps));
    for (const p of lane.players) this.players.set(p.player, { male: p.male, female: p.female });
    for (const change of lane.jobChanges) {
      const key = jobKey(change.tribe, change.job);
      if (!this.jobChanges.has(key)) this.jobChanges.set(key, change.recipe ?? null);
    }
    this.armorRecipes = lane.armorRecipes;
    this.cartRecipes = lane.cartRecipes;
    for (const g of lane.goodRecipes)
      if (!this.goodRecipes.has(g.good)) this.goodRecipes.set(g.good, g.recipe);
  }

  /** Whether the lane carries anything to compose team colours from. */
  get composable(): boolean {
    return this.players.size > 0;
  }

  /** The recipe a human rolls on changing into `job`, or undefined. A job without a change record of
   *  its tribe takes its parent job's, up the base-job chain; a record naming no recipe stops the walk
   *  and applies nothing (original behavior). */
  jobChangeRecipe(tribe: number | undefined, job: number | undefined): string | undefined {
    if (tribe === undefined || job === undefined) return undefined;
    const key = jobKey(tribe, job);
    let recipe = this.resolvedJobChanges.get(key);
    if (recipe === undefined) {
      recipe = null;
      let current: number | undefined = job;
      for (let step = 0; current !== undefined && step <= this.parentJobs.size; step++) {
        const own = this.jobChanges.get(jobKey(tribe, current));
        if (own !== undefined) {
          recipe = own;
          break;
        }
        current = this.parentJobs.get(current);
      }
      this.resolvedJobChanges.set(key, recipe);
    }
    return recipe ?? undefined;
  }

  /**
   * Compose `identity`'s palettes into `out`: the look's bases, then its player recipe by sex, one recipe
   * rolled from the look's list, the job-change recipe, the worn armor's recipe, the cart's, and last the
   * carried good's.
   *
   * The good recipe is a project choice, not the original's behavior (the original draws a carried good
   * through the human palette unchanged). It skips every band the player recipe wrote, so a woman's
   * team-coloured dress stays while the band her load shares with it takes the good's colours.
   */
  compose(identity: HumanPaletteIdentity, out: HumanPaletteColours): void {
    const { look, seed } = identity;
    out.body.set(this.base(look.body));
    out.head.set(this.base(look.head));
    const player = this.players.get(identity.player);
    const teamBands =
      player === undefined
        ? NO_BANDS
        : this.apply(identity.female ? player.female : player.male, seed, STAGE_PLAYER, out);
    if (look.random.length > 0) {
      this.rng.seed(seed, STAGE_PICK);
      const pick = look.random[this.rng.below(look.random.length)];
      if (pick !== undefined) this.apply(pick, seed, STAGE_RANDOM, out);
    }
    if (identity.jobChange !== undefined) this.apply(identity.jobChange, seed, STAGE_JOB_CHANGE, out);
    if (identity.armorTier !== undefined) {
      const armor = this.armorRecipes[identity.armorTier];
      if (armor !== undefined) this.apply(armor, seed, STAGE_ARMOR, out);
    }
    if (identity.cart !== undefined) this.apply(this.cartRecipes[identity.cart], seed, STAGE_CART, out);
    const good = identity.carried === undefined ? undefined : this.goodRecipes.get(identity.carried);
    if (good !== undefined) this.apply(good, seed, STAGE_GOOD, out, teamBands);
  }

  /**
   * `player`'s team palette: the fallback base with the male player recipe's first line on every band it
   * patches, unrolled, so its vest band carries the plain `Player NN` ramp a hero's glow reads.
   */
  composeTeam(player: number, out: HumanPaletteColours): void {
    out.body.set(this.base(this.fallbackBase));
    out.head.set(this.base(this.fallbackBase));
    const recipes = this.players.get(player);
    if (recipes !== undefined) this.apply(recipes.male, 0, STAGE_PLAYER, out, NO_BANDS, true);
  }

  private base(name: string): Uint8Array {
    return this.bases.get(name) ?? this.bases.get(this.fallbackBase) ?? EMPTY_PALETTE;
  }

  /**
   * Each band rolls one of its lines by weight, in the order the bands first appear, or takes its first
   * line when `firstLine`; a copy reads the palette as composed so far, earlier bands of the same recipe
   * included. A band in `keep` (one bit per band id) still rolls but is left as it is. Answers the bands
   * the recipe wrote.
   */
  private apply(
    name: string,
    seed: number,
    stage: number,
    out: HumanPaletteColours,
    keep = NO_BANDS,
    firstLine = false,
  ): number {
    const rolls = this.recipes.get(name);
    if (rolls === undefined) return NO_BANDS;
    let written = NO_BANDS;
    this.rng.seed(seed, stage);
    for (const roll of rolls) {
      let pick = firstLine ? 0 : this.rng.below(roll.total);
      let chosen: PatchSource | undefined;
      for (let i = 0; i < roll.sources.length; i++) {
        const weight = roll.weights[i] ?? 0;
        if (pick < weight) {
          chosen = roll.sources[i];
          break;
        }
        pick -= weight;
      }
      const bit = 1 << roll.band;
      if (chosen === undefined || (keep & bit) !== 0) continue;
      written |= bit;
      const target = bandPalette(out, roll.band);
      const at = bandStart(roll.band);
      if ('copyBand' in chosen) {
        const from = bandPalette(out, chosen.copyBand);
        const fromAt = bandStart(chosen.copyBand);
        if (from === target) target.copyWithin(at, fromAt, fromAt + BAND_BYTES);
        else target.set(from.subarray(fromAt, fromAt + BAND_BYTES), at);
      } else if (chosen.ramp !== undefined) {
        target.set(chosen.ramp, at);
      }
    }
    return written;
  }
}

const EMPTY_PALETTE = new Uint8Array(HUMAN_PALETTE_BYTES);

/** Job type ids stay below this, so a tribe and a job share one numeric key. */
const JOB_KEYS = 0x1_0000;

function jobKey(tribe: number, job: number): number {
  return tribe * JOB_KEYS + job;
}

/** The palette a band id addresses. */
function bandPalette(out: HumanPaletteColours, band: number): Uint8Array {
  return band < HEAD_BAND_BASE ? out.body : out.head;
}

/** A band id's first byte in the palette it addresses. */
function bandStart(band: number): number {
  return (band % HEAD_BAND_BASE) * BAND_BYTES;
}

/** Group a recipe's lines by band id in first-appearance order; a band whose weights sum to zero never
 *  applies. A line naming a ramp the lane lacks keeps its weight and changes nothing. */
function bandRolls(
  patches: readonly RandomPalettePatch[],
  ramps: ReadonlyMap<string, Uint8Array>,
): BandRoll[] {
  const byBand = new Map<number, { sources: PatchSource[]; weights: number[] }>();
  for (const patch of patches) {
    let group = byBand.get(patch.band);
    if (group === undefined) {
      group = { sources: [], weights: [] };
      byBand.set(patch.band, group);
    }
    group.sources.push(
      patch.source.kind === 'copy' ? { copyBand: patch.source.band } : { ramp: ramps.get(patch.source.ramp) },
    );
    group.weights.push(patch.weight);
  }
  const rolls: BandRoll[] = [];
  for (const [band, group] of byBand) {
    const total = group.weights.reduce((sum, w) => sum + w, 0);
    if (total > 0) rolls.push({ band, sources: group.sources, weights: group.weights, total });
  }
  return rolls;
}

function decodeHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / HEX_BYTE_DIGITS);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * HEX_BYTE_DIGITS, (i + 1) * HEX_BYTE_DIGITS), HEX_RADIX);
  }
  return bytes;
}

/** Mixing constants of the 32-bit finalizer (MurmurHash3 `fmix32`) and the Weyl step of mulberry32. */
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const WEYL = 0x6d2b79f5;
const STAGE_SALT = 0x9e3779b9;
const UINT32 = 0x1_0000_0000;

/**
 * A small deterministic generator for cosmetic rolls (mulberry32), seeded per human and stage. Render
 * only: it never touches sim state, so it does not need the sim's RNG.
 */
class PaletteRng {
  private state = 0;

  seed(seed: number, stage: number): void {
    this.state = fmix32((seed ^ Math.imul(stage, STAGE_SALT)) >>> 0);
  }

  /** A whole number in `[0, n)`; `n` of 0 or 1 still consumes a draw, so streams stay aligned. */
  below(n: number): number {
    const draw = this.next();
    return n <= 1 ? 0 : Math.floor((draw / UINT32) * n);
  }

  /** mulberry32's output step; its shifts and odd multipliers are part of the published algorithm. */
  private next(): number {
    this.state = (this.state + WEYL) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
}

function fmix32(h: number): number {
  let x = h;
  x ^= x >>> 16;
  x = Math.imul(x, MIX_A);
  x ^= x >>> 13;
  x = Math.imul(x, MIX_B);
  x ^= x >>> 16;
  return x >>> 0;
}
