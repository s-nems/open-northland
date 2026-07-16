import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR, rebaseSlotJob } from '../src/game/sandbox/ids/index.js';
import { currentTradeSlotAt } from '../src/view/unit-controls/assign-highlight.js';

/**
 * The "przydziel miejsce pracy" verdict — the button places the settler's CURRENT trade only, so a
 * building is green iff it offers that exact trade (canonically) with a free slot. Matched by
 * `canonicalJobType`, so a picker-assigned raw id lines up with the building's rebased slot id.
 */

const COIN_MAKER = 14; // jobtypes.ini coin maker (a picker/raw id)
const MILL_SLOTS = [
  { jobType: 19, count: 2 }, // miller
  { jobType: JOB_CARRIER, count: 1 },
];
// A mint whose coin-maker slot is sandbox-rebased (14 -> 1014), the id space the browser/headless slots use.
const MINT_SLOTS = [
  { jobType: rebaseSlotJob(COIN_MAKER), count: 2 },
  { jobType: JOB_CARRIER, count: 1 },
];
const WAREHOUSE_SLOTS = [
  { jobType: JOB_CARRIER, count: 3 },
  { jobType: rebaseSlotJob(JOB_COLLECTOR), count: 3 }, // a collector (gatherer) slot
];

describe('currentTradeSlotAt — the current-trade green/red verdict', () => {
  it('greens a mint for a coin-maker, matching the rebased slot to the raw current id', () => {
    // The settler is a coin-maker (raw id 14); the mint slot is rebased (1014). They match canonically.
    expect(currentTradeSlotAt(COIN_MAKER, MINT_SLOTS, undefined)).toBe(rebaseSlotJob(COIN_MAKER));
  });

  it('reds a mill for a coin-maker — the building does not offer that trade', () => {
    expect(currentTradeSlotAt(COIN_MAKER, MILL_SLOTS, undefined)).toBeNull();
  });

  it('reds a building whose matching slot is already full (no re-trade, no fallback)', () => {
    const full = new Map<number, number>([[rebaseSlotJob(COIN_MAKER), 2]]);
    expect(currentTradeSlotAt(COIN_MAKER, MINT_SLOTS, full)).toBeNull();
  });

  it('greens a warehouse for a collector via its gatherer slot', () => {
    expect(currentTradeSlotAt(JOB_COLLECTOR, WAREHOUSE_SLOTS, undefined)).toBe(rebaseSlotJob(JOB_COLLECTOR));
  });

  it('never falls back to the carrier — a miller on a mint stays red, not a hauler', () => {
    // The button does not re-trade: a miller aimed at a mint (no miller slot) is red, never bound as carrier.
    expect(currentTradeSlotAt(19, MINT_SLOTS, undefined)).toBeNull();
  });

  it('reds an employed-nobody / jobless case', () => {
    expect(currentTradeSlotAt(COIN_MAKER, undefined, undefined)).toBeNull();
    expect(currentTradeSlotAt(undefined, MINT_SLOTS, undefined)).toBeNull();
  });
});
