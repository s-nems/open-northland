import type { RoomView } from '@open-northland/net-protocol';
import { messages } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { gameRuleControls } from '../../lobby-controls/rules.js';
import { roomSettingsQueue } from './settings-queue.js';
import type { NetworkRoomDeps } from './types.js';

export function roomSettings(deps: NetworkRoomDeps) {
  const { copy, client } = deps;
  const lobby = messages().mainMenu.lobby;
  const queue = roomSettingsQueue((settings) => client.setSettings(settings));
  const root = node('section', 'network-room__card network-room__settings-panel');
  const fields = node('div', 'network-room__settings');
  const hint = node('p', 'network-room__muted', copy.creatorSettings);
  root.append(node('h3', '', copy.settings), hint, fields);
  const rules = gameRuleControls({
    presentation: 'compact',
    inheritedLabel: copy.authored,
    fieldClassName: 'network-room__field',
    map: { label: lobby.mapLabel, modes: lobby.mapModes, revealed: messages().admin.fogModes.off },
    fogOfWar: { label: lobby.fogOfWarLabel, on: copy.enabled, off: copy.disabled },
    progression: {
      label: copy.progression,
      detail: copy.progressionDetail,
      on: lobby.progressionModes.on,
      off: lobby.progressionModes.off,
    },
    needs: {
      label: copy.needs,
      detail: copy.needsDetail,
      on: lobby.needsModes.on,
      off: lobby.needsModes.off,
    },
    alliedVision: {
      label: lobby.alliedVisionLabel,
      detail: lobby.alliedVisionDetail,
      on: copy.enabled,
      off: copy.disabled,
    },
    weather: { label: lobby.weatherLabel, modes: lobby.weatherModes },
    onChange(change) {
      queue.change({ rules: change });
    },
  });
  fields.append(...rules.environmentElements, ...rules.gameplayElements);
  root.append(node('p', 'network-room__muted', copy.departure));
  return {
    root,
    rejected(): void {
      queue.rejected();
      rules.rejected();
    },
    dispose: queue.dispose,
    update(next: RoomView, editable: boolean): void {
      queue.update(next, editable);
      if (editable && next.settings.kickedSeatMode !== 'idle') queue.change({ kickedSeatMode: 'idle' });
      hint.textContent = next.settings.initialSave === undefined ? copy.creatorSettings : copy.savedSettings;
      hint.hidden = editable && next.settings.initialSave === undefined;
      const frozen = !editable || next.settings.initialSave !== undefined;
      rules.update(next.settings.rules, frozen);
    },
  };
}
