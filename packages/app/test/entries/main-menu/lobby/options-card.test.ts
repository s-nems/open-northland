// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest';
import { initialLobbyOptions } from '../../../../src/entries/main-menu/lobby/model.js';
import { lobbyOptionsCard } from '../../../../src/entries/main-menu/lobby/options-card.js';
import { messages } from '../../../../src/i18n/index.js';

describe('lobbyOptionsCard', () => {
  it('takes the weather and the day and night choice into the lobby options', () => {
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
    const { weatherLabel, weatherModes, dayNightLabel, dayNightModes } = messages().mainMenu.lobby;
    const pick = (rule: string, choice: string): void => {
      card.querySelector<HTMLButtonElement>(`button[aria-label="${rule}"]`)?.click();
      const list = document.querySelector(`[role="listbox"][aria-label="${rule}"]`);
      const options = list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [];
      [...options].find((option) => option.textContent === choice)?.click();
    };
    pick(dayNightLabel, dayNightModes.on.label);
    pick(weatherLabel, weatherModes.off.label);
    expect(options.dayNight).toBe('on');
    expect(options.weather).toBe('off');
  });
});
