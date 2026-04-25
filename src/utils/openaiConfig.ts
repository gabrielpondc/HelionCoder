import { getGlobalConfig } from './config.js'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4'
export const DEFAULT_OPENAI_SMALL_MODEL = 'gpt-5.4-mini'
const DEFAULT_MODEL_LIST_TIMEOUT_MS = 8000

type EndpointConfig = {
  apiKey: string | null
  baseUrl: string
  model: string
}

type FetchOpenAIModelsOptions = {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

export function getPrimaryOpenAIConfig(): EndpointConfig {
  const config = getGlobalConfig()
  return {
    apiKey:
      firstNonEmpty(
        process.env.OPENAI_API_KEY,
        config.openaiApiKey,
        config.primaryApiKey,
        process.env.ANTHROPIC_API_KEY,
      ) ?? null,
    baseUrl:
      firstNonEmpty(
        process.env.OPENAI_BASE_URL,
        config.openaiBaseUrl,
        process.env.ANTHROPIC_BASE_URL,
      ) ?? DEFAULT_OPENAI_BASE_URL,
    model:
      firstNonEmpty(
        process.env.OPENAI_MODEL,
        config.openaiModel,
        process.env.ANTHROPIC_MODEL,
      ) ?? DEFAULT_OPENAI_MODEL,
  }
}

export function getMultimodalOpenAIConfig(): EndpointConfig {
  const config = getGlobalConfig()
  const primary = getPrimaryOpenAIConfig()
  return {
    apiKey:
      firstNonEmpty(
        process.env.OPENAI_MM_API_KEY,
        process.env.OPENAI_MULTIMODAL_API_KEY,
        config.openaiMultimodalApiKey,
        primary.apiKey,
      ) ?? null,
    baseUrl:
      firstNonEmpty(
        process.env.OPENAI_MM_BASE_URL,
        process.env.OPENAI_MULTIMODAL_BASE_URL,
        config.openaiMultimodalBaseUrl,
        primary.baseUrl,
      ) ?? DEFAULT_OPENAI_BASE_URL,
    model:
      firstNonEmpty(
        process.env.OPENAI_MM_MODEL,
        process.env.OPENAI_MULTIMODAL_MODEL,
        config.openaiMultimodalModel,
        primary.model,
      ) ?? DEFAULT_OPENAI_MODEL,
  }
}

export function hasOpenAIKeyConfigured(): boolean {
  return getPrimaryOpenAIConfig().apiKey !== null
}

export function hasExplicitOpenAICompatibleConfig(): boolean {
  const config = getGlobalConfig()
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      process.env.OPENAI_BASE_URL?.trim() ||
      config.openaiApiKey?.trim() ||
      config.openaiBaseUrl?.trim(),
  )
}

export function getOpenAIModelOverride(): string | undefined {
  return firstNonEmpty(process.env.OPENAI_MODEL, getGlobalConfig().openaiModel)
}

export function getOpenAISmallModelOverride(): string | undefined {
  return firstNonEmpty(
    process.env.OPENAI_SMALL_MODEL,
    getGlobalConfig().openaiSmallModel,
  )
}

export function getOpenAIMultimodalModelOverride(): string | undefined {
  return firstNonEmpty(
    process.env.OPENAI_MM_MODEL,
    process.env.OPENAI_MULTIMODAL_MODEL,
    getGlobalConfig().openaiMultimodalModel,
  )
}

export function hasMediaContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (Array.isArray(value)) {
    return value.some(item => hasMediaContent(item))
  }

  const candidate = value as {
    type?: string
    content?: unknown
    source?: { type?: string }
  }

  if (candidate.type === 'image' || candidate.type === 'document') {
    return true
  }

  return hasMediaContent(candidate.content)
}

export function resolveApiBaseUrl(baseUrl: string, resource: string): string {
  const parsed = new URL(baseUrl)
  let currentPath = parsed.pathname.replace(/\/+$/, '')

  const replaceableSuffixes = [
    '/responses',
    '/models',
    '/chat/completions',
    '/completions',
  ]

  for (const suffix of replaceableSuffixes) {
    if (currentPath.endsWith(suffix)) {
      currentPath = currentPath.slice(0, -suffix.length)
      break
    }
  }

  if (currentPath.endsWith(`/${resource}`)) {
    return parsed.toString()
  }
  if (currentPath.endsWith('/v1')) {
    parsed.pathname = `${currentPath}/${resource}`
    return parsed.toString()
  }
  parsed.pathname = `${currentPath || ''}/v1/${resource}`.replace(/\/{2,}/g, '/')
  return parsed.toString()
}

export function resolveAnthropicCompatibleBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl)
  let currentPath = parsed.pathname.replace(/\/+$/, '')
  const sdkSuffixes = [
    '/v1/messages/count_tokens',
    '/v1/messages',
    '/v1/chat/completions',
    '/v1/responses',
    '/v1/models',
    '/v1',
  ]

  for (const suffix of sdkSuffixes) {
    if (currentPath.endsWith(suffix)) {
      currentPath = currentPath.slice(0, -suffix.length)
      break
    }
  }

  parsed.pathname = currentPath || '/'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export async function fetchOpenAIModels({
  apiKey,
  baseUrl = DEFAULT_OPENAI_BASE_URL,
  timeoutMs = DEFAULT_MODEL_LIST_TIMEOUT_MS,
}: FetchOpenAIModelsOptions): Promise<string[]> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    throw new Error('请先填写 API Key，才能读取模型列表。')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(resolveApiBaseUrl(baseUrl, 'models'), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${trimmedKey}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = response.status === 401 ? '，请检查 API Key 是否正确' : ''
      throw new Error(`读取模型列表失败：HTTP ${response.status}${detail}`)
    }

    const payload = (await response.json()) as unknown
    return parseModelIds(payload)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('读取模型列表超时，请检查 Base URL 或网络连接。')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function parseModelIds(payload: unknown): string[] {
  const rawItems =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload

  if (!Array.isArray(rawItems)) {
    return []
  }

  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of rawItems) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'id' in item
          ? (item as { id?: unknown }).id
          : item && typeof item === 'object' && 'name' in item
            ? (item as { name?: unknown }).name
            : undefined

    if (typeof id !== 'string') {
      continue
    }

    const trimmed = id.trim()
    const dedupeKey = trimmed.toLowerCase()
    if (!trimmed || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    ids.push(trimmed)
  }

  return ids
}
