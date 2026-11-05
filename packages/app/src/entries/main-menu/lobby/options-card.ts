import { FOG_MODE_BY_NAME, fogModeName, LOBBY_FOG_MODES } from '../../../game/fog.js';
import { messages } from '../../../i18n/index.js';
import { gameRuleControls } from '../lobby-controls/rules.js';
import type { LobbyOptions } from './model.js';

/**
 * `offersPeace` shows the peace choice, which only a multiplayer map has. `variants` are the
 * toggles of the variants the map ships, listed last.
 */
export function lobbyOptionsCard(
  options: LobbyOptions,
  offersPeace: boolean,
  variants: readonly HTMLElement[] = [],
): HTMLElement {
  const lobby = messages().mainMenu.lobby;
  const card = document.createElement('div');
  card.className = 'main-menu__lobby-card';
  const title = document.createElement('div');
  title.className = 'main-menu__lobby-card-title';
  title.textContent = lobby.settingsTitle;
  const controls = gameRuleControls({
    map: { label: lobby.mapLabel, modes: lobby.mapModes },
    fogOfWar: { label: lobby.fogOfWarLabel, ...lobby.fogOfWarModes },
    progression: { label: lobby.progressionLabel, ...lobby.progressionModes },
    needs: { label: lobby.needsLabel, ...lobby.needsModes },
    alliedVision: { label: lobby.alliedVisionLabel, ...lobby.alliedVisionModes },
    weather: { label: lobby.weatherLabel, modes: lobby.weatherModes },
    dayNight: { label: lobby.dayNightLabel, modes: lobby.dayNightModes },
    ...(offersPeace ? { peace: lobby.peace } : {}),
    onChange(change) {
      if (change.fog != null) {
        const name = fogModeName(change.fog);
        options.fog = LOBBY_FOG_MODES.find((mode) => mode === name) ?? options.fog;
      }
      if (change.progression != null) options.professionProgression = change.progression;
      if (change.needs != null) options.settlerNeeds = change.needs;
      if (change.alliedVision != null) options.alliedVision = change.alliedVision;
      if (change.weather != null) options.weather = change.weather;
      if (change.dayNight != null) options.dayNight = change.dayNight;
      if (change.peace !== undefined) options.peace = change.peace;
      paint();
    },
  });
  function paint(): void {
    controls.update(
      {
        fog: FOG_MODE_BY_NAME[options.fog],
        progression: options.professionProgression,
        needs: options.settlerNeeds,
        weather: options.weather,
        dayNight: options.dayNight,
        alliedVision: options.alliedVision,
        peace: options.peace,
      },
      false,
    );
  }
  paint();
  card.append(title, ...controls.elements, ...variants);
  return card;
}
