import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, ModEvent, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';

/** The context-isolated bridge: the renderer gets exactly this API as `window.desktop`, no `ipcRenderer`. */
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),
  pickGameFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickGameFolder),
  probeGamePath: (path) => ipcRenderer.invoke(IPC_CHANNELS.probeGamePath, path),
  detectGameFolders: () => ipcRenderer.invoke(IPC_CHANNELS.detectGameFolders),
  runPipeline: (gamePath) => ipcRenderer.invoke(IPC_CHANNELS.runPipeline, gamePath),
  stopPipeline: () => ipcRenderer.invoke(IPC_CHANNELS.stopPipeline),
  onPipelineEvent: (listener) => {
    ipcRenderer.on(IPC_CHANNELS.pipelineEvent, (_ev, event: PipelineEvent) => listener(event));
  },
  downloadMod: () => ipcRenderer.invoke(IPC_CHANNELS.downloadMod),
  cancelModDownload: () => ipcRenderer.invoke(IPC_CHANNELS.cancelModDownload),
  pickModFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickModFolder),
  onModEvent: (listener) => {
    ipcRenderer.on(IPC_CHANNELS.modEvent, (_ev, event: ModEvent) => listener(event));
  },
  startGame: () => ipcRenderer.invoke(IPC_CHANNELS.startGame),
  setLocale: (locale) => ipcRenderer.invoke(IPC_CHANNELS.setLocale, locale),
  saveGameFile: (suggestedName, contents) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveGameFile, suggestedName, contents),
  openGameFile: () => ipcRenderer.invoke(IPC_CHANNELS.openGameFile),
};

contextBridge.exposeInMainWorld('desktop', api);
