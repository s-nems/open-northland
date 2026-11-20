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
    inheritedLabel: copy.authored,
    fieldClassName: 'network-room__field',
    map: { label: lobby.mapLabel, modes: lobby.mapModes, revealed: messages().admin.fogModes.off },
    fogOfWar: { label: lobby.fogOfWarLabel, on: copy.enabled, off: copy.disabled },
    progression: {
      label: lobby.progressionLabel,
      detail: lobby.progressionDetail,
      ...lobby.progressionModes,
    },
    needs: { label: lobby.needsLabel, detail: lobby.needsDetail, ...lobby.needsModes },
    alliedVision: {
      label: lobby.alliedVisionLabel,
      detail: lobby.alliedVisionDetail,
      on: copy.enabled,
      off: copy.disabled,
    },
    weather: { label: lobby.weatherLabel, modes: lobby.weatherModes },
    dayNight: { label: lobby.dayNightLabel, modes: lobby.dayNightModes },
    storage: lobby.storage,
    // A room plays a map with a multiplayer lobby, so it always offers the peace.
    peace: lobby.peace,
    advanced: lobby.advanced,
    onChange(change) {
      queue.change({ rules: change });
    },
  });
  fields.append(...rules.basicElements, ...rules.advancedElements);
  root.append(node('p', 'network-room__muted', copy.departure));
  return {
    root,
    rejected(): void {
      queue.rejected();
      rules.rejected();
    },
    dispose(): void {
      queue.dispose();
      rules.dispose();
    },
    update(next: RoomView, editable: boolean): void {
      queue.update(next, editable);
      if (editable && next.settings.kickedSeatMode !== 'idle') queue.change({ kickedSeatMode: 'idle' });
      const saved = next.settings.initialSave !== undefined;
      hint.textContent = saved ? copy.savedSettings : copy.creatorSettings;
      hint.hidden = editable && !saved;
      const frozen = !editable || saved;
      // A guest reads the rules as text rather than as dimmed controls.
      fields.classList.toggle('is-readonly', frozen);
      rules.update(next.settings.rules, frozen, saved ? copy.savedSettings : lobby.advanced.hostOnly);
    },
  };
}
