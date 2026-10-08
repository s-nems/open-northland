import { SelectionSprite } from '../sprite-selection-effect.js';
import type { PooledEntity } from './pooled-entity.js';

export function coatBody(pe: PooledEntity, packed: number): void {
  for (let i = 0; i < pe.sprites.length; i++) {
    const sprite = pe.sprites[i];
    if (sprite === undefined) continue;
    const excluded = (!pe.paletted && pe.pickExempt[i]) || ('glow' in sprite && sprite.glow === true);
    if (sprite instanceof SelectionSprite) sprite.bloodEffect = excluded ? 0 : packed;
  }
}
