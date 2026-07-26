import { formatMessage, type Messages, professionLabel } from '../../i18n/index.js';
import type { DebugAction, DebugTargetKind } from './actions-catalog.js';
import {
  type AnimalEntry,
  type GoodEntry,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  type UnitPreset,
} from './spawn-catalog.js';

/** What the next map click will do. */
export type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'animal'; readonly entry: AnimalEntry }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction };

/** True when two arms name the same palette entry. */
export function sameArmed(a: Armed, b: Armed | null): boolean {
  if (b === null) return false;
  if (a.kind === 'unit' && b.kind === 'unit') return a.preset.id === b.preset.id;
  if (a.kind === 'animal' && b.kind === 'animal') return a.entry.tribe === b.entry.tribe;
  if (a.kind === 'resource' && b.kind === 'resource') return a.good === b.good;
  if (a.kind === 'good' && b.kind === 'good') return a.good === b.good;
  if (a.kind === 'action' && b.kind === 'action') return a.action.id === b.action.id;
  return false;
}

/** The admin palette's localized labels, bound once to the running content's good names + message tables. */
export interface AdminLabels {
  /** A good/resource entry's palette name (the live localized name, else the catalog id fallback). */
  readonly good: (entry: { readonly good: number; readonly id: string }) => string;
  readonly unit: (preset: UnitPreset) => string;
  /** A species entry's palette name — the content tribe slug (a debug tool label, not player copy). */
  readonly animal: (entry: AnimalEntry) => string;
  readonly action: (action: DebugAction) => string;
  readonly player: (player: number) => string;
  /** The status-footer line: what the current arm will do, or "nothing armed". */
  readonly status: (armed: Armed | null, player: number) => string;
}

/** Bind the admin palette's label resolution to the running content, once per mount. */
export function createAdminLabels(
  messages: Messages,
  goodLabel: ((typeId: number) => string | undefined) | undefined,
  goods: readonly GoodEntry[],
): AdminLabels {
  const copy = messages.admin;
  const goodNames = messages.goods;
  const targetNoun: Record<DebugTargetKind, string> = {
    settler: copy.targetSettler,
    building: copy.targetBuilding,
  };

  const goodLabelOf = (good: number, fallback: string): string => goodLabel?.(good) ?? fallback;
  const localizedGood = (entry: { readonly good: number; readonly id: string }): string =>
    goodLabelOf(entry.good, goodNames[entry.id as keyof Messages['goods']] ?? entry.id);
  const unitLabel = (preset: UnitPreset): string => {
    const direct = copy.units[preset.id as keyof Messages['admin']['units']];
    if (direct !== undefined) return direct;
    if (preset.id === 'collector') return professionLabel('collector');
    return preset.id;
  };
  const actionLabel = (action: DebugAction): string => copy.actionsCatalog[action.id];
  // The tribe slug with underscores opened up (`evil_hares` → `evil hares`) — readable enough for a
  // debug palette without a 34-species translation table.
  const animalLabel = (entry: AnimalEntry): string => entry.id.replace(/_/g, ' ');
  const playerName = (player: number): string => messages.animation.playerColors[player] ?? String(player);

  const status = (armed: Armed | null, player: number): string => {
    if (armed === null) return copy.nothingArmed;
    if (armed.kind === 'animal') {
      return formatMessage(copy.armedAnimal, { label: animalLabel(armed.entry) });
    }
    if (armed.kind === 'resource') {
      const good = armed.good;
      const entry = RESOURCE_ENTRIES.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.resourceFallback : localizedGood(entry);
      return formatMessage(copy.armedResource, { label });
    }
    if (armed.kind === 'good') {
      const good = armed.good;
      const entry = goods.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.goodFallback : localizedGood(entry);
      return formatMessage(copy.armedGood, { label });
    }
    if (armed.kind === 'action') {
      return formatMessage(copy.armedAction, {
        label: actionLabel(armed.action),
        target: targetNoun[armed.action.targetKind],
      });
    }
    const who = PLAYER_SWATCHES.find((s) => s.player === player);
    return formatMessage(copy.armedUnit, {
      label: unitLabel(armed.preset),
      player,
      name: who === undefined ? '?' : playerName(who.player),
    });
  };

  return {
    good: localizedGood,
    unit: unitLabel,
    animal: animalLabel,
    action: actionLabel,
    player: playerName,
    status,
  };
}
