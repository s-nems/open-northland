// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest';
import { initialLobbyOptions } from '../../../../src/entries/main-menu/lobby/model.js';
import { lobbyOptionsCard } from '../../../../src/entries/main-menu/lobby/options-card.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';

describe('lobbyOptionsCard', () => {
  it("takes the advanced window's weather, day and night and storage choices into the lobby options", () => {
    const options = initialLobbyOptions(new URLSearchParams(), false);
    const card = lobbyOptionsCard(options, false);
    document.body.append(card);
    // jsdom lacks the popover API the dropdown opens with.
    const proto = HTMLElement.prototype as Partial<Pick<HTMLElement, 'showPopover' | 'hidePopover'>>;
    proto.showPopover = () => {};
    proto.hidePopover = () => {};
    onTestFinished(() => {
      delete proto.showPopover;
      delete proto.hidePopover;
      card.remove();
    });
    const { weatherLabel, weatherModes, dayNightLabel, dayNightModes, advanced, storage } =
      messages().mainMenu.lobby;
    const entry = card.querySelector<HTMLButtonElement>('.main-menu__advanced-entry');
    expect(entry?.textContent).toContain(advanced.standard);
    entry?.click();
    const pick = (rule: string, choice: string): void => {
      document.querySelector<HTMLButtonElement>(`button[aria-label="${rule}"]`)?.click();
      const list = document.querySelector(`[role="listbox"][aria-label="${rule}"]`);
      const options = list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [];
      [...options].find((option) => option.textContent === choice)?.click();
    };
    pick(dayNightLabel, dayNightModes.on.label);
    pick(weatherLabel, weatherModes.off.label);
    const tripled = formatMessage(storage.factor, { factor: 3 });
    [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')]
      .find((button) => button.textContent === tripled)
      ?.click();
    expect(options.dayNight).toBe('on');
    expect(options.weather).toBe('off');
    expect(options.storageCapacity).toBe(3);
    expect(card.querySelector('.main-menu__advanced-summary')?.textContent).toContain(
      `${storage.label}: ${tripled}`,
    );

    // Restore defaults puts every advanced rule back in one go.
    [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')]
      .find((button) => button.textContent === advanced.reset)
      ?.click();
    expect([options.dayNight, options.weather, options.storageCapacity]).toEqual(['map', 'map', null]);
    expect(entry?.textContent).toContain(advanced.standard);
    document.querySelector<HTMLButtonElement>('.main-menu__advanced-done')?.click();
    expect(document.querySelector('.main-menu__advanced')).toBeNull();
  });

  it('offers the map setting only on a multiplayer map', () => {
    const { mapModes } = messages().mainMenu.lobby;
    const offered = (multiplayerMap: boolean): boolean =>
      [
        ...lobbyOptionsCard(
          initialLobbyOptions(new URLSearchParams(), false),
          multiplayerMap,
        ).querySelectorAll('button'),
      ].some((button) => button.textContent === mapModes.recon.label);
    expect(offered(true)).toBe(true);
    expect(offered(false)).toBe(false);
  });
});
