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
  openProjectionWindow: () => Promise<boolean>
  resetWorkspace: () => Promise<boolean>
  onResetWorkspace: (callback: () => void) => () => void
  saveTexture: (dataUrl: string, suggestedName?: string) => Promise<string | null>
}

declare global {
  interface Window {
    textureTool: TextureToolApi
  }
}
