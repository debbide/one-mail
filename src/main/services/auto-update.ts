import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater, { type AppUpdater, type ProgressInfo } from 'electron-updater'
import { isBoringSslBadDecryptError } from '../runtime-errors'
import type { AppUpdateCheckResult, AppUpdateStatus } from '../../shared/types'

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

let updateCheckTimer: NodeJS.Timeout | undefined
let autoUpdaterErrorHandlerInstalled = false
let lastUpdateStatus: AppUpdateStatus | null = null

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

function shouldCheckForUpdates(): boolean {
  return app.isPackaged && !is.dev
}

export function startAutoUpdateChecks(): void {
  if (!shouldCheckForUpdates() || updateCheckTimer) {
    return
  }

  const autoUpdater = getAutoUpdater()
  installAutoUpdaterErrorHandler(autoUpdater)

  const checkForUpdates = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      logUpdateError(error)
    })
  }

  checkForUpdates()
  updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

export function stopAutoUpdateChecks(): void {
  if (!updateCheckTimer) {
    return
  }

  clearInterval(updateCheckTimer)
  updateCheckTimer = undefined
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion()

  if (!shouldCheckForUpdates()) {
    const status = updateStatus('unsupported', {
      message: '当前运行环境暂不支持自动检查更新，请使用已打包的正式版本。'
    })
    return {
      status: 'unsupported',
      currentVersion,
      message: status.message
    }
  }

  const autoUpdater = getAutoUpdater()
  installAutoUpdaterErrorHandler(autoUpdater)

  try {
    const result = await autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo.version

    if (!result?.isUpdateAvailable || !latestVersion || latestVersion === currentVersion) {
      return {
        status: 'not_available',
        currentVersion,
        latestVersion,
        message: '当前已是最新版本。'
      }
    }

    if (result.downloadPromise) {
      result.downloadPromise.catch(() => undefined)
    }

    return {
      status: 'available',
      currentVersion,
      latestVersion,
      message: `发现新版本 v${latestVersion}，正在自动下载。`
    }
  } catch (error) {
    logUpdateError(error)
    return {
      status: 'error',
      currentVersion,
      message: error instanceof Error ? error.message : '检查更新失败。'
    }
  }
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return lastUpdateStatus ?? createUpdateStatus('idle', { message: '尚未检查更新。' })
}

function installAutoUpdaterErrorHandler(autoUpdater: AppUpdater): void {
  if (autoUpdaterErrorHandlerInstalled) return
  autoUpdaterErrorHandlerInstalled = true

  autoUpdater.on('error', logUpdateError)
  autoUpdater.on('checking-for-update', () => {
    updateStatus('checking', { message: '正在检查更新。' })
  })
  autoUpdater.on('update-available', (info) => {
    updateStatus('available', {
      latestVersion: info.version,
      message: `发现新版本 v${info.version}，正在自动下载。`
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    const latestVersion = lastUpdateStatus?.latestVersion
    updateStatus('downloading', {
      latestVersion,
      message: latestVersion ? `正在下载 v${latestVersion}。` : '正在下载更新。',
      progress: toAppUpdateProgress(progress)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus('downloaded', {
      latestVersion: info.version,
      message: `新版本 v${info.version} 已下载，重启应用后安装。`,
      progress: toDownloadedProgress()
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    updateStatus('not_available', {
      latestVersion: info.version,
      message: '当前已是最新版本。'
    })
  })
  autoUpdater.on('update-cancelled', (info) => {
    updateStatus('cancelled', {
      latestVersion: info.version,
      message: '更新下载已取消。'
    })
  })
}

function logUpdateError(error: unknown): void {
  if (isBoringSslBadDecryptError(error)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT while checking for updates.')
    return
  }

  updateStatus('error', {
    message: error instanceof Error ? error.message : '检查更新失败。'
  })
  console.error('Failed to check for updates', error)
}

function updateStatus(
  state: AppUpdateStatus['state'],
  input: Partial<Omit<AppUpdateStatus, 'state' | 'currentVersion' | 'updatedAt'>>
): AppUpdateStatus {
  const status = createUpdateStatus(state, input)
  lastUpdateStatus = status
  broadcastUpdateStatus(status)
  return status
}

function createUpdateStatus(
  state: AppUpdateStatus['state'],
  input: Partial<Omit<AppUpdateStatus, 'state' | 'currentVersion' | 'updatedAt'>>
): AppUpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    latestVersion: input.latestVersion ?? lastUpdateStatus?.latestVersion,
    message: input.message ?? lastUpdateStatus?.message ?? '',
    progress: input.progress,
    updatedAt: new Date().toISOString()
  }
}

function broadcastUpdateStatus(status: AppUpdateStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updates/status', status)
    }
  }
}

function toAppUpdateProgress(progress: ProgressInfo): AppUpdateStatus['progress'] {
  return {
    percent: clampPercent(progress.percent),
    transferredBytes: progress.transferred,
    totalBytes: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  }
}

function toDownloadedProgress(): AppUpdateStatus['progress'] {
  const progress = lastUpdateStatus?.progress
  if (!progress) return undefined

  return {
    ...progress,
    percent: 100,
    transferredBytes: progress.totalBytes || progress.transferredBytes
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
