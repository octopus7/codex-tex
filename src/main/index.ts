import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

interface RecentAssets {
  modelPath?: string
  texturePath?: string
}

interface LoadedTexture {
  name: string
  path: string
  dataUrl: string
}

interface ProjectionCapturePayload {
  projectionViewDataUrl: string
  albedoPath?: string | null
}

interface ProjectionCaptureResult {
  capturePath: string
  createdPath: string
}

interface ViewportCameraState {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
  fov: number
  zoom: number
}

let projectionWindow: BrowserWindow | null = null
let projectionViewState: ViewportCameraState | null = null

const imageMimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
])

function getRecentAssetsPath(): string {
  return join(app.getPath('userData'), 'recent-assets.json')
}

async function readRecentAssets(): Promise<RecentAssets> {
  try {
    const content = await readFile(getRecentAssetsPath(), 'utf8')
    const parsed = JSON.parse(content) as RecentAssets

    return {
      modelPath: typeof parsed.modelPath === 'string' ? parsed.modelPath : undefined,
      texturePath: typeof parsed.texturePath === 'string' ? parsed.texturePath : undefined
    }
  } catch {
    return {}
  }
}

async function writeRecentAssets(patch: RecentAssets): Promise<void> {
  const nextAssets = { ...(await readRecentAssets()), ...patch }
  await writeFile(getRecentAssetsPath(), JSON.stringify(nextAssets, null, 2), 'utf8')
}

async function clearRecentAssets(): Promise<void> {
  await writeFile(getRecentAssetsPath(), JSON.stringify({}, null, 2), 'utf8')
}

async function loadObjFromPath(path: string): Promise<{ name: string; path: string; content: string }> {
  const content = await readFile(path, 'utf8')

  return {
    name: basename(path),
    path,
    content
  }
}

async function loadTextureFromPath(path: string): Promise<{ name: string; path: string; dataUrl: string }> {
  const buffer = await readFile(path)
  const extension = extname(path).toLowerCase()
  const mime = imageMimeByExtension.get(extension) ?? 'application/octet-stream'

  return {
    name: basename(path),
    path,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Invalid image data URL.')
  }

  return Buffer.from(match[2], 'base64')
}

function getProjectionDirectory(albedoPath?: string | null): string {
  return albedoPath ? dirname(albedoPath) : app.getPath('userData')
}

function getProjectionPaths(albedoPath?: string | null): ProjectionCaptureResult {
  const outputDirectory = getProjectionDirectory(albedoPath)

  return {
    capturePath: join(outputDirectory, 'projection-capture.png'),
    createdPath: join(outputDirectory, 'projection-created.png')
  }
}

async function saveProjectionCapture({
  projectionViewDataUrl,
  albedoPath
}: ProjectionCapturePayload): Promise<ProjectionCaptureResult> {
  const { capturePath, createdPath } = getProjectionPaths(albedoPath)
  await writeFile(capturePath, dataUrlToBuffer(projectionViewDataUrl))

  return { capturePath, createdPath }
}

function loadRendererWindow(targetWindow: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    targetWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`)
  } else {
    targetWindow.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function cloneViewportCameraState(viewState?: ViewportCameraState | null): ViewportCameraState | null {
  if (!viewState) {
    return null
  }

  return {
    position: [...viewState.position],
    quaternion: [...viewState.quaternion],
    target: [...viewState.target],
    fov: viewState.fov,
    zoom: viewState.zoom
  }
}

function isLoadedTexture(value: unknown): value is LoadedTexture {
  if (!value || typeof value !== 'object') {
    return false
  }

  const texture = value as Partial<LoadedTexture>

  return (
    typeof texture.name === 'string' &&
    typeof texture.path === 'string' &&
    typeof texture.dataUrl === 'string'
  )
}

function setupApplicationMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Reset',
          click: async () => {
            await clearRecentAssets()
            BrowserWindow.getAllWindows().forEach((targetWindow) => {
              targetWindow.webContents.send('app:reset-workspace')
            })
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ])

  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f5f4ef',
    title: 'Codex Tex',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setupApplicationMenu()

  loadRendererWindow(mainWindow)
}

function openProjectionWindow(parent?: BrowserWindow | null, viewState?: ViewportCameraState | null): void {
  projectionViewState = cloneViewportCameraState(viewState)

  if (projectionWindow && !projectionWindow.isDestroyed()) {
    projectionWindow.webContents.send('app:projection-view-state', projectionViewState)
    projectionWindow.focus()
    return
  }

  projectionWindow = new BrowserWindow({
    width: 880,
    height: 940,
    minWidth: 680,
    minHeight: 760,
    backgroundColor: '#f5f4ef',
    title: 'Codex Tex Projection',
    parent: parent ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  projectionWindow.on('closed', () => {
    projectionWindow = null
  })

  projectionWindow.webContents.once('did-finish-load', () => {
    projectionWindow?.webContents.send('app:projection-view-state', projectionViewState)
  })

  loadRendererWindow(projectionWindow, 'projection')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('asset:open-obj', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open OBJ',
    properties: ['openFile'],
    filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const path = result.filePaths[0]
  const loadedObj = await loadObjFromPath(path)
  await writeRecentAssets({ modelPath: path })

  return loadedObj
})

ipcMain.handle('asset:open-texture', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Albedo Texture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const path = result.filePaths[0]
  const loadedTexture = await loadTextureFromPath(path)
  await writeRecentAssets({ texturePath: path })

  return loadedTexture
})

ipcMain.handle('asset:open-projection-image', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Projection Image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return loadTextureFromPath(result.filePaths[0])
})

ipcMain.handle('asset:save-projection-capture', async (_event, payload: ProjectionCapturePayload) => {
  return saveProjectionCapture(payload)
})

ipcMain.handle('asset:get-projection-paths', async (_event, albedoPath?: string | null) => {
  return getProjectionPaths(albedoPath)
})

ipcMain.handle('asset:load-projection-capture', async (_event, path?: string) => {
  const loadedProjectionImage = await loadTextureFromPath(path ?? join(app.getPath('userData'), 'projection-created.png'))
  BrowserWindow.getAllWindows().forEach((targetWindow) => {
    targetWindow.webContents.send('asset:projection-image-loaded', loadedProjectionImage)
  })

  return loadedProjectionImage
})

ipcMain.on('asset:texture-updated', (event, nextTexture: LoadedTexture) => {
  if (!isLoadedTexture(nextTexture)) {
    return
  }

  BrowserWindow.getAllWindows().forEach((targetWindow) => {
    if (targetWindow.webContents === event.sender) {
      return
    }

    targetWindow.webContents.send('asset:texture-updated', nextTexture)
  })
})

ipcMain.handle('app:open-projection-window', async (event, viewState?: ViewportCameraState | null) => {
  openProjectionWindow(BrowserWindow.fromWebContents(event.sender), viewState)
  return true
})

ipcMain.handle('app:get-projection-view-state', async () => {
  return cloneViewportCameraState(projectionViewState)
})

ipcMain.handle('asset:load-initial-assets', async () => {
  const recentAssets = await readRecentAssets()
  const [model, texture] = await Promise.all([
    recentAssets.modelPath ? loadObjFromPath(recentAssets.modelPath).catch(() => null) : null,
    recentAssets.texturePath ? loadTextureFromPath(recentAssets.texturePath).catch(() => null) : null
  ])

  return { model, texture }
})

ipcMain.handle('asset:reset-workspace', async () => {
  await clearRecentAssets()
  return true
})

ipcMain.handle('asset:save-texture', async (_event, dataUrl: string, suggestedName?: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Export Texture',
    defaultPath: suggestedName ?? 'albedo-painted.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  const payload = dataUrl.replace(/^data:image\/png;base64,/, '')
  await writeFile(result.filePath, Buffer.from(payload, 'base64'))

  return result.filePath
})
