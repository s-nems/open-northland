import type { RoomView } from '@open-northland/net-protocol';
import { messages } from '../../../../i18n/index.js';
import { gameRuleControls } from '../../lobby-controls/rules.js';
import { node, selectControl } from './controls.js';
import { roomSettingsQueue } from './settings-queue.js';
import type { NetworkRoomDeps } from './types.js';

/** Starting speeds a room offers; the wire allows up to `MAX_SPEED`, but faster than 3x is a debug
 *  pace no lobby needs. */
const STARTING_SPEEDS = ['0.5', '1', '2', '3'] as const;

export function roomSettings(deps: NetworkRoomDeps) {
  const { copy, client } = deps;
  const lobby = messages().mainMenu.lobby;
  const queue = roomSettingsQueue((settings) => client.setSettings(settings));
  const root = node('section', '', 'network-room__card network-room__settings');
  const hint = node('p', copy.creatorSettings, 'network-room__muted');
  root.append(node('h3', copy.settings), hint);
  const rules = gameRuleControls({
    presentation: 'select',
    inheritedLabel: copy.authored,
    fieldClassName: 'network-room__field',
    fog: { label: lobby.fogLabel, modes: lobby.fogModes },
    progression: { label: copy.progression, on: copy.enabled, off: copy.disabled },
    needs: { label: copy.needs, on: copy.enabled, off: copy.disabled },
    onChange(change) {
      queue.change({ rules: change });
    },
  });
  const speed = selectControl(
    copy.speed,
    STARTING_SPEEDS.map((value) => [value, `${value}×`] as const),
    (value) => queue.change({ speed: Number(value) }),
  );
  const fallout = selectControl(
    copy.fallout,
    [
      ['', copy.authored],
      ['ai', copy.ai],
      ['idle', copy.idle],
    ],
    (value) => queue.change({ kickedSeatMode: value === '' ? null : value === 'ai' ? 'ai' : 'idle' }),
  );
  root.append(...rules.elements, speed.root, fallout.root);
  return {
    root,
    rejected: queue.rejected,
    dispose: queue.dispose,
    update(next: RoomView, editable: boolean): void {
      queue.update(next, editable);
      hint.textContent = next.settings.initialSave === undefined ? copy.creatorSettings : copy.savedSettings;
      const frozen = !editable || next.settings.initialSave !== undefined;
      rules.update(next.settings.rules, frozen);
      speed.update(String(next.settings.speed), !editable);
      fallout.update(next.settings.kickedSeatMode ?? '', !editable);
    },
  };
}
