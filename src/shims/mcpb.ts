import { z } from 'zod/v4'

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as <T = unknown>(specifier: string) => Promise<T>

const fallbackManifestSchema = z
  .object({
    name: z.string().default('Unknown Extension'),
    author: z
      .object({
        name: z.string().default('Unknown Author'),
      })
      .default({ name: 'Unknown Author' }),
    server: z
      .object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough()

export type McpbManifest = z.infer<typeof fallbackManifestSchema>

export type McpbUserConfigurationOption = {
  title?: string
  description?: string
  type?: string
  required?: boolean
  default?: unknown
  enum?: unknown[]
  min?: number
  max?: number
}

export async function getMcpbManifestSchema() {
  try {
    const mod = await dynamicImport<{
      McpbManifestSchema?: typeof fallbackManifestSchema
    }>('@anthropic-ai/mcpb')
    return mod.McpbManifestSchema ?? fallbackManifestSchema
  } catch {
    return fallbackManifestSchema
  }
}

export async function getMcpConfigForManifest(args: {
  manifest: McpbManifest
  extensionPath: string
  userConfig?: Record<string, unknown>
  systemDirs?: Record<string, string>
  pathSeparator?: string
}) {
  try {
    const mod = await dynamicImport<{
      getMcpConfigForManifest?: (
        input: typeof args,
      ) => Promise<Record<string, unknown> | null>
    }>('@anthropic-ai/mcpb')
    if (typeof mod.getMcpConfigForManifest === 'function') {
      return await mod.getMcpConfigForManifest(args)
    }
  } catch {
    // Fall back to a minimal stdio config below.
  }

  const server = args.manifest.server
  if (server?.command) {
    return {
      type: 'stdio',
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    }
  }

  return {
    type: 'stdio',
    command: 'node',
    args: [args.extensionPath],
  }
}
