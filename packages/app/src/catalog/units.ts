/**
 * Clean-room unit (settler) balance the readable data does not carry. The one home both content bases read
 * from — the sandbox tribe builder (`game/sandbox/content/catalog/tribes.ts`) and the real-content overlay
 * (`content/real-content.ts`) — so a settler has the same hitpoints on either base, in every scene and test.
 */

/**
 * A settler's hitpoint pool (`TribeType.hitpoints`), a provisional approximation on the real data scale:
 * the original's human HP is not in the readable data (source basis "Combat hit resolution"), and the
 * extracted scale sets the band — animal `hitpointsAdult` runs up to ~15000–20000 (the big beasts), the HQ
 * 100000, a real sword hits 1600. At 5000 a fighter takes ~3 sword swings, matching the original's
 * many-hits melee. Verify/pin: see the `verify-human-hitpoints` ticket.
 */
export const HUMAN_HITPOINTS = 5000;
