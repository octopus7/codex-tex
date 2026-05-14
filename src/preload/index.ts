import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openObj: () => ipcRenderer.invoke('asset:open-obj'),
  openTexture: () => ipcRenderer.invoke('asset:open-texture'),
  openProjectionImage: () => ipcRenderer.invoke('asset:open-projection-image'),
  saveTexture: (dataUrl: string, suggestedName?: string) =>
    ipcRenderer.invoke('asset:save-texture', dataUrl, suggestedName)
}

contextBridge.exposeInMainWorld('textureTool', api)
