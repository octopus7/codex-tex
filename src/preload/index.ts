import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface ViewportCameraState {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
  fov: number
  zoom: number
}

interface LoadedTexture {
  name: string
  path: string
  dataUrl: string
}

const api = {
  loadInitialAssets: () => ipcRenderer.invoke('asset:load-initial-assets'),
  openObj: () => ipcRenderer.invoke('asset:open-obj'),
  openTexture: () => ipcRenderer.invoke('asset:open-texture'),
  openProjectionImage: () => ipcRenderer.invoke('asset:open-projection-image'),
  saveProjectionCapture: (payload: {
    projectionViewDataUrl: string
    albedoPath?: string | null
  }) => ipcRenderer.invoke('asset:save-projection-capture', payload),
  getProjectionPaths: (albedoPath?: string | null) => ipcRenderer.invoke('asset:get-projection-paths', albedoPath),
  loadProjectionCapture: (path?: string) => ipcRenderer.invoke('asset:load-projection-capture', path),
  openProjectionWindow: (viewState?: ViewportCameraState | null) =>
    ipcRenderer.invoke('app:open-projection-window', viewState),
  getProjectionViewState: () => ipcRenderer.invoke('app:get-projection-view-state'),
  onProjectionViewState: (callback: (viewState: ViewportCameraState | null) => void) => {
    const listener = (_event: IpcRendererEvent, viewState: ViewportCameraState | null): void =>
      callback(viewState)
    ipcRenderer.on('app:projection-view-state', listener)

    return () => ipcRenderer.removeListener('app:projection-view-state', listener)
  },
  onProjectionImageLoaded: (callback: (projectionImage: LoadedTexture) => void) => {
    const listener = (_event: IpcRendererEvent, projectionImage: LoadedTexture): void => callback(projectionImage)
    ipcRenderer.on('asset:projection-image-loaded', listener)

    return () => ipcRenderer.removeListener('asset:projection-image-loaded', listener)
  },
  publishTextureUpdate: (texture: LoadedTexture) => ipcRenderer.send('asset:texture-updated', texture),
  onTextureUpdated: (callback: (texture: LoadedTexture) => void) => {
    const listener = (_event: IpcRendererEvent, texture: LoadedTexture): void => callback(texture)
    ipcRenderer.on('asset:texture-updated', listener)

    return () => ipcRenderer.removeListener('asset:texture-updated', listener)
  },
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
