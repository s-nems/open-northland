import type { CursorState } from '../cursors/model.js';
import type { PickMode } from './pick-mode.js';

const PICK_CURSORS: Readonly<Record<PickMode['kind'], CursorState>> = {
  workplace: 'work',
  'workplace-or-flag': 'work',
  'work-area': 'work',
  home: 'crosshair',
  'building-site': 'build',
  'learning-place': 'crosshair',
  'trade-house': 'crosshair',
  destination: 'move',
  signpost: 'build',
  'attack-move': 'attack-move',
  'attack-settler': 'attack',
  'attack-building': 'attack',
  'attack-animal': 'attack',
  'attack-vehicle': 'attack',
  vehicle: 'crosshair',
  'vehicle-destination': 'move',
  'vehicle-dock': 'crosshair',
  'vehicle-attack-position': 'attack-move',
  'vehicle-attack-settler': 'attack',
  'vehicle-attack-building': 'attack',
  'vehicle-attack-vehicle': 'attack',
  'vehicle-carrier': 'crosshair',
  'vehicle-rider': 'crosshair',
  'vehicle-deck': 'crosshair',
};

export function pickCursor(mode: PickMode | null): CursorState | null {
  return mode === null ? null : PICK_CURSORS[mode.kind];
}
