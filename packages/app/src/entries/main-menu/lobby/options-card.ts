import { FOG_MODE_BY_NAME, fogModeName } from '../../../game/fog.js';
import { messages } from '../../../i18n/index.js';
import { gameRuleControls } from '../lobby-controls/rules.js';
import { LOBBY_FOG_MODES, type LobbyOptions } from './model.js';

export function lobbyOptionsCard(options: LobbyOptions): HTMLElement {
  const lobby = messages().mainMenu.lobby;
  const card = document.createElement('div');
  card.className = 'main-menu__lobby-card';
  const title = document.createElement('div');
  title.className = 'main-menu__lobby-card-title';
  title.textContent = lobby.settingsTitle;
  const controls = gameRuleControls({
    presentation: 'compact',
    map: { label: lobby.mapLabel, modes: lobby.mapModes },
    fogOfWar: { label: lobby.fogOfWarLabel, ...lobby.fogOfWarModes },
    progression: { label: lobby.progressionLabel, ...lobby.progressionModes },
    needs: { label: lobby.needsLabel, ...lobby.needsModes },
    onChange(change) {
      if (change.fog != null) {
        const name = fogModeName(change.fog);
        options.fog = LOBBY_FOG_MODES.find((mode) => mode === name) ?? options.fog;
      }
      if (change.progression != null) options.professionProgression = change.progression;
      if (change.needs != null) options.settlerNeeds = change.needs;
      paint();
    },
  });
  function paint(): void {
    controls.update(
      {
        fog: FOG_MODE_BY_NAME[options.fog],
        progression: options.professionProgression,
        needs: options.settlerNeeds,
      },
      false,
    );
  }
  paint();
  card.append(title, ...controls.elements);
  return card;
}
