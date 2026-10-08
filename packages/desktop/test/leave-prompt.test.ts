import { describe, expect, it } from 'vitest';
import { leavePromptFor } from '../src/leave-prompt.js';

const PAGE = 'app://game/index.html';

describe('leavePromptFor', () => {
  it('speaks the language the page carries, by code or by tag', () => {
    expect(leavePromptFor(`${PAGE}?lang=pol&map=fjord`, 'en-US').message).toMatch(/^Zamknąć/);
    expect(leavePromptFor(`${PAGE}?lang=de`, 'en-US').leave).toBe('Schließen');
    expect(leavePromptFor(`${PAGE}?lang=RUS`, 'en-US').stay).toBe('Вернуться в игру');
  });

  it('falls back to the system language, then to English', () => {
    expect(leavePromptFor(PAGE, 'pl-PL').leave).toBe('Zamknij');
    expect(leavePromptFor(PAGE, 'fr-FR').leave).toBe('Close');
    expect(leavePromptFor(`${PAGE}?lang=xx`, 'de').leave).toBe('Schließen');
  });

  it('answers in English for a page without an address yet', () => {
    expect(leavePromptFor('', 'fr').leave).toBe('Close');
  });

  it('offers a stay and a leave answer in every language', () => {
    for (const lang of ['pol', 'eng', 'ger', 'rus']) {
      const prompt = leavePromptFor(`${PAGE}?lang=${lang}`, 'en');
      expect(prompt.leave).not.toBe(prompt.stay);
      expect(prompt.message.length).toBeGreaterThan(10);
    }
  });
});
