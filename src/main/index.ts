import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

const imageMimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
])

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

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
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
  const content = await readFile(path, 'utf8')
  const name = path.split(/[\\/]/).at(-1) ?? 'model.obj'

  return { name, path, content }
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
  const buffer = await readFile(path)
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  const mime = imageMimeByExtension.get(extension) ?? 'application/octet-stream'
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
  const name = path.split(/[\\/]/).at(-1) ?? 'albedo.png'

  return { name, path, dataUrl }
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
