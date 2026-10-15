/**
 * The column of icons over a person's head, bottom to top: the weapon-experience star, the life
 * heart, the trade-experience star, the need bubble and the scripted import marker. Each worn icon
 * lifts the ones above it by its step; an icon not worn takes no room.
 *
 * Original behavior (reading, unconfirmed against the running original): this order, a 16 px step
 * for each star, bubble and marker and 20 px for the heart, with the group number over the marker.
 * Approximation: the original starts the column 56 px over the feet, this build a gap over the drawn
 * sprite's top, so the heart and the bubble keep their own small gaps there.
 */

export type OverheadSlot = 'weaponStar' | 'heart' | 'jobStar' | 'bubble' | 'marker';

const SLOTS_BOTTOM_UP: readonly OverheadSlot[] = ['weaponStar', 'heart', 'jobStar', 'bubble', 'marker'];

/** World px the hot spot of a bob at the column's base stands over the head, so the largest star's
 *  lower points (6 px under its hot spot) clear it. Approximation. */
export const OVERHEAD_BASE_GAP = 8;

/** World px each worn icon lifts the icons above it. */
export const OVERHEAD_STEP: Readonly<Record<OverheadSlot, number>> = {
  weaponStar: 16,
  heart: 20,
  jobStar: 16,
  bubble: 16,
  marker: 16,
};

const SLOT_BIT: Readonly<Record<OverheadSlot, number>> = {
  weaponStar: 1 << 0,
  heart: 1 << 1,
  jobStar: 1 << 2,
  bubble: 1 << 3,
  marker: 1 << 4,
};

/** The icons each on-screen person wears this frame. Refilled per frame from the mark lists, so it
 *  holds no more entries than those lists. */
export class OverheadColumn {
  private readonly worn = new Map<number, number>();

  clear(): void {
    this.worn.clear();
  }

  wear(id: number, slot: OverheadSlot): void {
    this.worn.set(id, (this.worn.get(id) ?? 0) | SLOT_BIT[slot]);
  }

  /** World px `slot` stands above the column's base: the steps of the icons `id` wears below it. */
  riseOf(id: number, slot: OverheadSlot): number {
    const mask = this.worn.get(id) ?? 0;
    let rise = 0;
    for (const below of SLOTS_BOTTOM_UP) {
      if (below === slot) return rise;
      if ((mask & SLOT_BIT[below]) !== 0) rise += OVERHEAD_STEP[below];
    }
    return rise;
  }
}
