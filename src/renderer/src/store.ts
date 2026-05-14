import { create } from 'zustand'
import type { LoadedObj, LoadedTexture } from './vite-env'

export type ToolMode = 'orbit' | 'paint' | 'projectionPaint' | 'erase'

interface TextureToolState {
  model: LoadedObj | null
  texture: LoadedTexture | null
  projectionImage: LoadedTexture | null
  mode: ToolMode
  brushColor: string
  brushSize: number
  brushStrength: number
  brushHardness: number
  projectionOpacity: number
  textureResolution: string
  lastUv: string
  status: string
  setModel: (model: LoadedObj | null) => void
  setTexture: (texture: LoadedTexture | null) => void
  setProjectionImage: (projectionImage: LoadedTexture | null) => void
  setMode: (mode: ToolMode) => void
  setBrushColor: (brushColor: string) => void
  setBrushSize: (brushSize: number) => void
  setBrushStrength: (brushStrength: number) => void
  setBrushHardness: (brushHardness: number) => void
  setProjectionOpacity: (projectionOpacity: number) => void
  setTextureResolution: (textureResolution: string) => void
  setLastUv: (lastUv: string) => void
  setStatus: (status: string) => void
  resetWorkspace: () => void
}

const initialTextureToolState = {
  model: null,
  texture: null,
  projectionImage: null,
  mode: 'orbit',
  brushColor: '#ef4e36',
  brushSize: 42,
  brushStrength: 0.85,
  brushHardness: 0.65,
  projectionOpacity: 0.45,
  textureResolution: '1024 x 1024',
  lastUv: '-',
  status: 'Load an OBJ, albedo texture, and optional projection image.'
} satisfies Omit<
  TextureToolState,
  | 'setModel'
  | 'setTexture'
  | 'setProjectionImage'
  | 'setMode'
  | 'setBrushColor'
  | 'setBrushSize'
  | 'setBrushStrength'
  | 'setBrushHardness'
  | 'setProjectionOpacity'
  | 'setTextureResolution'
  | 'setLastUv'
  | 'setStatus'
  | 'resetWorkspace'
>

export const useTextureToolStore = create<TextureToolState>((set) => ({
  ...initialTextureToolState,
  setModel: (model) => set({ model }),
  setTexture: (texture) => set({ texture }),
  setProjectionImage: (projectionImage) => set({ projectionImage }),
  setMode: (mode) => set({ mode }),
  setBrushColor: (brushColor) => set({ brushColor }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setBrushStrength: (brushStrength) => set({ brushStrength }),
  setBrushHardness: (brushHardness) => set({ brushHardness }),
  setProjectionOpacity: (projectionOpacity) => set({ projectionOpacity }),
  setTextureResolution: (textureResolution) => set({ textureResolution }),
  setLastUv: (lastUv) => set({ lastUv }),
  setStatus: (status) => set({ status }),
  resetWorkspace: () => set({ ...initialTextureToolState, status: 'Workspace reset.' })
}))
