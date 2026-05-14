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

export interface TextureToolApi {
  openObj: () => Promise<LoadedObj | null>
  openTexture: () => Promise<LoadedTexture | null>
  saveTexture: (dataUrl: string, suggestedName?: string) => Promise<string | null>
}

declare global {
  interface Window {
    textureTool: TextureToolApi
  }
}
