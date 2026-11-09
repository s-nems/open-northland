import { type ArmorBand, type ArmorLayout, type ArmorRamp, headPaletteBand } from '@open-northland/render';
import { paletteLibrary } from './library-layout.js';

/** Ramps by armor tier (none, wool, leather, chain, plate); no ramp keeps the team colour. */
type TierRamps = readonly (ArmorRamp | undefined)[];

/**
 * Chain mail's colour order: neighbouring shades swap in pairs, so the smooth shading these bodies
 * draw their cloth with gains a faint mail grain without breaking into noise.
 */
const MAIL_GRAIN: readonly number[] = [1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15, 14];
const ramp = (name: string): ArmorRamp => ({ ramp: name });
/** The `TArmorType` of chain mail. */
const CHAIN_TIER = 3;

/** A large garment: wool stays warm cloth, leather dark red-brown, chain mail grained silver and plate
 *  dull gold, so no two tiers read alike. */
const MAIN: TierRamps = [
  undefined,
  ramp('colors_pale grey bright'),
  ramp('hair brown dark'),
  { ramp: 'special silver', order: MAIL_GRAIN },
  ramp('special gold'),
];
/** Pads and trim beside a {@link MAIN} garment, a shade apart from it. */
const TRIM: TierRamps = [
  undefined,
  ramp('colors grey'),
  ramp('colors_pale red dark'),
  ramp('colors grey dark'),
  ramp('colors_pale yellow dark'),
];

/** Thin stripes: the {@link MAIN} colours, chain mail smooth since a grain breaks a stripe apart. */
const STRIPES: TierRamps = MAIN.map((tier, index) => (index === CHAIN_TIER ? ramp('special silver') : tier));

const band = (id: number, tiers: TierRamps): ArmorBand => ({ band: id, tiers });

/** Tunic 10, shoulder pads and collar 5; gloves and boots (6), weapons and shield (14, 15) keep theirs,
 *  and the helmet's rim keeps the team colour its random recipe gives it. */
const FRANKISH_SOLDIER: ArmorLayout = { bands: [band(10, MAIN), band(5, TRIM)], team: [] };
/** Shirt 10, sleeves 13; trousers (7, shared with the spear head), sash, boots and weapons keep theirs.
 *  The turban is drawn by the head overlay. */
const SARACEN_SOLDIER: ArmorLayout = { bands: [band(10, MAIN), band(13, TRIM)], team: [] };
/** Kilt 7 and the headdress stripes 11 take the armor, the headdress 9 the team colour: the kilt is
 *  the soldier's one garment, too small alone to show the armor. */
const EGYPTIAN_SOLDIER: ArmorLayout = { bands: [band(7, MAIN), band(11, STRIPES)], team: [9] };

/** Soldier body stem → how its armor colours it; a body absent here takes the armor recipe. */
const ARMOR_BY_BODY: Readonly<Record<string, ArmorLayout>> = {
  cr_hum_body_32: FRANKISH_SOLDIER,
  cr_hum_body_52: FRANKISH_SOLDIER,
  cr_hum_body_42: SARACEN_SOLDIER,
  // Draws its own turban (9).
  cr_hum_body_62: { ...SARACEN_SOLDIER, team: [9] },
  cr_hum_body_78: EGYPTIAN_SOLDIER,
  cr_hum_body_79: EGYPTIAN_SOLDIER,
};

/** Soldier head stem → the head bands that keep the team colour. */
const TEAM_BY_HEAD: Readonly<Record<string, readonly number[]>> = {
  cr_hum_head_42: [headPaletteBand(6)], // turban
  cr_hum_head_43: [headPaletteBand(6)],
};

/** The armor layout of a look drawn on `body` with `heads`, if it has one. */
export function armorLayout(body: string, heads: readonly string[]): ArmorLayout | undefined {
  const layout = ARMOR_BY_BODY[paletteLibrary(body)];
  if (layout === undefined) return undefined;
  const headTeam = heads.flatMap((head) => TEAM_BY_HEAD[paletteLibrary(head)] ?? []);
  return headTeam.length === 0 ? layout : { ...layout, team: [...new Set([...layout.team, ...headTeam])] };
}
