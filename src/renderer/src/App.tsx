import { useRef } from 'react'
import {
  Brush,
  Download,
  Eraser,
  Image,
  MousePointer2,
  Rotate3D,
  SlidersHorizontal,
  Upload
} from 'lucide-react'
import { ModelViewer, type ModelViewerHandle } from './viewport/ModelViewer'
import { useTextureToolStore, type ToolMode } from './store'

const modeOptions: Array<{ mode: ToolMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'orbit', label: 'Orbit', icon: Rotate3D },
  { mode: 'paint', label: 'Paint', icon: Brush },
  { mode: 'erase', label: 'Erase', icon: Eraser }
]

export function App(): JSX.Element {
  const viewerRef = useRef<ModelViewerHandle>(null)
  const {
    model,
    texture,
    mode,
    brushColor,
    brushSize,
    brushOpacity,
    textureResolution,
    lastUv,
    status,
    setModel,
    setTexture,
    setMode,
    setBrushColor,
    setBrushSize,
    setBrushOpacity,
    setStatus
  } = useTextureToolStore()

  async function handleOpenObj(): Promise<void> {
    const nextModel = await window.textureTool.openObj()
    if (!nextModel) {
      return
    }

    setModel(nextModel)
    setStatus(`Loaded ${nextModel.name}`)
  }

  async function handleOpenTexture(): Promise<void> {
    const nextTexture = await window.textureTool.openTexture()
    if (!nextTexture) {
      return
    }

    setTexture(nextTexture)
    setStatus(`Loaded ${nextTexture.name}`)
  }

  async function handleExport(): Promise<void> {
    const dataUrl = viewerRef.current?.getTextureDataUrl()
    if (!dataUrl) {
      setStatus('There is no texture canvas to export yet.')
      return
    }

    const fileName = texture?.name ? texture.name.replace(/\.[^.]+$/, '-painted.png') : 'albedo-painted.png'
    const savedPath = await window.textureTool.saveTexture(dataUrl, fileName)
    if (savedPath) {
      setStatus(`Saved ${savedPath}`)
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Codex Tex</h1>
            <p>{status}</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="tool-button" onClick={handleOpenObj} title="Open OBJ">
              <Upload size={18} />
              <span>OBJ</span>
            </button>
            <button type="button" className="tool-button" onClick={handleOpenTexture} title="Open albedo texture">
              <Image size={18} />
              <span>Albedo</span>
            </button>
            <button type="button" className="tool-button primary" onClick={handleExport} title="Export painted PNG">
              <Download size={18} />
              <span>Export</span>
            </button>
          </div>
        </header>

        <ModelViewer ref={viewerRef} />
      </section>

      <aside className="inspector">
        <section className="panel-section">
          <div className="section-title">
            <SlidersHorizontal size={16} />
            <span>Tool</span>
          </div>
          <div className="segmented-control" role="group" aria-label="Tool mode">
            {modeOptions.map((option) => {
              const Icon = option.icon
              const active = mode === option.mode
              return (
                <button
                  key={option.mode}
                  type="button"
                  className={active ? 'active' : ''}
                  onClick={() => setMode(option.mode)}
                  title={option.label}
                >
                  <Icon size={17} />
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Brush size={16} />
            <span>Brush</span>
          </div>

          <label className="control-row">
            <span>Color</span>
            <input
              type="color"
              value={brushColor}
              onChange={(event) => setBrushColor(event.currentTarget.value)}
              aria-label="Brush color"
            />
          </label>

          <label className="control-block">
            <span>Size {brushSize}px</span>
            <input
              type="range"
              min="4"
              max="180"
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.currentTarget.value))}
            />
          </label>

          <label className="control-block">
            <span>Opacity {Math.round(brushOpacity * 100)}%</span>
            <input
              type="range"
              min="5"
              max="100"
              value={Math.round(brushOpacity * 100)}
              onChange={(event) => setBrushOpacity(Number(event.currentTarget.value) / 100)}
            />
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <MousePointer2 size={16} />
            <span>Asset</span>
          </div>
          <dl className="asset-list">
            <div>
              <dt>Model</dt>
              <dd>{model?.name ?? 'None'}</dd>
            </div>
            <div>
              <dt>Texture</dt>
              <dd>{texture?.name ?? 'Generated canvas'}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{textureResolution}</dd>
            </div>
            <div>
              <dt>Last UV</dt>
              <dd>{lastUv}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </main>
  )
}
