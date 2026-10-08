import type { SimEvent } from '@open-northland/sim';
import { smoothUnit } from './blood.js';

/** Authored appearance: clothing dries, then clears over 150 game seconds without changing health. */
export const BLOOD_COAT_LIFETIME = 1800;
export const MAX_BLOOD_COATS = 8192;
interface Coat {
  readonly amount: number;
  readonly tick: number;
}

/** Oldest-touch order lets expiry visit only expired entries, including fighters outside the view. */
export class BloodCoats {
  private readonly coats = new Map<number, Coat>();
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.coats.clear();
  }

  ingest(events: readonly SimEvent[], tick: number): void {
    if (!this.enabled) return;
    for (const [ref, coat] of this.coats) {
      if (tick - coat.tick < BLOOD_COAT_LIFETIME) break;
      this.coats.delete(ref);
    }
    for (const event of events) {
      if (event.kind !== 'combatHit' && event.kind !== 'projectileHit') continue;
      if (event.structure === true) continue;
      this.add(event.target, tick, event.kind === 'projectileHit' ? 0.4 : 0.55);
      if (event.kind === 'combatHit') this.add(event.attacker, tick, event.weaponMainType === 1 ? 0.13 : 0.3);
    }
    while (this.coats.size > MAX_BLOOD_COATS) {
      const oldest = this.coats.keys().next();
      if (oldest.done) break;
      this.coats.delete(oldest.value);
    }
  }

  private add(ref: number, tick: number, amount: number): void {
    const old = this.coats.get(ref);
    const retained = old === undefined ? 0 : old.amount * coatFade(tick - old.tick);
    this.coats.delete(ref);
    this.coats.set(ref, { amount: Math.min(1, retained + amount), tick });
  }

  /** Three bytes packed exactly into a float32: coverage, dryness, stable individual pattern. */
  packed(ref: number, tick: number): number {
    const coat = this.coats.get(ref);
    if (coat === undefined) return 0;
    const age = Math.max(0, tick - coat.tick);
    const amount = Math.round(coat.amount * coatFade(age) * 255);
    if (amount === 0) return 0;
    const dry = Math.round(smoothUnit(age / 480) * 255);
    const seed = (Math.imul(ref, 2654435761) >>> 16) & 255;
    return amount + dry * 256 + seed * 65536;
  }
}

function coatFade(age: number): number {
  return 1 - smoothUnit((age - 1200) / (BLOOD_COAT_LIFETIME - 1200));
}
