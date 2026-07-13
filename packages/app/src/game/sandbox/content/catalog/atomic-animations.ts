import { HARVEST_TICKS } from '../../../../content/settler-gfx/index.js';
import {
  ATTACK_EVENT_TYPE,
  BROADSWORD_HIT_FRAME,
  BROADSWORD_SWING_LENGTH,
  FIST_HIT_FRAME,
  FIST_SWING_LENGTH,
  LONG_BOW_DRAW_LENGTH,
  LONG_BOW_RELEASE_FRAME,
  SHORT_BOW_DRAW_LENGTH,
  SHORT_BOW_RELEASE_FRAME,
  SPEAR_HIT_FRAME,
  SPEAR_SWING_LENGTH,
  SWORD_HIT_FRAME,
  SWORD_SWING_LENGTH,
} from '../../combat.js';
import { GATHERERS } from '../../ids/index.js';
import {
  BUILD_HOUSE_ANIMATION,
  BUILD_HOUSE_SWING_LENGTH,
  FARMER_REAP_ANIMATION,
  FARMER_REAP_LENGTH,
  FARMER_SOW_ANIMATION,
  FARMER_SOW_LENGTH,
  FARMER_WATER_ANIMATION,
  FARMER_WATER_LENGTH,
  STORE_EXCHANGE_LENGTH,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
} from '../../work-animations.js';

/** Build the animation-duration/event catalog consumed by atomic bindings. */
export function buildSandboxAtomicAnimations(): readonly object[] {
  return [
    ...GATHERERS.map((gatherer) => ({
      id: gatherer.animation,
      name: gatherer.animation,
      length: HARVEST_TICKS[gatherer.atomic] ?? 1,
    })),
    { id: STORE_PICKUP_ANIMATION, name: STORE_PICKUP_ANIMATION, length: STORE_EXCHANGE_LENGTH },
    { id: STORE_PILEUP_ANIMATION, name: STORE_PILEUP_ANIMATION, length: STORE_EXCHANGE_LENGTH },
    {
      id: 'viking_fist_attack',
      name: 'viking_fist_attack',
      length: FIST_SWING_LENGTH,
      events: [{ at: FIST_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    {
      id: 'viking_spear_attack',
      name: 'viking_spear_attack',
      length: SPEAR_SWING_LENGTH,
      events: [{ at: SPEAR_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    {
      id: 'viking_sword_attack',
      name: 'viking_sword_attack',
      length: SWORD_SWING_LENGTH,
      events: [{ at: SWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    {
      id: 'viking_broadsword_attack',
      name: 'viking_broadsword_attack',
      length: BROADSWORD_SWING_LENGTH,
      events: [{ at: BROADSWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    {
      id: 'viking_bow_attack',
      name: 'viking_bow_attack',
      length: SHORT_BOW_DRAW_LENGTH,
      events: [{ at: SHORT_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    {
      id: 'viking_bow_long_attack',
      name: 'viking_bow_long_attack',
      length: LONG_BOW_DRAW_LENGTH,
      events: [{ at: LONG_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE }],
    },
    { id: BUILD_HOUSE_ANIMATION, name: BUILD_HOUSE_ANIMATION, length: BUILD_HOUSE_SWING_LENGTH },
    { id: FARMER_REAP_ANIMATION, name: FARMER_REAP_ANIMATION, length: FARMER_REAP_LENGTH },
    { id: FARMER_SOW_ANIMATION, name: FARMER_SOW_ANIMATION, length: FARMER_SOW_LENGTH },
    { id: FARMER_WATER_ANIMATION, name: FARMER_WATER_ANIMATION, length: FARMER_WATER_LENGTH },
  ];
}
