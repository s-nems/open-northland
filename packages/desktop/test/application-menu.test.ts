import { describe, expect, it } from 'vitest';
import { applicationMenuTemplate } from '../src/application-menu.js';

const roles = (platform: NodeJS.Platform, packaged: boolean): readonly string[] =>
  (applicationMenuTemplate(platform, packaged) ?? []).map((item) => item.role ?? item.label ?? '');

describe('applicationMenuTemplate', () => {
  it('drops the View menu whose reload and zoom keys would end or rescale a game', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const template = applicationMenuTemplate(platform, true) ?? [];
      expect(template.map((item) => item.role)).not.toContain('viewMenu');
      expect(JSON.stringify(template)).not.toMatch(/reload|zoom/i);
    }
  });

  it('keeps the macOS application and edit roles for Cmd+Q and the text fields', () => {
    expect(roles('darwin', true)).toEqual(['appMenu', 'editMenu', 'windowMenu']);
  });

  it('shows no bar on Windows and Linux, so Alt opens nothing', () => {
    expect(applicationMenuTemplate('win32', true)).toBeNull();
    expect(applicationMenuTemplate('linux', true)).toBeNull();
  });

  it('keeps the developer tools in a development build', () => {
    expect(roles('darwin', false)).toEqual(['appMenu', 'editMenu', 'View', 'windowMenu']);
    expect(roles('win32', false)).toEqual(['View']);
    expect(JSON.stringify(applicationMenuTemplate('win32', false))).toContain('toggleDevTools');
  });
});
