import { type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Brush,
  Download,
  Eraser,
  Image,
  Layers,
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
  { mode: 'projectionPaint', label: 'Projection', icon: Layers },
  { mode: 'erase', label: 'Erase', icon: Eraser }
]

export function App(): ReactElement {
  const viewerRef = useRef<ModelViewerHandle>(null)
  const capturingProjectionRef = useRef(false)
  const [isCapturingProjection, setIsCapturingProjection] = useState(false)
  const [pendingProjectionCreatedPath, setPendingProjectionCreatedPath] = useState<string | null>(null)
  const {
    model,
    texture,
    projectionImage,
    mode,
    brushColor,
    brushSize,
    brushStrength,
    brushHardness,
    projectionOpacity,
    textureResolution,
    lastUv,
    status,
    setModel,
    setTexture,
    setProjectionImage,
    setMode,
    setBrushColor,
    setBrushSize,
    setBrushStrength,
    setBrushHardness,
    setProjectionOpacity,
    setStatus,
    resetWorkspace
  } = useTextureToolStore()

  useEffect(() => {
    let alive = true

    async function restoreInitialAssets(): Promise<void> {
      const initialAssets = await window.textureTool.loadInitialAssets()
      if (!alive) {
        return
      }

      if (initialAssets.model) {
        setModel(initialAssets.model)
      }

      if (initialAssets.texture) {
        setTexture(initialAssets.texture)
      }

      if (initialAssets.model || initialAssets.texture) {
        setStatus(
          `Restored ${[initialAssets.model?.name, initialAssets.texture?.name].filter(Boolean).join(' / ')}`
        )
      }
    }

    void restoreInitialAssets()

    const removeResetListener = window.textureTool.onResetWorkspace(() => {
      setPendingProjectionCreatedPath(null)
      resetWorkspace()
    })

    return () => {
      alive = false
      removeResetListener()
    }
  }, [resetWorkspace, setModel, setStatus, setTexture])

  async function handleOpenObj(): Promise<void> {
    const nextModel = await window.textureTool.openObj()
    if (!nextModel) {
      return
    }

    setModel(nextModel)
    setPendingProjectionCreatedPath(null)
    setStatus(`Loaded ${nextModel.name}`)
  }

  async function handleOpenTexture(): Promise<void> {
    const nextTexture = await window.textureTool.openTexture()
    if (!nextTexture) {
      return
    }

    setTexture(nextTexture)
    setPendingProjectionCreatedPath(null)
    setStatus(`Loaded ${nextTexture.name}`)
  }

  async function handleCaptureProjectionImage(): Promise<void> {
    if (capturingProjectionRef.current) {
      return
    }

    if (pendingProjectionCreatedPath) {
      capturingProjectionRef.current = true
      setIsCapturingProjection(true)
      setStatus('Reloading projection-created.png...')

      try {
        const capturedProjectionImage = await window.textureTool.loadProjectionCapture(pendingProjectionCreatedPath)
        setProjectionImage(capturedProjectionImage)
        setPendingProjectionCreatedPath(null)
        setStatus(`Reloaded ${capturedProjectionImage.name}`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to reload projection capture.')
      } finally {
        capturingProjectionRef.current = false
        setIsCapturingProjection(false)
      }
      return
    }

    const projectionViewDataUrl = viewerRef.current?.getProjectionViewDataUrl()
    if (!projectionViewDataUrl) {
      setStatus('Projection View is not ready to capture.')
      return
    }

    capturingProjectionRef.current = true
    setIsCapturingProjection(true)
    setStatus('Capturing Projection View...')

    try {
      const capture = await window.textureTool.saveProjectionCapture({
        projectionViewDataUrl,
        albedoPath: texture?.path ?? null
      })
      setPendingProjectionCreatedPath(capture.createdPath)
      setStatus(`Captured ${capture.capturePath}. Click Reload to load ${capture.createdPath}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to capture Projection View.')
    } finally {
      capturingProjectionRef.current = false
      setIsCapturingProjection(false)
    }
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
            <button
              type="button"
              className="tool-button"
              onClick={handleCaptureProjectionImage}
              disabled={isCapturingProjection}
              title={
                pendingProjectionCreatedPath
                  ? 'Reload projection-created.png'
                  : 'Capture Projection View for projection image'
              }
            >
              <Layers size={18} />
              <span>
                {isCapturingProjection ? (pendingProjectionCreatedPath ? 'Reloading' : 'Capturing') : pendingProjectionCreatedPath ? 'Reload' : 'Projection'}
              </span>
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
                  title={option.mode === 'projectionPaint' ? 'Projection Paint' : option.label}
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
            <span>Strength {Math.round(brushStrength * 100)}%</span>
            <input
              type="range"
              min="5"
              max="100"
              value={Math.round(brushStrength * 100)}
              onChange={(event) => setBrushStrength(Number(event.currentTarget.value) / 100)}
            />
          </label>

          <label className="control-block">
            <span>Hardness {Math.round(brushHardness * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(brushHardness * 100)}
              onChange={(event) => setBrushHardness(Number(event.currentTarget.value) / 100)}
            />
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Layers size={16} />
            <span>Projection</span>
          </div>

          <label className="control-block">
            <span>Overlay {Math.round(projectionOpacity * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(projectionOpacity * 100)}
              onChange={(event) => setProjectionOpacity(Number(event.currentTarget.value) / 100)}
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
              <dt>Projection</dt>
              <dd>{projectionImage?.name ?? 'None'}</dd>
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
