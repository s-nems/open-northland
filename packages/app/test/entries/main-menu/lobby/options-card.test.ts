// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest';
import { initialLobbyOptions, type LobbyOptions } from '../../../../src/entries/main-menu/lobby/model.js';
import { lobbyOptionsCard } from '../../../../src/entries/main-menu/lobby/options-card.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';

describe('lobbyOptionsCard', () => {
  it("takes the advanced window's weather, day and night, storage and paper choices into the lobby options", () => {
    const options = initialLobbyOptions(new URLSearchParams(), false);
    const card = lobbyOptionsCard(options, false).element;
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
    const { weatherLabel, weatherModes, dayNightLabel, dayNightModes, advanced, storage, papers } =
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
    document.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${papers.label}"]`)?.click();
    expect(options.dayNight).toBe('on');
    expect(options.weather).toBe('off');
    expect(options.storageCapacity).toBe(3);
    expect(options.papers).toBe(false);
    const summary = card.querySelector('.main-menu__advanced-summary')?.textContent;
    expect(summary).toContain(`${storage.label}: ${tripled}`);
    expect(summary).toContain(`${papers.label}: ${papers.off}`);

    // Restore defaults puts every advanced rule back in one go.
    [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')]
      .find((button) => button.textContent === advanced.reset)
      ?.click();
    expect([options.dayNight, options.weather, options.storageCapacity, options.papers]).toEqual([
      'map',
      'map',
      null,
      true,
    ]);
    expect(entry?.textContent).toContain(advanced.standard);
    document.querySelector<HTMLButtonElement>('.main-menu__advanced-done')?.click();
    expect(document.querySelector('.main-menu__advanced')).toBeNull();
  });

  it('takes both resource richness choices and restores the standard the caller names', () => {
    const held: LobbyOptions = { ...initialLobbyOptions(new URLSearchParams(), false), oreYield: 2 };
    const card = lobbyOptionsCard(held, false, { standardOreYield: () => 2 }).element;
    document.body.append(card);
    onTestFinished(() => card.remove());
    const { advanced, basicYield, oreYield } = messages().mainMenu.lobby;
    const entry = card.querySelector<HTMLButtonElement>('.main-menu__advanced-entry');
    // The caller's standard is no change from it.
    expect(entry?.textContent).toContain(advanced.standard);
    entry?.click();
    const segment = (rule: string, factor: number): HTMLButtonElement | undefined => {
      const strip = [...document.querySelectorAll('.main-menu__advanced [role="group"]')].find(
        (group) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent === rule,
      );
      return [...(strip?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === formatMessage(basicYield.factor, { factor }),
      );
    };
    segment(basicYield.label, 5)?.click();
    segment(oreYield.label, 1)?.click();
    expect([held.basicYield, held.oreYield]).toEqual([5, null]);
    expect(card.querySelector('.main-menu__advanced-summary')?.textContent).toContain(
      `${oreYield.label}: ×1`,
    );

    [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')]
      .find((button) => button.textContent === advanced.reset)
      ?.click();
    expect([held.basicYield, held.oreYield]).toEqual([null, 2]);
    document.querySelector<HTMLButtonElement>('.main-menu__advanced-done')?.click();
  });

  it("lists the map's mode rows first on the card and counts a mode's ore richness as standard", () => {
    const held: LobbyOptions = { ...initialLobbyOptions(new URLSearchParams(), false), oreYield: 3 };
    const mode = document.createElement('div');
    const card = lobbyOptionsCard(held, false, { modes: [mode], standardOreYield: () => 3 }).element;
    document.body.append(card);
    onTestFinished(() => card.remove());
    const { advanced } = messages().mainMenu.lobby;
    expect(card.children[1]).toBe(mode);
    expect(card.querySelector('.main-menu__advanced-entry')?.textContent).not.toContain(advanced.changed);
    card.querySelector<HTMLButtonElement>('.main-menu__advanced-entry')?.click();
    const reset = [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')].find(
      (button) => button.textContent === advanced.reset,
    );
    expect(reset?.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('.main-menu__advanced-done')?.click();
  });

  it('shows only the entry when asked, its window holding fog of war and its reset clearing it', () => {
    const held: LobbyOptions = initialLobbyOptions(new URLSearchParams(), false);
    const card = lobbyOptionsCard(held, false, { entryOnly: true }).element;
    document.body.append(card);
    onTestFinished(() => card.remove());
    const { advanced, fogOfWarLabel, settingsTitle } = messages().mainMenu.lobby;
    expect(card.querySelector('[role="switch"]')).toBeNull();
    const entry = card.querySelector<HTMLButtonElement>('.main-menu__advanced-entry');
    expect(entry?.textContent).toContain(settingsTitle);
    entry?.click();
    document
      .querySelector<HTMLButtonElement>(`.main-menu__advanced [aria-label="${fogOfWarLabel}"]`)
      ?.click();
    expect(held.fog).toBe('classic-fow');
    expect(card.querySelector('.main-menu__advanced-summary')?.textContent).toBe(fogOfWarLabel);

    [...document.querySelectorAll<HTMLButtonElement>('.main-menu__advanced button')]
      .find((button) => button.textContent === advanced.reset)
      ?.click();
    expect(held.fog).toBe('classic');
    document.querySelector<HTMLButtonElement>('.main-menu__advanced-done')?.click();
  });

  it('offers the map setting only on a multiplayer map', () => {
    const { mapModes } = messages().mainMenu.lobby;
    const offered = (multiplayerMap: boolean): boolean =>
      [
        ...lobbyOptionsCard(
          initialLobbyOptions(new URLSearchParams(), false),
          multiplayerMap,
        ).element.querySelectorAll('button'),
      ].some((button) => button.textContent === mapModes.recon.label);
    expect(offered(true)).toBe(true);
    expect(offered(false)).toBe(false);
  });
});
