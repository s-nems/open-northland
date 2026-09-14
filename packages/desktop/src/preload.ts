import type { ModEvent, PipelineEvent } from '@open-northland/installer';
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';

/** The context-isolated bridge: the renderer gets exactly this API as `window.desktop`, no `ipcRenderer`. */
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),
  runPipeline: () => ipcRenderer.invoke(IPC_CHANNELS.runPipeline),
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
  listSaves: () => ipcRenderer.invoke(IPC_CHANNELS.listSaves),
  readSave: (file) => ipcRenderer.invoke(IPC_CHANNELS.readSave, file),
  writeSave: (name, bytes) => ipcRenderer.invoke(IPC_CHANNELS.writeSave, name, bytes),
  deleteSave: (file) => ipcRenderer.invoke(IPC_CHANNELS.deleteSave, file),
  showSavesFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showSavesFolder),
};

contextBridge.exposeInMainWorld('desktop', api);
