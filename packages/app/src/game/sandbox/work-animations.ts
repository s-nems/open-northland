import { HAMMER_TICKS_PER_FRAME } from '../../content/settler-gfx/index.js';

// The extracted `viking_builder_build_house` `length 15`, scaled by the render clip's half cadence
// because the authored 1 frame/tick pace reads frantically fast (named approximation). The whole swing
// plays once per construct atomic, and labor advances per completed swing.
export const BUILD_HOUSE_SWING_LENGTH = 15 * HAMMER_TICKS_PER_FRAME;
export const BUILD_HOUSE_ANIMATION = 'viking_builder_build_house';
// The extracted `viking_scout_build_guide` `length 15`, at the builder swing's cadence.
export const BUILD_GUIDE_SWING_LENGTH = 15 * HAMMER_TICKS_PER_FRAME;
export const BUILD_GUIDE_ANIMATION = 'viking_scout_build_guide';
// `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` in `logicdefines.inc`: the frame an animation sounds its
// FX, which is mid-swing rather than at completion.
export const PLAY_SOUND_FX_EVENT_TYPE = 34;
// The extracted `event 4 34 1` on `viking_builder_build_house`, at the swing's scaled cadence.
export const BUILD_HOUSE_STRIKE_FRAME = 4 * HAMMER_TICKS_PER_FRAME;
// Extracted from `DataCnmd/atomicanimations12/atomicanimations.ini`; the names are the original's own
// `setatomic 18 29/34/35` bindings.
export const FARMER_REAP_ANIMATION = 'viking_farmer_harvest_wheat';
export const FARMER_REAP_LENGTH = 24;
export const FARMER_SOW_ANIMATION = 'viking_farmer_plant';
export const FARMER_SOW_LENGTH = 24;
export const FARMER_WATER_ANIMATION = 'viking_farmer_cultivate';
export const FARMER_WATER_LENGTH = 29;
// The generic store-exchange animations (bound to the catalog's STORE_PICKUP/PILEUP_ATOMIC pair) and
// their duration, transcribed from the extracted viking clips: the original binds a per-body-class
// `viking_<class>_pickup`/`_pileup` per job (`tribetypes.ini setatomic <job> 22/23`); the civilist pair
// is `length 20` (`DataCnmd/atomicanimations12/atomicanimations.ini` - other body classes differ, e.g.
// viking_woman_pickup is 30, but every sandbox trade inherits the civilist pair via `baseatomics 6`). The
// duration is also how long a settler stays inside a building store on an exchange (the render hides it for
// the duration).
export const STORE_PICKUP_ANIMATION = 'viking_pickup';
export const STORE_PILEUP_ANIMATION = 'viking_pileup';
export const STORE_EXCHANGE_LENGTH = 20;
// The gossip talk/listen clocks - EXTRACTED from the mod's `atomicanimations12/atomicanimations.ini`:
// civilist talk/listen 247, woman talk/listen 100. Each clip restores the company bar in five
// channel-3 pulses (`event <at> 3 <delta>`) at the frames below; the talker's pulses are +800 each
// (5×800 = the 4000-unit full bar), the woman's listen +100 each (her listening restores little -
// she recovers on her talking turn; the civilist listen is +800 like his talk).
export const CIVILIST_TALK_ANIMATION = 'viking_civilist_talk';
export const CIVILIST_LISTEN_ANIMATION = 'viking_civilist_listen';
export const CIVILIST_TALK_LENGTH = 247;
export const CIVILIST_TALK_PULSE_FRAMES = [40, 80, 120, 150, 195] as const;
export const WOMAN_TALK_ANIMATION = 'viking_woman_talk';
export const WOMAN_LISTEN_ANIMATION = 'viking_woman_listen';
export const WOMAN_TALK_LENGTH = 100;
export const WOMAN_TALK_PULSE_FRAMES = [20, 40, 60, 80, 95] as const;
// The `atomicanimations.ini` channel ids the pulses restore (`ATOMIC_ANIMATION_EVENT_TYPE_CHANGE_SOCIAL`,
// logicdefines.inc l.722) and the two pulse magnitudes the extracted clips carry.
export const CHANGE_SOCIAL_EVENT_TYPE = 3;
export const TALK_PULSE_VALUE = 800;
export const LISTEN_QUIET_PULSE_VALUE = 100;
// The recruit's drill repetition inside the barracks - the transcribed `viking_civilist_exercise`
// atomicanimation (`length 28`, one `event 22 29 1`: a single TRAINING experience point). The clip is
// never drawn (the render hides a settler that has gone in), so here it is purely the drill's clock and
// XP carrier; the sim grants that point on completion, not on the transcribed frame.
export const CIVILIST_EXERCISE_ANIMATION = 'viking_civilist_exercise';
export const CIVILIST_EXERCISE_LENGTH = 28;
export const CIVILIST_EXERCISE_XP_FRAME = 22;
export const CIVILIST_EXERCISE_XP = 1;
// The `event <at> <type>` type granting TRAINING experience (`ATOMIC_EVENT_TYPE_GET_TRAINING`,
// logicdefines.inc l.749) - the schooling the `trainfor*` requirement rows read.
export const TRAINING_EXPERIENCE_EVENT_TYPE = 29;
