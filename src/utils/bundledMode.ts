/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}

type BunRuntime = {
  embeddedFiles?: unknown[]
}

function getBunRuntime(): BunRuntime | undefined {
  return (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun
}

function isJavaScriptEntrypoint(value: string): boolean {
  return /\.(?:mjs|cjs|js|jsx|ts|tsx)$/i.test(value)
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value
}

/**
 * Detects if running as a Bun-compiled standalone executable.
 * Prefer Bun's embedded file list when available, but also handle builds where
 * Bun runs from its virtual /$bunfs tree without exposing embeddedFiles.
 */
export function isInBundledMode(): boolean {
  const bun = getBunRuntime()
  if (!bun) {
    return false
  }

  if (Array.isArray(bun.embeddedFiles) && bun.embeddedFiles.length > 0) {
    return true
  }

  const entrypoint = process.argv[1] ?? ''
  const executable = process.execPath ?? ''
  if (entrypoint.includes('/$bunfs/') || executable.includes('/$bunfs/')) {
    return true
  }

  const executableName = basename(executable)
  return (
    isRunningWithBun() &&
    !/^bun(?:\.exe)?$/i.test(executableName) &&
    !isJavaScriptEntrypoint(executableName) &&
    (entrypoint.length === 0 || !isJavaScriptEntrypoint(entrypoint))
  )
}
