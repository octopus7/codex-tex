import { create } from 'zustand'
import type { LoadedObj, LoadedTexture } from './vite-env'

export type ToolMode = 'orbit' | 'paint' | 'erase'

interface TextureToolState {
  model: LoadedObj | null
  texture: LoadedTexture | null
  mode: ToolMode
  brushColor: string
  brushSize: number
  brushOpacity: number
  textureResolution: string
  lastUv: string
  status: string
  setModel: (model: LoadedObj | null) => void
  setTexture: (texture: LoadedTexture | null) => void
  setMode: (mode: ToolMode) => void
  setBrushColor: (brushColor: string) => void
  setBrushSize: (brushSize: number) => void
  setBrushOpacity: (brushOpacity: number) => void
  setTextureResolution: (textureResolution: string) => void
  setLastUv: (lastUv: string) => void
  setStatus: (status: string) => void
}

export const useTextureToolStore = create<TextureToolState>((set) => ({
  model: null,
  texture: null,
  mode: 'orbit',
  brushColor: '#ef4e36',
  brushSize: 42,
  brushOpacity: 0.85,
  textureResolution: '1024 x 1024',
  lastUv: '-',
  status: 'Load an OBJ with UVs and an albedo texture.',
  setModel: (model) => set({ model }),
  setTexture: (texture) => set({ texture }),
  setMode: (mode) => set({ mode }),
  setBrushColor: (brushColor) => set({ brushColor }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setBrushOpacity: (brushOpacity) => set({ brushOpacity }),
  setTextureResolution: (textureResolution) => set({ textureResolution }),
  setLastUv: (lastUv) => set({ lastUv }),
  setStatus: (status) => set({ status })
}))
