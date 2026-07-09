import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const LOG_FILE_NAME = 'main.log'
const MAX_LOG_BYTES = 2 * 1024 * 1024

let cachedLogPath: string | undefined

function getLogPath(): string | undefined {
  if (cachedLogPath) return cachedLogPath

  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    cachedLogPath = join(dir, LOG_FILE_NAME)
    return cachedLogPath
  } catch {
    return undefined
  }
}

function rotateIfNeeded(logPath: string): void {
  try {
    if (statSync(logPath).size < MAX_LOG_BYTES) return
    renameSync(logPath, `${logPath}.1`)
  } catch {
    // File missing or rotation failed — safe to ignore, we just keep appending.
  }
}

export function logDiagnostic(scope: string, message: string): void {
  const logPath = getLogPath()
  if (!logPath) return

  rotateIfNeeded(logPath)
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [${scope}] ${message}\n`

  try {
    appendFileSync(logPath, line, 'utf8')
  } catch {
    // Never let logging failures affect the app.
  }
}

export function getDiagnosticsLogPath(): string | undefined {
  return getLogPath()
}
