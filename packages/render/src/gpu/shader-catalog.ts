import { WEATHER_KINDS } from '../data/weather/types.js';
import { GROUND_WAVE_FILTER_SOURCE } from './ground-waves/ground-wave-filter.js';
import { DECOR_SHADOW_SOURCE } from './map-objects/decor-shadow-shader.js';
import { PALETTED_SPRITE_SOURCE } from './paletted-sprite/shader.js';
import { WORLD_MAGNIFICATIONS, worldMagnifyModeNumber } from './pixel-art-registry.js';
import type { GlslProgramSource } from './program-source.js';
import { SHADED_DECOR_SOURCE, SHADED_TERRAIN_SOURCE, TINTED_TERRAIN_SOURCE } from './shading.js';
import { DEFAULT_SHADOW_STYLE } from './shadow-style.js';
import { WEATHER_GRADE_SOURCE, WEATHER_VEIL_SOURCE } from './weather/atmosphere.js';
import { GROUND_REACTIONS_SOURCE } from './weather/ground-reactions.js';
import { precipitationSource } from './weather/precipitation-shader.js';
import { WORLD_BATCH_MAX_TEXTURES, WORLD_BATCH_VERTEX, worldBatchFragment } from './world-batch-shader.js';

/**
 * Every GL program the game compiles, in every variant its settings can select, so a check can read
 * or compile the whole set without a renderer. A program whose GLSL is generated lists one entry per
 * generated variant; a new program or variant joins this list in the commit that adds it.
 */
export interface ShaderCatalogEntry {
  /** Stable, path-like: `<program>/<variant>`; a check reports and budgets by it. */
  readonly name: string;
  readonly source: GlslProgramSource;
}

/**
 * Batch texture limits the world batcher is compiled for: WebGL 2 guarantees 16 units; Pixi halves its
 * batch limit where the sampler if-chain fails to compile at a size, down to 8; desktop GL reports up
 * to 32, where the batcher caps its slots.
 */
const WORLD_BATCH_TEXTURE_LIMITS: readonly number[] = [8, 16, WORLD_BATCH_MAX_TEXTURES];

export function shaderCatalog(): readonly ShaderCatalogEntry[] {
  const entries: ShaderCatalogEntry[] = [];
  for (const maxTextures of WORLD_BATCH_TEXTURE_LIMITS) {
    for (const magnification of WORLD_MAGNIFICATIONS) {
      for (const shadow of [null, DEFAULT_SHADOW_STYLE]) {
        entries.push({
          name: `world-batch/textures${maxTextures}/${magnification}/${shadow === null ? 'no-shadow' : 'shadow'}`,
          source: {
            vertex: WORLD_BATCH_VERTEX,
            fragment: worldBatchFragment(maxTextures, worldMagnifyModeNumber(magnification), shadow),
          },
        });
      }
    }
  }
  entries.push(
    { name: 'paletted-sprite', source: PALETTED_SPRITE_SOURCE },
    { name: 'decor-shadow', source: DECOR_SHADOW_SOURCE },
    { name: 'shaded-terrain', source: SHADED_TERRAIN_SOURCE },
    { name: 'shaded-decor', source: SHADED_DECOR_SOURCE },
    { name: 'tinted-terrain', source: TINTED_TERRAIN_SOURCE },
    { name: 'weather-grade', source: WEATHER_GRADE_SOURCE },
    { name: 'weather-veil', source: WEATHER_VEIL_SOURCE },
    { name: 'weather-ground-reactions', source: GROUND_REACTIONS_SOURCE },
    { name: 'ground-wave-filter', source: GROUND_WAVE_FILTER_SOURCE },
  );
  for (const kind of WEATHER_KINDS)
    entries.push({ name: `weather-${kind}`, source: precipitationSource(kind) });
  return entries;
}
