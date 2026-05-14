import { contextBridge, ipcRenderer } from 'electron'

const api = {
  loadInitialAssets: () => ipcRenderer.invoke('asset:load-initial-assets'),
  openObj: () => ipcRenderer.invoke('asset:open-obj'),
  openTexture: () => ipcRenderer.invoke('asset:open-texture'),
  openProjectionImage: () => ipcRenderer.invoke('asset:open-projection-image'),
  saveProjectionCapture: (payload: {
    projectionViewDataUrl: string
    albedoPath?: string | null
  }) => ipcRenderer.invoke('asset:save-projection-capture', payload),
  loadProjectionCapture: (path?: string) => ipcRenderer.invoke('asset:load-projection-capture', path),
  resetWorkspace: () => ipcRenderer.invoke('asset:reset-workspace'),
  onResetWorkspace: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:reset-workspace', listener)

    return () => ipcRenderer.removeListener('app:reset-workspace', listener)
  },
  saveTexture: (dataUrl: string, suggestedName?: string) =>
    ipcRenderer.invoke('asset:save-texture', dataUrl, suggestedName)
}

contextBridge.exposeInMainWorld('textureTool', api)
