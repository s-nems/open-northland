import { TICKS_PER_SECOND } from '../../../core/loop.js';

/**
 * One barracks term, 15 s of game time. A recruit's enlistment and the coin drill one coin pays for both
 * last it, on purpose: a drilling soldier stays inside as long as a recruit does. A leaf module, so both
 * drills read it without an import cycle. Source basis: authored.
 */
export const BARRACKS_TERM_TICKS = 15 * TICKS_PER_SECOND;
