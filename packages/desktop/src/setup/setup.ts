import { initSetup } from '@open-northland/installer/setup';
import type { DesktopApi } from '../ipc.js';

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

initSetup(window.desktop);
