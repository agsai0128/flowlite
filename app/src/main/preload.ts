// Preload bridge — exposes a tiny, explicit API to the capture window only.
// contextIsolation is on; the renderer never gets Node or ipcRenderer directly.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flow', {
  // renderer -> main
  sendAudio: (pcm: ArrayBuffer) => ipcRenderer.send('audio-chunk', pcm),
  captureStopped: () => ipcRenderer.send('capture-stopped'),
  captureError: (msg: string) => ipcRenderer.send('capture-error', msg),
  // main -> renderer
  onControl: (cb: (cmd: 'start' | 'stop') => void) =>
    ipcRenderer.on('control', (_e, cmd) => cb(cmd)),
  onState: (cb: (s: string) => void) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onHandsFree: (cb: () => void) => ipcRenderer.on('handsfree', () => cb()),
  onPartial: (cb: (t: string) => void) => ipcRenderer.on('partial', (_e, t) => cb(t)),
  onError: (cb: (m: string) => void) => ipcRenderer.on('error', (_e, m) => cb(m)),
});
