import { app, shell, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { MonitorManager } from './monitors/MonitorManager'
import { AnalysisScheduler } from './analyzer/AnalysisScheduler'
import { registerIpcHandlers } from './ipc/handlers'
import { closeDatabase } from './database/connection'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const monitorManager = new MonitorManager()
const analysisScheduler = new AnalysisScheduler()

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow!.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(icon)
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show()
      }
    },
    { type: 'separator' },
    {
      label: '暂停监控',
      click: () => {
        monitorManager.pause()
        updateTrayMenu()
      }
    },
    {
      label: '恢复监控',
      click: () => {
        monitorManager.resume()
        updateTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Desktop Monitor')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

function updateTrayMenu(): void {
  if (!tray) return
  const status = monitorManager.getStatus()
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => mainWindow?.show()
    },
    { type: 'separator' },
    {
      label: status.isPaused ? '恢复监控' : '暂停监控',
      click: () => {
        if (status.isPaused) {
          monitorManager.resume()
        } else {
          monitorManager.pause()
        }
        updateTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
}

if (gotTheLock) {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.desktop-monitor')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()
    createTray()
    registerIpcHandlers(monitorManager, analysisScheduler, mainWindow!)
    analysisScheduler.start()

    await monitorManager.startAll()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', async () => {
    ;(app as any).isQuitting = true
    await monitorManager.stopAll()
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
