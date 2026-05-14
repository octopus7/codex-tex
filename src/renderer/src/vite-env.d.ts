/// <reference types="vite/client" />

export interface LoadedObj {
  name: string
  path: string
  content: string
}

export interface LoadedTexture {
  name: string
  path: string
  dataUrl: string
}

export interface InitialAssets {
  model: LoadedObj | null
  texture: LoadedTexture | null
}

export interface ViewportCameraState {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
  fov: number
  zoom: number
}

export interface TextureToolApi {
  loadInitialAssets: () => Promise<InitialAssets>
  openObj: () => Promise<LoadedObj | null>
  openTexture: () => Promise<LoadedTexture | null>
  openProjectionImage: () => Promise<LoadedTexture | null>
  saveProjectionCapture: (payload: {
    projectionViewDataUrl: string
    albedoPath?: string | null
  }) => Promise<{ capturePath: string; createdPath: string }>
  getProjectionPaths: (albedoPath?: string | null) => Promise<{ capturePath: string; createdPath: string }>
  loadProjectionCapture: (path?: string) => Promise<LoadedTexture>
  openProjectionWindow: (viewState?: ViewportCameraState | null) => Promise<boolean>
  getProjectionViewState: () => Promise<ViewportCameraState | null>
  onProjectionViewState: (callback: (viewState: ViewportCameraState | null) => void) => () => void
  onProjectionImageLoaded: (callback: (projectionImage: LoadedTexture) => void) => () => void
  publishTextureUpdate: (texture: LoadedTexture) => void
  onTextureUpdated: (callback: (texture: LoadedTexture) => void) => () => void
  resetWorkspace: () => Promise<boolean>
  onResetWorkspace: (callback: () => void) => () => void
  saveTexture: (dataUrl: string, suggestedName?: string) => Promise<string | null>
}

declare global {
  interface Window {
    textureTool: TextureToolApi
  }
}
