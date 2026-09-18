import { describe, expect, it } from 'vitest';
import { shipSway } from '../src/gpu/ship-sway.js';

const TICKS = 200;

describe('shipSway', () => {
  it('rolls both ways and heaves upward only, harder under sail than at anchor-less rest', () => {
    let sailingRoll = 0;
    let restingRoll = 0;
    let sailingLift = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      const sailing = shipSway(tick, 10, 20, true);
      const resting = shipSway(tick, 10, 20, false);
      sailingRoll = Math.max(sailingRoll, Math.abs(sailing.shear));
      restingRoll = Math.max(restingRoll, Math.abs(resting.shear));
      sailingLift = Math.max(sailingLift, -sailing.dy);
      expect(sailing.dy).toBeLessThanOrEqual(0);
    }
    expect(sailingRoll).toBeGreaterThan(restingRoll);
    expect(sailingLift).toBeGreaterThan(0);
  });

  it('phases two ships apart by their anchors', () => {
    expect(shipSway(7, 0, 0, true)).not.toEqual(shipSway(7, 300, 120, true));
  });
});
