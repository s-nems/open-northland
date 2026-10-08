import type { MenuItemConstructorOptions } from 'electron';

/**
 * The shell's menu. Electron's default menu carries a View menu whose Reload, Force Reload and zoom
 * accelerators would end or rescale a running game from the keyboard, so the shell sets its own.
 * macOS keeps the application and edit roles its text fields and Cmd+Q need; the other platforms show
 * no bar at all, so Alt no longer opens one. A development build keeps the developer tools.
 */
export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  packaged: boolean,
): readonly MenuItemConstructorOptions[] | null {
  const development: readonly MenuItemConstructorOptions[] = packaged
    ? []
    : [{ label: 'View', submenu: [{ role: 'toggleDevTools' }] }];
  if (platform === 'darwin') {
    return [{ role: 'appMenu' }, { role: 'editMenu' }, ...development, { role: 'windowMenu' }];
  }
  return development.length === 0 ? null : development;
}
