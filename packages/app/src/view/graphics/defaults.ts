import type { TierResult } from '@pmndrs/detect-gpu';
import type { MenuSettings } from '../settings/store.js';

export type GraphicsProfile = 'performance' | 'balanced' | 'quality';

type GraphicsDefaults = Pick<
  MenuSettings,
  | 'enhancedSampling'
  | 'pixelArtScaler'
  | 'softShadows'
  | 'enhancedWater'
  | 'environmentMotion'
  | 'groundedBuildings'
  | 'buildingDamage'
  | 'weather'
  | 'dayNight'
  | 'postFxEnabled'
>;

export interface GraphicsRecommendation {
  readonly profile: GraphicsProfile;
  /** Why the profile sits below the library's tier, for the boot log; null where it does not. */
  readonly cap: 'two-unit-radeon' | null;
  readonly settings: GraphicsDefaults;
}

/** Ryzen APUs report no model, only `AMD Radeon(TM) Graphics` and, through ANGLE, the PCI device id. */
const MODEL_LESS_RADEON = /AMD Radeon\(TM\) Graphics \(0x([0-9a-f]+)\)/i;
/** Device ids, from the published PCI ID list, of AMD's two-compute-unit RDNA 2 iGPUs: Granite Ridge,
 *  Mendocino and Raphael, sold as Radeon 610M or AMD Radeon Graphics. The library matches their
 *  model-less name to a discrete card at tier 3; by unit count and clock they have under a third of the
 *  seven-unit Vega 7 that Quality was measured to fit, an estimate (docs/GRAPHICS.md). */
const TWO_UNIT_RADEON_DEVICE_IDS: ReadonlySet<number> = new Set([0x13c0, 0x1506, 0x164e]);
const HEX_RADIX = 16;

function isTwoUnitRadeon(renderer: string | null): boolean {
  const id = renderer === null ? undefined : MODEL_LESS_RADEON.exec(renderer)?.[1];
  return id !== undefined && TWO_UNIT_RADEON_DEVICE_IDS.has(Number.parseInt(id, HEX_RADIX));
}

/** The library's benchmark tiers already account for display size. This mapping is our quality
 * policy, not a promise that its benchmark FPS equals this game's frame rate. */
export function recommendGraphics(
  result: TierResult,
  renderer: string | null = null,
): GraphicsRecommendation {
  const benchmark = result.type === 'BENCHMARK';
  const tierProfile: GraphicsProfile =
    benchmark && result.tier === 3 ? 'quality' : benchmark && result.tier === 2 ? 'balanced' : 'performance';
  const cap = tierProfile === 'quality' && isTwoUnitRadeon(renderer) ? 'two-unit-radeon' : null;
  const profile: GraphicsProfile = cap === null ? tierProfile : 'balanced';
  const effects = profile !== 'performance';
  return {
    profile,
    cap,
    settings: {
      enhancedSampling: profile === 'quality',
      pixelArtScaler: 'xbr',
      softShadows: effects,
      enhancedWater: effects,
      environmentMotion: effects,
      groundedBuildings: effects,
      buildingDamage: effects,
      weather: effects,
      dayNight: effects,
      postFxEnabled: effects,
    },
  };
}
