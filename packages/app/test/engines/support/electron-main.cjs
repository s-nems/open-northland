// The Electron host for the cross-engine determinism check: one hidden window on the app's dev server,
// so the desktop shell's runtime runs the same page the browsers do. The shipped shell
// (packages/desktop) adds its own protocol, which the sim's hashes never touch.
const { app, BrowserWindow } = require('electron');

const flag = '--profile=';
const profile = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
if (profile === undefined) throw new Error(`no ${flag}<directory> argument`);
app.setPath('userData', profile);

app.whenReady().then(() => {
  // The harness attaches error listeners before navigating this initially blank window.
  const window = new BrowserWindow({ show: false, width: 1000, height: 600 });
  return window.loadURL('about:blank');
});
