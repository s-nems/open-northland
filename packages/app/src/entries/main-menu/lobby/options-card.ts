import { messages } from '../../../i18n/index.js';
import { segControl, togglePill } from '../../../view/settings-controls.js';
import { LOBBY_FOG_MODES, type LobbyOptions } from './model.js';

/** A labelled on/off row; the pill carries the label as its accessible name, its state as the title. */
function toggleRow(
  label: string,
  initial: boolean,
  apply: (on: boolean) => void,
  modes: { readonly on: string; readonly off: string },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'main-menu__lobby-option-row';
  const text = document.createElement('span');
  text.textContent = label;
  const pill = togglePill(initial, apply, (on) => modes[on ? 'on' : 'off']);
  pill.setAttribute('aria-label', label);
  row.append(text, pill);
  return row;
}

/** The match-settings card. `options` is the live object Start reads, mutated in place by each control. */
export function lobbyOptionsCard(options: LobbyOptions): HTMLElement {
  const lobby = messages().mainMenu.lobby;

  const card = document.createElement('div');
  card.className = 'main-menu__lobby-card';
  const title = document.createElement('div');
  title.className = 'main-menu__lobby-card-title';
  title.textContent = lobby.settingsTitle;

  const fogLabel = document.createElement('div');
  fogLabel.className = 'main-menu__lobby-option-label';
  fogLabel.textContent = lobby.fogLabel;
  const fogSeg = segControl(
    LOBBY_FOG_MODES.map((mode) => ({
      id: mode,
      label: lobby.fogModes[mode].label,
      title: lobby.fogModes[mode].detail,
    })),
    options.fog,
    (mode) => {
      options.fog = mode;
      fogSeg.setActive(mode);
    },
  );
  fogSeg.root.classList.add('main-menu__lobby-fog');

  card.append(
    title,
    fogLabel,
    fogSeg.root,
    toggleRow(
      lobby.progressionLabel,
      options.professionProgression,
      (on) => {
        options.professionProgression = on;
      },
      lobby.progressionModes,
    ),
    toggleRow(
      lobby.needsLabel,
      options.settlerNeeds,
      (on) => {
        options.settlerNeeds = on;
      },
      lobby.needsModes,
    ),
  );
  return card;
}
