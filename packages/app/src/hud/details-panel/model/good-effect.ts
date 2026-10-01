import type { EquipClass } from '@open-northland/data';
import { currentLocale, formatMessage, type Locale, messages } from '../../../i18n/index.js';

const WHOLE_PCT = 100;

/** Content goods are stable for a session, so a line is built once per good and locale. */
const shown = new WeakMap<EquipClass, { readonly locale: Locale; readonly text: string }>();

/** What a carried draught or amulet does, in one short line ("Heals 40% health · 2 sips"); empty
 *  for any other good. The full numbers belong to a knowledge page, not a tooltip. */
export function goodEffectText(equip: EquipClass | undefined): string {
  if (equip?.category !== 'misc') return '';
  const locale = currentLocale();
  const kept = shown.get(equip);
  if (kept?.locale === locale) return kept.text;
  const text = effectLine(equip);
  shown.set(equip, { locale, text });
  return text;
}

function effectLine(equip: EquipClass): string {
  const copy = messages().hud.goodEffect;
  const parts: string[] = [];
  const restore = equip.restorePct;
  if (restore?.healthMax !== undefined) parts.push(formatMessage(copy.heal, { pct: restore.healthMax }));
  if (restore?.hunger !== undefined) parts.push(formatMessage(copy.hunger, { pct: restore.hunger }));
  if (restore?.fatigue !== undefined) parts.push(formatMessage(copy.fatigue, { pct: restore.fatigue }));
  if (equip.damageDealtPct !== undefined) {
    parts.push(formatMessage(copy.damageDealt, { pct: equip.damageDealtPct - WHOLE_PCT }));
  }
  if (equip.criticalHit !== undefined) {
    parts.push(
      formatMessage(copy.criticalHit, {
        chance: equip.criticalHit.chancePct,
        times: equip.criticalHit.damagePct / WHOLE_PCT,
      }),
    );
  }
  if (equip.damageTakenPct !== undefined) {
    parts.push(formatMessage(copy.damageTaken, { pct: WHOLE_PCT - equip.damageTakenPct }));
  }
  if (equip.walkStepTicksSaved !== undefined) parts.push(copy.walk);
  if (parts.length === 0) return '';
  if (equip.wears && equip.uses !== undefined) parts.push(formatMessage(copy.uses, { count: equip.uses }));
  else if (!equip.wears) parts.push(copy.lasting);
  return parts.join(' · ');
}
