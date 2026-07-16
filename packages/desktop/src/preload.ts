import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, ModEvent, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';

/** The sandboxed bridge: the setup renderer sees exactly {@link DesktopApi} as `window.desktop`. */
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
};

contextBridge.exposeInMainWorld('desktop', api);
