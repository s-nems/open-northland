import { clamp01 } from '../math.js';
import { TILE_HALF_W } from '../projection/iso.js';
import {
  FIELD_FOREST,
  FIELD_LAND_B,
  FIELD_LAND_G,
  FIELD_LAND_R,
  FIELD_ORE,
  FIELD_ORE_B,
  FIELD_ORE_G,
  FIELD_ORE_R,
} from './minimap-cells.js';
import { hash2, smoothstep, valueNoise } from './minimap-noise.js';
import {
  classifyGround,
  type Dome,
  type GroundClass,
  type LightFrame,
  mixToward,
  type Rgb,
  sampleDomes,
  textureFade,
} from './minimap-texture.js';

/**
 * The minimap's land at sub-cell scale: ground micro-texture by class, canopy crowns and deposit rocks.
 * Every term fades in with the picture's pitch, so a small picture shows only the cell field's colour.
 * Every value is a named approximation tuned by eye.
 */

/** Ground micro-texture by class: grass and soil mottle on one shared noise, soil speckle per px once
 *  a cell spans the speckle's nominal period, and rock crags (a noise lit by its slope toward the
 *  light, probed this far down-light) over long strata. */
const GROUND_PERIOD_CELLS = 0.5;
const GRASS_MOTTLE = 0.16;
const SOIL_MOTTLE = 0.08;
const SPECKLE_PERIOD_CELLS = 0.4;
const SOIL_SPECKLE = 0.1;
const ROCK_SPECKLE = 0.06;
const CRAG_PERIOD_CELLS = 0.6;
const CRAG_RELIEF = 1.8;
const CRAG_PROBE_CELLS = 0.08;
const STRATA_LENGTH_CELLS = 1.4;
const STRATA_HEIGHT_CELLS = 0.3;
const ROCK_STRATA = 0.14;

/** Canopy crowns, domes on a jittered lattice of this period: their radius in lattice units from a
 *  sparse to a full stand, the per-crown radius spread, how much of the crown's own light shows, and
 *  the shade of the ground between crowns. */
const CROWN_PERIOD_CELLS = 0.6;
const CROWN_RADIUS_SPARSE = 0.42;
const CROWN_RADIUS_FULL = 0.72;
const CROWN_RADIUS_JITTER = 0.3;
const CROWN_LIGHT = 0.32;
const CROWN_GAP_SHADE = 0.42;

/** Deposits: an even tint, then rocks of the deposit's colour at full detail (domes sized by the
 *  density, lit like the crowns) with a glint where a rock faces the light. */
const ORE_TINT = 0.22;
const ORE_PERIOD_CELLS = 1;
const ORE_RADIUS_SPARSE = 0.15;
const ORE_RADIUS_FULL = 0.45;
const ORE_RADIUS_JITTER = 0.8;
const ORE_ROCK_STRENGTH = 0.35;
const ORE_ROCK_LIGHT = 0.3;
/** Dome light (relative to flat ground) where the glint starts, its soft span, and its strength. */
const GLINT_LIGHT = 1.9;
const GLINT_SPAN = 0.25;
const GLINT_STRENGTH = 0.35;
const GLINT = 0xfff6dc;

const SEED_GROUND = 0x0cf9ef4d;
const SEED_SPECKLE = 0x6a09e667;
const SEED_CRAG = 0xa54ff53a;
const SEED_STRATA = 0x3c6ef372;
const SEED_CROWN = 0x2545f491;
const SEED_ORE = 0x68e31da4;

/** World px per cell along a row, the unit the texture periods are given in. */
const CELL_W = 2 * TILE_HALF_W;

/** Paints a land sample for one picture size; `textured` is false when the picture supersamples. */
export class LandPainter {
  private readonly groundFade: number;
  private readonly speckleFade: number;
  private readonly cragFade: number;
  private readonly crownFade: number;
  private readonly oreFade: number;
  private readonly groundScale = 1 / (GROUND_PERIOD_CELLS * CELL_W);
  private readonly cragScale = 1 / (CRAG_PERIOD_CELLS * CELL_W);
  private readonly strataX = 1 / (STRATA_LENGTH_CELLS * CELL_W);
  private readonly strataY = 1 / (STRATA_HEIGHT_CELLS * CELL_W);
  private readonly crownScale = 1 / (CROWN_PERIOD_CELLS * CELL_W);
  private readonly oreScale = 1 / (ORE_PERIOD_CELLS * CELL_W);
  private readonly cragProbeX: number;
  private readonly cragProbeY: number;
  /** A dome edge anti-aliases over one px, in lattice units. */
  private readonly crownEdge: number;
  private readonly oreEdge: number;
  private readonly ground: GroundClass = { grass: 0, soil: 0, rock: 0 };
  private readonly dome: Dome = { cover: 0, light: 1 };

  constructor(
    cellPx: number,
    textured: boolean,
    private readonly light: LightFrame,
  ) {
    const fade = (periodCells: number): number => (textured ? textureFade(periodCells, cellPx) : 0);
    this.groundFade = fade(GROUND_PERIOD_CELLS);
    this.speckleFade = fade(SPECKLE_PERIOD_CELLS);
    this.cragFade = fade(CRAG_PERIOD_CELLS);
    this.crownFade = fade(CROWN_PERIOD_CELLS);
    this.oreFade = fade(ORE_PERIOD_CELLS);
    this.cragProbeX = light.downX * CRAG_PROBE_CELLS * CELL_W;
    this.cragProbeY = light.downY * CRAG_PROBE_CELLS * CELL_W;
    this.crownEdge = 1 / (CROWN_PERIOD_CELLS * cellPx);
    this.oreEdge = 1 / (ORE_PERIOD_CELLS * cellPx);
  }

  /** The land colour of sample `s` at world px `(x, y)` in picture px `(px, py)`, into `out`. */
  paint(s: Float64Array, x: number, y: number, px: number, py: number, out: Rgb): void {
    const forest = s[FIELD_FOREST] ?? 0;
    const ore = s[FIELD_ORE] ?? 0;
    out.r = s[FIELD_LAND_R] ?? 0;
    out.g = s[FIELD_LAND_G] ?? 0;
    out.b = s[FIELD_LAND_B] ?? 0;
    let mul = 1 + this.groundTexture(out, x, y, px, py) * (1 - forest);
    if (forest > 0 && this.crownFade > 0) mul *= 1 + this.crownFade * forest * this.crowns(forest, x, y);
    if (ore > 0) this.deposit(s, ore, x, y, out);
    out.r *= mul;
    out.g *= mul;
    out.b *= mul;
  }

  /** The relative brightness change of the ground's micro-texture, by the class of its colour. */
  private groundTexture(colour: Rgb, x: number, y: number, px: number, py: number): number {
    if (this.groundFade <= 0 && this.speckleFade <= 0) return 0;
    const ground = this.ground;
    classifyGround(colour.r, colour.g, colour.b, ground);
    let texture = 0;
    if (this.groundFade > 0) {
      const mottle = valueNoise(x * this.groundScale, y * this.groundScale, SEED_GROUND) - 0.5;
      texture += mottle * this.groundFade * (GRASS_MOTTLE * ground.grass + SOIL_MOTTLE * ground.soil);
    }
    if (this.speckleFade > 0) {
      const speckle = hash2(px, py, SEED_SPECKLE) - 0.5;
      texture += speckle * this.speckleFade * (SOIL_SPECKLE * ground.soil + ROCK_SPECKLE * ground.rock);
    }
    if (this.cragFade > 0 && ground.rock > 0) {
      const crag = valueNoise(x * this.cragScale, y * this.cragScale, SEED_CRAG);
      const downhill = valueNoise(
        (x + this.cragProbeX) * this.cragScale,
        (y + this.cragProbeY) * this.cragScale,
        SEED_CRAG,
      );
      const strata = valueNoise(x * this.strataX, y * this.strataY, SEED_STRATA) - 0.5;
      texture += this.cragFade * ground.rock * ((downhill - crag) * CRAG_RELIEF + strata * ROCK_STRATA);
    }
    return texture;
  }

  /** The relative brightness change of the canopy: lit and shaded crowns, dark gaps between them. */
  private crowns(forest: number, x: number, y: number): number {
    const { dome, light } = this;
    const radius = CROWN_RADIUS_SPARSE + (CROWN_RADIUS_FULL - CROWN_RADIUS_SPARSE) * forest;
    sampleDomes(
      x * this.crownScale,
      y * this.crownScale,
      SEED_CROWN,
      radius,
      CROWN_RADIUS_JITTER,
      this.crownEdge,
      light.x,
      light.y,
      light.z,
      dome,
    );
    return dome.cover * CROWN_LIGHT * (dome.light - 1) - (1 - dome.cover) * CROWN_GAP_SHADE;
  }

  /** Tint `out` with the deposit of density `ore`, with lit rocks and glints at full detail. */
  private deposit(s: Float64Array, ore: number, x: number, y: number, out: Rgb): void {
    let share = ORE_TINT * ore;
    let rockLight = 1;
    let glint = 0;
    if (this.oreFade > 0) {
      const { dome, light } = this;
      const radius = ORE_RADIUS_SPARSE + (ORE_RADIUS_FULL - ORE_RADIUS_SPARSE) * ore;
      sampleDomes(
        x * this.oreScale,
        y * this.oreScale,
        SEED_ORE,
        radius,
        ORE_RADIUS_JITTER,
        this.oreEdge,
        light.x,
        light.y,
        light.z,
        dome,
      );
      share += dome.cover * ORE_ROCK_STRENGTH * this.oreFade;
      rockLight = 1 + dome.cover * ORE_ROCK_LIGHT * this.oreFade * (dome.light - 1);
      glint =
        GLINT_STRENGTH *
        this.oreFade *
        dome.cover *
        smoothstep(clamp01((dome.light - GLINT_LIGHT) / GLINT_SPAN));
    }
    // The ore lanes are premultiplied by density; dividing restores the tint.
    const mix = (share / ore) * rockLight;
    out.r += (s[FIELD_ORE_R] ?? 0) * mix - out.r * share;
    out.g += (s[FIELD_ORE_G] ?? 0) * mix - out.g * share;
    out.b += (s[FIELD_ORE_B] ?? 0) * mix - out.b * share;
    if (glint > 0) mixToward(out, GLINT, glint);
  }
}
