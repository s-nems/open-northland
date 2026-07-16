import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';

/** The sandboxed bridge: the setup renderer sees exactly {@link DesktopApi} as `window.desktop`. */
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),
  pickGameFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickGameFolder),
  probeGamePath: (path) => ipcRenderer.invoke(IPC_CHANNELS.probeGamePath, path),
  detectGameFolders: () => ipcRenderer.invoke(IPC_CHANNELS.detectGameFolders),
  runPipeline: (gamePath) => ipcRenderer.invoke(IPC_CHANNELS.runPipeline, gamePath),
  onPipelineEvent: (listener) => {
    ipcRenderer.on(IPC_CHANNELS.pipelineEvent, (_ev, event: PipelineEvent) => listener(event));
  },
  startGame: () => ipcRenderer.invoke(IPC_CHANNELS.startGame),
};

contextBridge.exposeInMainWorld('desktop', api);
