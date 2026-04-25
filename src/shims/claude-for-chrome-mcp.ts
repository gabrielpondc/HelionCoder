export type PermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan'

export type Logger = {
  silly: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export type ClaudeForChromeContext = {
  serverName: string
  logger?: Logger
  socketPath?: string
  getSocketPaths?: () => string[]
  clientTypeId?: string
  initialPermissionMode?: PermissionMode
} & Record<string, unknown>

export const BROWSER_TOOLS: Array<{ name: string }> = []

export function createClaudeForChromeMcpServer(
  _context: ClaudeForChromeContext,
) {
  return {
    async connect(_transport: unknown): Promise<void> {},
    setRequestHandler(_schema: unknown, _handler: unknown): void {},
  }
}
