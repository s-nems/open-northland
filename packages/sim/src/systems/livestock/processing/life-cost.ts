/** HP one processing visit drains: a quarter of the sheep/cow 1000-HP pool, so an animal sustains two
 *  visits before the life floor makes it graze and regenerate. Named approximation. */
export const LIVESTOCK_PROCESS_DRAIN_HP = 250;

/** The life-floor divisor: a visit may never leave the animal below half its pool, so processing is
 *  non-lethal. Observed original behaviour; the exact floor is approximated. */
export const LIVESTOCK_MIN_LIFE_DIVISOR = 2;

/** A visit's life cost, read at the two moments it matters: the summon refuses an animal that cannot pay
 *  in full, and the release charges what the floor still allows once its HP has moved in between. */
type Life = Readonly<{ hitpoints: number; max: number }>;

function lifeFloor(max: number): number {
  return Math.floor(max / LIVESTOCK_MIN_LIFE_DIVISOR);
}

export function canPayVisitLife(life: Life): boolean {
  return life.hitpoints - LIVESTOCK_PROCESS_DRAIN_HP >= lifeFloor(life.max);
}

export function visitLifeCost(life: Life): number {
  return Math.min(LIVESTOCK_PROCESS_DRAIN_HP, Math.max(0, life.hitpoints - lifeFloor(life.max)));
}
