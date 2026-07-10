import { logDiagnostic } from './services/diagnostics-log'

const BORINGSSL_BAD_DECRYPT_PATTERN =
  /Cipher functions:OPENSSL_internal:BAD_DECRYPT|OPENSSL_internal:BAD_DECRYPT|e_aes\.cc\.inc/i

// undici (Node global fetch) can throw an uncaught assertion — not a rejectable
// error — when a request is aborted while its socket is finishing. It escapes
// local try/catch and would otherwise crash the main process.
const UNDICI_ABORT_ASSERTION_PATTERN =
  /assert\(!this\.paused\)|Parser\.finish.*undici|onHttpSocketEnd/i

let installed = false

export function installRuntimeErrorGuards(): void {
  if (installed) return
  installed = true

  process.on('uncaughtException', handleUncaughtException)
  process.on('unhandledRejection', handleUnhandledRejection)
}

export function isBoringSslBadDecryptError(error: unknown): boolean {
  return BORINGSSL_BAD_DECRYPT_PATTERN.test(getErrorMessage(error))
}

export function isUndiciAbortAssertionError(error: unknown): boolean {
  return UNDICI_ABORT_ASSERTION_PATTERN.test(getErrorMessage(error))
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function handleUncaughtException(error: Error): void {
  if (isBoringSslBadDecryptError(error)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT runtime error.')
    return
  }

  if (isUndiciAbortAssertionError(error)) {
    logDiagnostic('uncaughtException', `Ignored undici abort assertion: ${getErrorMessage(error)}`)
    return
  }

  logDiagnostic('uncaughtException', getErrorMessage(error))
  process.off('uncaughtException', handleUncaughtException)
  throw error
}

function handleUnhandledRejection(reason: unknown): void {
  if (isBoringSslBadDecryptError(reason)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT unhandled rejection.')
    return
  }

  if (isUndiciAbortAssertionError(reason)) {
    logDiagnostic('unhandledRejection', `Ignored undici abort assertion: ${getErrorMessage(reason)}`)
    return
  }

  logDiagnostic('unhandledRejection', getErrorMessage(reason))
  throw reason instanceof Error ? reason : new Error(getErrorMessage(reason))
}
