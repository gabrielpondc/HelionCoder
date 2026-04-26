import { z } from 'zod'

export type FsReadRestrictionConfig = {
  denyOnly: string[]
  allowWithinDeny?: string[]
}

export type FsWriteRestrictionConfig = {
  allowOnly: string[]
  denyWithinAllow: string[]
}

export type IgnoreViolationsConfig = Record<string, unknown>

export type NetworkHostPattern = {
  host: string
  port?: number
  protocol?: string
}

export type NetworkRestrictionConfig = {
  allowedHosts?: string[]
  deniedHosts?: string[]
}

export type SandboxAskCallback = (
  hostPattern: NetworkHostPattern,
) => boolean | Promise<boolean>

export type SandboxDependencyCheck = {
  errors: string[]
  warnings: string[]
}

export type SandboxRuntimeConfig = {
  filesystem?: {
    read?: FsReadRestrictionConfig
    write?: FsWriteRestrictionConfig
  }
  network?: NetworkRestrictionConfig
  allowUnixSockets?: string[]
  allowLocalBinding?: boolean
  ignoreViolations?: IgnoreViolationsConfig
  enableWeakerNestedSandbox?: boolean
  proxyPort?: number
  socksProxyPort?: number
  linuxHttpSocketPath?: string
  linuxSocksSocketPath?: string
} & Record<string, unknown>

export type SandboxViolationEvent = {
  timestamp: Date
  line: string
  command?: string
}

export const SandboxRuntimeConfigSchema = z.object({}).passthrough()

const UNAVAILABLE_ERROR =
  '@anthropic-ai/sandbox-runtime is unavailable in this Helioncoder build'

const EMPTY_READ_CONFIG: FsReadRestrictionConfig = {
  denyOnly: [],
  allowWithinDeny: [],
}

const EMPTY_WRITE_CONFIG: FsWriteRestrictionConfig = {
  allowOnly: [],
  denyWithinAllow: [],
}

const EMPTY_NETWORK_CONFIG: NetworkRestrictionConfig = {
  allowedHosts: [],
  deniedHosts: [],
}

export class SandboxViolationStore {
  #violations: SandboxViolationEvent[] = []
  #listeners = new Set<(violations: SandboxViolationEvent[]) => void>()

  subscribe(listener: (violations: SandboxViolationEvent[]) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#violations)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getTotalCount(): number {
    return this.#violations.length
  }

  add(violation: SandboxViolationEvent): void {
    this.#violations = [...this.#violations, violation]
    for (const listener of this.#listeners) {
      listener(this.#violations)
    }
  }

  clear(): void {
    this.#violations = []
    for (const listener of this.#listeners) {
      listener(this.#violations)
    }
  }
}

const violationStore = new SandboxViolationStore()

let currentConfig: SandboxRuntimeConfig = {}

export class SandboxManager {
  static checkDependencies(): SandboxDependencyCheck {
    return {
      errors: [UNAVAILABLE_ERROR],
      warnings: [],
    }
  }

  static isSupportedPlatform(): boolean {
    return process.platform === 'darwin' || process.platform === 'linux'
  }

  static async initialize(
    config: SandboxRuntimeConfig,
    _sandboxAskCallback?: SandboxAskCallback,
  ): Promise<void> {
    currentConfig = config
  }

  static updateConfig(config: SandboxRuntimeConfig): void {
    currentConfig = config
  }

  static async reset(): Promise<void> {
    currentConfig = {}
    violationStore.clear()
  }

  static getFsReadConfig(): FsReadRestrictionConfig {
    return currentConfig.filesystem?.read ?? EMPTY_READ_CONFIG
  }

  static getFsWriteConfig(): FsWriteRestrictionConfig {
    return currentConfig.filesystem?.write ?? EMPTY_WRITE_CONFIG
  }

  static getNetworkRestrictionConfig(): NetworkRestrictionConfig {
    return currentConfig.network ?? EMPTY_NETWORK_CONFIG
  }

  static getIgnoreViolations(): IgnoreViolationsConfig | undefined {
    return currentConfig.ignoreViolations
  }

  static getAllowUnixSockets(): string[] | undefined {
    return currentConfig.allowUnixSockets
  }

  static getAllowLocalBinding(): boolean | undefined {
    return currentConfig.allowLocalBinding
  }

  static getEnableWeakerNestedSandbox(): boolean | undefined {
    return currentConfig.enableWeakerNestedSandbox
  }

  static getProxyPort(): number | undefined {
    return currentConfig.proxyPort
  }

  static getSocksProxyPort(): number | undefined {
    return currentConfig.socksProxyPort
  }

  static getLinuxHttpSocketPath(): string | undefined {
    return currentConfig.linuxHttpSocketPath
  }

  static getLinuxSocksSocketPath(): string | undefined {
    return currentConfig.linuxSocksSocketPath
  }

  static async waitForNetworkInitialization(): Promise<boolean> {
    return false
  }

  static async wrapWithSandbox(
    command: string,
    _binShell?: string,
    _customConfig?: Partial<SandboxRuntimeConfig>,
    _abortSignal?: AbortSignal,
  ): Promise<string> {
    return command
  }

  static getSandboxViolationStore(): SandboxViolationStore {
    return violationStore
  }

  static annotateStderrWithSandboxFailures(
    _command: string,
    stderr: string,
  ): string {
    return stderr
  }

  static cleanupAfterCommand(): void {}
}
