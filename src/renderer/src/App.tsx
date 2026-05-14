import { type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Brush,
  Check,
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
import { ModelViewer, type ModelViewerHandle, type ViewportCameraState } from './viewport/ModelViewer'
import { useTextureToolStore, type ToolMode } from './store'

const mainModeOptions: Array<{ mode: Exclude<ToolMode, 'projectionPaint'>; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'orbit', label: 'Orbit', icon: Rotate3D },
  { mode: 'paint', label: 'Paint', icon: Brush },
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
    const removeProjectionImageListener = window.textureTool.onProjectionImageLoaded((nextProjectionImage) => {
      setProjectionImage(nextProjectionImage)
    })
    const removeTextureUpdateListener = window.textureTool.onTextureUpdated((nextTexture) => {
      setTexture(nextTexture)
      setStatus(`Updated ${nextTexture.name} from Projection View`)
    })

    return () => {
      alive = false
      removeTextureUpdateListener()
      removeProjectionImageListener()
      removeResetListener()
    }
  }, [resetWorkspace, setModel, setProjectionImage, setStatus, setTexture])

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
    await window.textureTool.openProjectionWindow(viewerRef.current?.getViewportState() ?? null)
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
            {mainModeOptions.map((option) => {
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
  const autoCapturedRef = useRef(false)
  const [isBusy, setIsBusy] = useState(false)
  const [initialAssetsReady, setInitialAssetsReady] = useState(false)
  const [projectionCreatedPath, setProjectionCreatedPath] = useState<string | null>(null)
  const [initialViewState, setInitialViewState] = useState<ViewportCameraState | null>(null)
  const model = useTextureToolStore((state) => state.model)
  const texture = useTextureToolStore((state) => state.texture)
  const mode = useTextureToolStore((state) => state.mode)
  const brushSize = useTextureToolStore((state) => state.brushSize)
  const brushStrength = useTextureToolStore((state) => state.brushStrength)
  const brushHardness = useTextureToolStore((state) => state.brushHardness)
  const projectionOpacity = useTextureToolStore((state) => state.projectionOpacity)
  const setModel = useTextureToolStore((state) => state.setModel)
  const setTexture = useTextureToolStore((state) => state.setTexture)
  const setProjectionImage = useTextureToolStore((state) => state.setProjectionImage)
  const setMode = useTextureToolStore((state) => state.setMode)
  const setBrushSize = useTextureToolStore((state) => state.setBrushSize)
  const setBrushStrength = useTextureToolStore((state) => state.setBrushStrength)
  const setBrushHardness = useTextureToolStore((state) => state.setBrushHardness)
  const setProjectionOpacity = useTextureToolStore((state) => state.setProjectionOpacity)
  const resetWorkspace = useTextureToolStore((state) => state.resetWorkspace)

  useEffect(() => {
    setMode('projectionPaint')
  }, [setMode])

  useEffect(() => {
    let alive = true

    async function restoreInitialAssets(): Promise<void> {
      const [initialAssets, projectionViewState] = await Promise.all([
        window.textureTool.loadInitialAssets(),
        window.textureTool.getProjectionViewState()
      ])
      if (!alive) {
        return
      }

      if (initialAssets.model) {
        setModel(initialAssets.model)
      }

      if (initialAssets.texture) {
        setTexture(initialAssets.texture)
      }

      setInitialViewState(projectionViewState)
      setInitialAssetsReady(true)
    }

    void restoreInitialAssets()

    const removeProjectionViewStateListener = window.textureTool.onProjectionViewState((viewState) => {
      setInitialViewState(viewState)
    })

    const removeResetListener = window.textureTool.onResetWorkspace(() => {
      autoCapturedRef.current = false
      setInitialAssetsReady(false)
      setProjectionCreatedPath(null)
      resetWorkspace()
      setMode('projectionPaint')
    })

    return () => {
      alive = false
      removeProjectionViewStateListener()
      removeResetListener()
    }
  }, [resetWorkspace, setMode, setModel, setTexture])

  useEffect(() => {
    if (!initialAssetsReady || !model || autoCapturedRef.current) {
      return
    }

    let cancelled = false
    autoCapturedRef.current = true

    async function captureAfterOpen(): Promise<void> {
      await waitForRenderFrames(4)
      if (cancelled) {
        return
      }

      await captureProjectionView()
    }

    void captureAfterOpen()

    return () => {
      cancelled = true
    }
  }, [initialAssetsReady, initialViewState, model, texture?.path])

  async function resolveProjectionCreatedPath(): Promise<string> {
    if (projectionCreatedPath) {
      return projectionCreatedPath
    }

    const paths = await window.textureTool.getProjectionPaths(texture?.path ?? null)
    setProjectionCreatedPath(paths.createdPath)

    return paths.createdPath
  }

  async function captureProjectionView(): Promise<void> {
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
      viewerRef.current?.resetProjectionMask()
    } catch (error) {
      console.error(error)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleBake(): Promise<void> {
    if (isBusy) {
      return
    }

    setIsBusy(true)
    try {
      await waitForRenderFrames(1)
      viewerRef.current?.bakeProjectionMask()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="projection-window-shell">
      <header className="projection-window-toolbar">
        <strong>Projection View</strong>
        <div className="projection-window-actions">
          <button
            type="button"
            className={mode === 'projectionPaint' ? 'tool-button active' : 'tool-button'}
            onClick={() => setMode('projectionPaint')}
            title="Paint projection mask"
            disabled={isBusy}
          >
            <Layers size={18} />
            <span>Mask</span>
          </button>
          <button
            type="button"
            className={mode === 'erase' ? 'tool-button active' : 'tool-button'}
            onClick={() => setMode('erase')}
            title="Erase projection mask"
            disabled={isBusy}
          >
            <Eraser size={18} />
            <span>Erase</span>
          </button>
          <label className="projection-overlay-control">
            <span>Overlay {Math.round(projectionOpacity * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(projectionOpacity * 100)}
              onChange={(event) => setProjectionOpacity(Number(event.currentTarget.value) / 100)}
            />
          </label>
          <label className="projection-compact-control">
            <span>Size {brushSize}px</span>
            <input
              type="range"
              min="4"
              max="180"
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.currentTarget.value))}
            />
          </label>
          <label className="projection-compact-control">
            <span>Strength {Math.round(brushStrength * 100)}%</span>
            <input
              type="range"
              min="5"
              max="100"
              value={Math.round(brushStrength * 100)}
              onChange={(event) => setBrushStrength(Number(event.currentTarget.value) / 100)}
            />
          </label>
          <label className="projection-compact-control">
            <span>Hardness {Math.round(brushHardness * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(brushHardness * 100)}
              onChange={(event) => setBrushHardness(Number(event.currentTarget.value) / 100)}
            />
          </label>
          <button type="button" className="tool-button" onClick={handleReload} disabled={isBusy} title="Reload">
            <RefreshCw size={18} />
            <span>Reload</span>
          </button>
          <button type="button" className="tool-button primary" onClick={handleBake} disabled={isBusy} title="Bake">
            <Check size={18} />
            <span>Bake</span>
          </button>
        </div>
      </header>
      <section className="projection-window-stage">
        <ModelViewer ref={viewerRef} projectionWindow initialViewState={initialViewState} />
      </section>
    </main>
  )
}

function waitForRenderFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    function next(remaining: number): void {
      if (remaining <= 0) {
        resolve()
        return
      }

      requestAnimationFrame(() => next(remaining - 1))
    }

    next(count)
  })
}
