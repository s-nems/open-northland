// The Electron host for the cross-engine determinism check: one hidden window on the app's dev server,
// so the desktop shell's runtime runs the same page the browsers do. The shipped shell
// (packages/desktop) adds an installer and its own protocol, neither of which the sim's hashes touch.
const { app, BrowserWindow } = require('electron');

const flag = '--url=';
const url = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);

app.whenReady().then(() => {
  if (url === undefined) throw new Error(`no ${flag}<origin> argument`);
  const window = new BrowserWindow({ show: false, width: 1000, height: 600 });
  return window.loadURL(url);
});
