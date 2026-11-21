import type { WeaponLayout } from '@open-northland/render';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from '../../catalog/jobs.js';
import { paletteLibrary } from './library-layout.js';

/** The ramps the viking `vik_man_soldier_changejob_spear_*` recipes paint the spear with. */
const SPEAR_RAMPS: Readonly<Record<number, string>> = {
  [JOB_SOLDIER_SPEAR_WOODEN]: 'hair brown',
  [JOB_SOLDIER_SPEAR]: 'colors grey',
};

/** The weapon band the viking spear recipes paint, which most soldier bodies draw their spear in. */
const WEAPON_BAND = 14;
/** The Saracen body's spear shaft while walking and striking; its head then shares the trousers' band
 *  and keeps their colour. Standing and picking up, it draws the whole spear in {@link WEAPON_BAND}. */
const SARACEN_SHAFT_BAND = 2;

const spear = (bands: readonly number[]): WeaponLayout => ({ bands, rampByJob: SPEAR_RAMPS });

/** Soldier body stem → the bands its spear is drawn in. The viking body takes its spear colours from
 *  its own job-change recipes and is absent here. */
const WEAPON_BY_BODY: Readonly<Record<string, WeaponLayout>> = {
  // Frankish and Byzantine spearman: shaft and head.
  cr_hum_body_52: spear([WEAPON_BAND]),
  // Frankish soldier body, for a pack that draws the spearmen on it: its spear clips draw shaft and head in
  // the weapon band and nothing else there.
  cr_hum_body_32: spear([WEAPON_BAND]),
  cr_hum_body_42: spear([SARACEN_SHAFT_BAND, WEAPON_BAND]),
  // Egyptian spearman: the shaft; the tip is grey already.
  cr_hum_body_78: spear([WEAPON_BAND]),
};

/** The weapon layout of a look drawn on `body`, if it has one. */
export function weaponLayout(body: string): WeaponLayout | undefined {
  return WEAPON_BY_BODY[paletteLibrary(body)];
}
