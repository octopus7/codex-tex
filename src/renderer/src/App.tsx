import { type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Brush,
  Camera,
  Download,
  Eraser,
  Image,
  Layers,
  MousePointer2,
  RefreshCw,
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
  return window.location.hash === '#projection' ? <ProjectionWindow /> : <MainWindow />
}

function MainWindow(): ReactElement {
  const viewerRef = useRef<ModelViewerHandle>(null)
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

  async function handleOpenProjectionWindow(): Promise<void> {
    await window.textureTool.openProjectionWindow()
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
          <div className="topbar-title">
            <h1>Codex Tex</h1>
            <p title={status}>{status}</p>
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
              onClick={handleOpenProjectionWindow}
              title="Open Projection View"
            >
              <Layers size={18} />
              <span>Projection</span>
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

function ProjectionWindow(): ReactElement {
  const viewerRef = useRef<ModelViewerHandle>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [projectionCreatedPath, setProjectionCreatedPath] = useState<string | null>(null)
  const texture = useTextureToolStore((state) => state.texture)
  const setModel = useTextureToolStore((state) => state.setModel)
  const setTexture = useTextureToolStore((state) => state.setTexture)
  const setProjectionImage = useTextureToolStore((state) => state.setProjectionImage)
  const resetWorkspace = useTextureToolStore((state) => state.resetWorkspace)

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
    }

    void restoreInitialAssets()

    const removeResetListener = window.textureTool.onResetWorkspace(() => {
      setProjectionCreatedPath(null)
      resetWorkspace()
    })

    return () => {
      alive = false
      removeResetListener()
    }
  }, [resetWorkspace, setModel, setTexture])

  async function resolveProjectionCreatedPath(): Promise<string> {
    if (projectionCreatedPath) {
      return projectionCreatedPath
    }

    const paths = await window.textureTool.getProjectionPaths(texture?.path ?? null)
    setProjectionCreatedPath(paths.createdPath)

    return paths.createdPath
  }

  async function handleCapture(): Promise<void> {
    if (isBusy) {
      return
    }

    const projectionViewDataUrl = viewerRef.current?.getProjectionViewDataUrl()
    if (!projectionViewDataUrl) {
      return
    }

    setIsBusy(true)
    try {
      const capture = await window.textureTool.saveProjectionCapture({
        projectionViewDataUrl,
        albedoPath: texture?.path ?? null
      })
      setProjectionCreatedPath(capture.createdPath)
    } catch (error) {
      console.error(error)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleReload(): Promise<void> {
    if (isBusy) {
      return
    }

    setIsBusy(true)
    try {
      const capturedProjectionImage = await window.textureTool.loadProjectionCapture(
        await resolveProjectionCreatedPath()
      )
      setProjectionImage(capturedProjectionImage)
    } catch (error) {
      console.error(error)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="projection-window-shell">
      <header className="projection-window-toolbar">
        <strong>Projection View</strong>
        <div className="projection-window-actions">
          <button type="button" className="tool-button" onClick={handleCapture} disabled={isBusy} title="Capture">
            <Camera size={18} />
            <span>Capture</span>
          </button>
          <button type="button" className="tool-button" onClick={handleReload} disabled={isBusy} title="Reload">
            <RefreshCw size={18} />
            <span>Reload</span>
          </button>
        </div>
      </header>
      <section className="projection-window-stage">
        <ModelViewer ref={viewerRef} projectionWindow />
      </section>
    </main>
  )
}
