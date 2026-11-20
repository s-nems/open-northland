import type { ResourceYieldFactor } from '@open-northland/lockstep';
import { fogModeName, LOBBY_FOG_MODES } from '../../../game/fog.js';
import { messages } from '../../../i18n/index.js';
import { gameRuleControls } from '../lobby-controls/rules.js';
import { type LobbyOptions, lobbyRules } from './model.js';

export interface LobbyOptionsCardExtras {
  /** The toggles of the variants the map ships, first in the advanced window's game rules. */
  readonly variants?: readonly HTMLElement[];
  /** What the variant toggles hold, named first in the advanced entry's summary. */
  readonly variantChanges?: () => readonly string[];
  /** The ore richness the advanced window's reset restores; absent restores the authored stock. */
  readonly standardOreYield?: () => ResourceYieldFactor | null;
  /** Runs after each change the card writes into the options. */
  readonly onChange?: () => void;
  /** Shows only an entry named after the settings, whose window holds every rule, for a screen with no
   *  room for the card. */
  readonly entryOnly?: boolean;
}

/**
 * A multiplayer map offers the map setting and the peace choice; a single-player one plays the
 * classic map. `paint` shows options changed from outside the card.
 */
export function lobbyOptionsCard(
  options: LobbyOptions,
  multiplayerMap: boolean,
  extras: LobbyOptionsCardExtras = {},
): { readonly element: HTMLElement; readonly paint: () => void; readonly dispose: () => void } {
  const lobby = messages().mainMenu.lobby;
  const entryOnly = extras.entryOnly === true;
  const card = document.createElement('div');
  card.className = entryOnly ? 'main-menu__rules-entry' : 'main-menu__lobby-card';
  const title = document.createElement('div');
  title.className = 'main-menu__lobby-card-title';
  title.textContent = lobby.settingsTitle;
  const controls = gameRuleControls({
    ...(multiplayerMap ? { map: { label: lobby.mapLabel, modes: lobby.mapModes } } : {}),
    // The window writes each rule's detail under its name; the card has no room for it.
    fogOfWar: {
      label: lobby.fogOfWarLabel,
      ...lobby.fogOfWarModes,
      ...(entryOnly ? { detail: lobby.fogOfWarModes.on } : {}),
    },
    progression: {
      label: lobby.progressionLabel,
      detail: lobby.progressionDetail,
      ...lobby.progressionModes,
    },
    needs: { label: lobby.needsLabel, detail: lobby.needsDetail, ...lobby.needsModes },
    alliedVision: {
      label: lobby.alliedVisionLabel,
      ...lobby.alliedVisionModes,
      ...(entryOnly ? { detail: lobby.alliedVisionDetail } : {}),
    },
    weather: { label: lobby.weatherLabel, modes: lobby.weatherModes },
    dayNight: { label: lobby.dayNightLabel, modes: lobby.dayNightModes },
    storage: lobby.storage,
    basicYield: lobby.basicYield,
    oreYield: lobby.oreYield,
    ...(extras.standardOreYield === undefined ? {} : { standardOreYield: extras.standardOreYield }),
    ...(extras.variants === undefined ? {} : { mapRows: extras.variants }),
    ...(extras.variantChanges === undefined ? {} : { mapChanges: extras.variantChanges }),
    ...(multiplayerMap ? { peace: lobby.peace } : {}),
    advanced: entryOnly
      ? { ...lobby.advanced, label: lobby.settingsTitle, title: lobby.settingsTitle }
      : lobby.advanced,
    everyRuleInWindow: entryOnly,
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
      if (change.storageCapacity !== undefined) options.storageCapacity = change.storageCapacity;
      if (change.basicYield !== undefined) options.basicYield = change.basicYield;
      if (change.oreYield !== undefined) options.oreYield = change.oreYield;
      paint();
      extras.onChange?.();
    },
  });
  function paint(): void {
    controls.update(lobbyRules(options), false);
  }
  paint();
  if (!entryOnly) card.append(title, ...controls.basicElements);
  card.append(...controls.advancedElements);
  return { element: card, paint, dispose: controls.dispose };
}
