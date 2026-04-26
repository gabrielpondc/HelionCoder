import React, { useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { saveApiKey } from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_ENDPOINT_MODE,
  fetchOpenAIModels,
  getPrimaryOpenAIConfig,
  type OpenAIEndpointMode,
} from '../utils/openaiConfig.js'
import { CLI_NAME, PRODUCT_NAME } from '../utils/brand.js'
import { Select } from './CustomSelect/select.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
}

type SaveState = 'editing' | 'saving' | 'error'
type FlowStage =
  | 'primary-api-key'
  | 'primary-base-url'
  | 'primary-model-loading'
  | 'primary-model-select'
  | 'primary-model-input'
  | 'endpoint-mode-select'
  | 'multimodal-choice'
  | 'mm-api-key'
  | 'mm-base-url'
  | 'mm-model-loading'
  | 'mm-model-select'
  | 'mm-model-input'

type TextField = {
  title: string
  description: string
  helper?: string
  placeholder: string
  value: string
  onChange(value: string): void
  mask?: string
}

type ParsedApiInput = {
  apiKey: string
  baseUrl?: string
}

const CUSTOM_MODEL_VALUE = '__custom_model__'

function validateOptionalUrl(value: string, label: string): void {
  if (!value) {
    return
  }

  try {
    new URL(value)
  } catch {
    throw new Error(`${label} 必须是合法 URL。`)
  }
}

function toModelValue(id: string): string {
  return `model:${encodeURIComponent(id)}`
}

function fromModelValue(value: string): string {
  return decodeURIComponent(value.slice('model:'.length))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstStringField(
  value: Record<string, unknown>,
  ...fields: string[]
): string | undefined {
  for (const field of fields) {
    const candidate = value[field]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function parseApiInput(value: string): ParsedApiInput {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) {
    return { apiKey: trimmed }
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { apiKey: trimmed }
    }

    const record = parsed as Record<string, unknown>
    const apiKey = firstStringField(record, 'key', 'apiKey', 'api_key', 'token')
    const baseUrl = firstStringField(record, 'url', 'baseUrl', 'base_url')
    return apiKey ? { apiKey, baseUrl } : { apiKey: trimmed }
  } catch {
    return { apiKey: trimmed }
  }
}

function buildModelOptions(models: string[], currentModel: string) {
  const normalizedCurrent = currentModel.trim().toLowerCase()
  const options = []

  if (
    currentModel.trim() &&
    !models.some(model => model.trim().toLowerCase() === normalizedCurrent)
  ) {
    options.push({
      label: `使用当前模型：${currentModel}`,
      value: toModelValue(currentModel),
      description: '来自已有配置或默认值',
    })
  }

  for (const model of models) {
    options.push({
      label: model,
      value: toModelValue(model),
      description: '从 /v1/models 读取',
    })
  }

  options.push({
    label: '手动输入模型 ID',
    value: CUSTOM_MODEL_VALUE,
    description: '接口未列出模型或需要自定义别名时使用',
  })

  return options
}

function isEasterEgg(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'helion' || normalized === 'helioncoder' || value.trim() === '顾家楷'
}

export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
}: Props): React.ReactNode {
  const storedConfig = getGlobalConfig()
  const primaryConfig = getPrimaryOpenAIConfig()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(storedConfig.openaiBaseUrl ?? '')
  const [primaryModel, setPrimaryModel] = useState(
    storedConfig.openaiModel ?? primaryConfig.model,
  )
  const [endpointMode, setEndpointMode] = useState<OpenAIEndpointMode>(
    storedConfig.openaiEndpointMode ??
      primaryConfig.endpointMode ??
      DEFAULT_OPENAI_ENDPOINT_MODE,
  )
  const [multimodalApiKey, setMultimodalApiKey] = useState('')
  const [multimodalBaseUrl, setMultimodalBaseUrl] = useState(
    storedConfig.openaiMultimodalBaseUrl ?? '',
  )
  const [multimodalModel, setMultimodalModel] = useState(
    storedConfig.openaiMultimodalModel ?? primaryModel,
  )
  const [primaryModelOptions, setPrimaryModelOptions] = useState<string[]>([])
  const [multimodalModelOptions, setMultimodalModelOptions] = useState<string[]>(
    [],
  )
  const [stage, setStage] = useState<FlowStage>('primary-api-key')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('editing')
  const [error, setError] = useState<string | null>(null)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const [showEasterEgg, setShowEasterEgg] = useState(false)
  const terminalColumns = useTerminalSize().columns
  const hasConfiguredKey = Boolean(primaryConfig.apiKey)
  const hasSeparateMultimodalKey = Boolean(
    process.env.OPENAI_MM_API_KEY?.trim() ||
      process.env.OPENAI_MULTIMODAL_API_KEY?.trim() ||
      storedConfig.openaiMultimodalApiKey?.trim(),
  )
  const hasEnvOverride = Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.OPENAI_BASE_URL ||
      process.env.OPENAI_MODEL ||
      process.env.OPENAI_MM_API_KEY ||
      process.env.OPENAI_MULTIMODAL_API_KEY ||
      process.env.OPENAI_MM_BASE_URL ||
      process.env.OPENAI_MULTIMODAL_BASE_URL ||
      process.env.OPENAI_MM_MODEL ||
      process.env.OPENAI_MULTIMODAL_MODEL ||
      process.env.OPENAI_ENDPOINT_MODE ||
      process.env.OPENAI_API_MODE,
  )

  useKeybinding(
    'confirm:yes',
    () => {
      if (mode === 'setup-token') {
        onDone()
      }
    },
    {
      context: '确认',
      isActive: mode === 'setup-token',
    },
  )

  const getEffectivePrimaryKey = (): string =>
    apiKey.trim() || primaryConfig.apiKey || ''
  const getEffectivePrimaryBaseUrl = (): string =>
    baseUrl.trim() || primaryConfig.baseUrl || DEFAULT_OPENAI_BASE_URL
  const getEffectiveMultimodalKey = (): string =>
    multimodalApiKey.trim() ||
    storedConfig.openaiMultimodalApiKey?.trim() ||
    getEffectivePrimaryKey()
  const getEffectiveMultimodalBaseUrl = (): string =>
    multimodalBaseUrl.trim() || getEffectivePrimaryBaseUrl()

  const resetInlineErrors = (): void => {
    setSaveState('editing')
    setError(null)
    setModelLoadError(null)
  }

  const loadModels = async (
    scope: 'primary' | 'multimodal',
    overrides: { apiKey?: string; baseUrl?: string } = {},
  ): Promise<void> => {
    const nextStage =
      scope === 'primary' ? 'primary-model-select' : 'mm-model-select'
    setStage(scope === 'primary' ? 'primary-model-loading' : 'mm-model-loading')
    setModelLoadError(null)

    try {
      const models = await fetchOpenAIModels({
        apiKey:
          overrides.apiKey ??
          (scope === 'primary'
            ? getEffectivePrimaryKey()
            : getEffectiveMultimodalKey()),
        baseUrl:
          overrides.baseUrl ??
          (scope === 'primary'
            ? getEffectivePrimaryBaseUrl()
            : getEffectiveMultimodalBaseUrl()),
      })
      if (scope === 'primary') {
        setPrimaryModelOptions(models)
      } else {
        setMultimodalModelOptions(models)
      }
      if (models.length === 0) {
        setModelLoadError('接口没有返回模型列表，可以手动输入模型 ID。')
      }
    } catch (err) {
      logError(err)
      if (scope === 'primary') {
        setPrimaryModelOptions([])
      } else {
        setMultimodalModelOptions([])
      }
      setModelLoadError(`${getErrorMessage(err)} 可以手动输入模型 ID 继续。`)
    } finally {
      setStage(nextStage)
    }
  }

  const persistConfiguration = async ({
    useSeparateMultimodal,
    finalPrimaryModel = primaryModel,
    finalMultimodalModel = multimodalModel,
  }: {
    useSeparateMultimodal: boolean
    finalPrimaryModel?: string
    finalMultimodalModel?: string
  }): Promise<void> => {
    const trimmedApiKey = apiKey.trim()
    const trimmedBaseUrl = baseUrl.trim()
    const trimmedMultimodalApiKey = multimodalApiKey.trim()
    const trimmedMultimodalBaseUrl = multimodalBaseUrl.trim()
    const trimmedPrimaryModel = finalPrimaryModel.trim()
    const trimmedMultimodalModel = finalMultimodalModel.trim()

    if (!trimmedApiKey && !hasConfiguredKey) {
      throw new Error('请先输入 OpenAI 兼容 API Key。')
    }
    if (!trimmedPrimaryModel) {
      throw new Error('请先选择或输入默认模型。')
    }
    if (useSeparateMultimodal && !trimmedMultimodalModel) {
      throw new Error('请先选择或输入多模态模型。')
    }

    validateOptionalUrl(trimmedBaseUrl, '主 Base URL')
    validateOptionalUrl(trimmedMultimodalBaseUrl, '多模态 Base URL')

    if (trimmedApiKey) {
      await saveApiKey(trimmedApiKey)
    }

    saveGlobalConfig(current => ({
      ...current,
      openaiBaseUrl: trimmedBaseUrl || undefined,
      openaiModel: trimmedPrimaryModel,
      openaiEndpointMode: endpointMode,
      openaiModelOptionsCache:
        primaryModelOptions.length > 0
          ? primaryModelOptions
          : current.openaiModelOptionsCache,
      openaiModelOptionsCacheBaseUrl:
        primaryModelOptions.length > 0
          ? trimmedBaseUrl || DEFAULT_OPENAI_BASE_URL
          : current.openaiModelOptionsCacheBaseUrl,
      openaiModelOptionsCacheUpdatedAt:
        primaryModelOptions.length > 0
          ? Date.now()
          : current.openaiModelOptionsCacheUpdatedAt,
      openaiMultimodalApiKey: useSeparateMultimodal
        ? trimmedMultimodalApiKey || current.openaiMultimodalApiKey
        : undefined,
      openaiMultimodalBaseUrl: useSeparateMultimodal
        ? trimmedMultimodalBaseUrl || undefined
        : undefined,
      openaiMultimodalModel: useSeparateMultimodal
        ? trimmedMultimodalModel
        : undefined,
    }))
  }

  const saveAndFinish = async (
    useSeparateMultimodal: boolean,
    finalMultimodalModel = multimodalModel,
  ): Promise<void> => {
    try {
      setSaveState('saving')
      setError(null)
      await persistConfiguration({
        useSeparateMultimodal,
        finalMultimodalModel,
      })
      onDone()
    } catch (err) {
      logError(err)
      setSaveState('error')
      setError(getErrorMessage(err))
    }
  }

  const getCurrentTextField = (): TextField | null => {
    switch (stage) {
      case 'primary-api-key':
        return {
          title: '主 API Key',
          description: hasConfiguredKey
            ? '已保存主 API Key。直接回车保留，或粘贴新 Key 替换。'
            : '请输入 OpenAI 兼容接口的 API Key。',
          helper: `之后可通过 /api-config、/login 或 \`${CLI_NAME} api-config\` 重新配置。`,
          placeholder: 'sk-...',
          value: apiKey,
          onChange: setApiKey,
          mask: '*',
        }
      case 'primary-base-url':
        return {
          title: '主 Base URL',
          description:
            '请输入服务地址。可以填根地址或 /v1，HelionCoder 会读取 /v1/models。',
          helper: '留空则使用默认 OpenAI 地址；如果当前有保存值，清空后回车会移除它。',
          placeholder: DEFAULT_OPENAI_BASE_URL,
          value: baseUrl,
          onChange: setBaseUrl,
        }
      case 'primary-model-input':
        return {
          title: '默认模型',
          description: '请输入默认模型 ID。',
          placeholder: primaryModel || 'gpt-5.4',
          value: primaryModel,
          onChange: setPrimaryModel,
        }
      case 'mm-api-key':
        return {
          title: '多模态 API Key',
          description: hasSeparateMultimodalKey
            ? '已保存单独的多模态 API Key。直接回车保留，或粘贴新 Key 替换。'
            : '可选。留空会复用主 API Key。',
          helper: '只有图片、文档等多模态请求需要不同凭据时才填写。',
          placeholder: 'sk-...',
          value: multimodalApiKey,
          onChange: setMultimodalApiKey,
          mask: '*',
        }
      case 'mm-base-url':
        return {
          title: '多模态 Base URL',
          description:
            '可选。只有多模态请求需要不同端点时才填写；提交后会读取该端点的 /v1/models。',
          helper: '留空会复用主 Base URL。',
          placeholder: getEffectivePrimaryBaseUrl(),
          value: multimodalBaseUrl,
          onChange: setMultimodalBaseUrl,
        }
      case 'mm-model-input':
        return {
          title: '多模态模型',
          description: '请输入多模态模型 ID。',
          placeholder: multimodalModel || primaryModel,
          value: multimodalModel,
          onChange: setMultimodalModel,
        }
      default:
        return null
    }
  }

  const handleChange = (value: string): void => {
    getCurrentTextField()?.onChange(value)
    resetInlineErrors()
  }

  const handleSubmit = async (value: string): Promise<void> => {
    const trimmed = value.trim()

    if (isEasterEgg(trimmed)) {
      setShowEasterEgg(true)
      resetInlineErrors()
      return
    }

    try {
      switch (stage) {
        case 'primary-api-key':
          {
          const parsed = parseApiInput(trimmed)
          if (!parsed.apiKey && !hasConfiguredKey) {
            setSaveState('error')
            setError('请先输入 OpenAI 兼容 API Key。')
            return
          }
          setApiKey(parsed.apiKey)
          if (parsed.baseUrl) {
            setBaseUrl(parsed.baseUrl)
          }
          setStage('primary-base-url')
          break
          }
        case 'primary-base-url':
          validateOptionalUrl(trimmed, '主 Base URL')
          setBaseUrl(trimmed)
          await loadModels('primary', { baseUrl: trimmed || primaryConfig.baseUrl })
          break
        case 'primary-model-input':
          if (!trimmed) {
            setSaveState('error')
            setError('请先输入默认模型 ID。')
            return
          }
          setPrimaryModel(trimmed)
          setMultimodalModel(trimmed)
          setStage('endpoint-mode-select')
          break
        case 'mm-api-key':
          {
          const parsed = parseApiInput(trimmed)
          setMultimodalApiKey(parsed.apiKey)
          if (parsed.baseUrl) {
            setMultimodalBaseUrl(parsed.baseUrl)
          }
          setStage('mm-base-url')
          break
          }
        case 'mm-base-url':
          validateOptionalUrl(trimmed, '多模态 Base URL')
          setMultimodalBaseUrl(trimmed)
          await loadModels('multimodal', {
            apiKey:
              multimodalApiKey.trim() ||
              storedConfig.openaiMultimodalApiKey?.trim() ||
              getEffectivePrimaryKey(),
            baseUrl: trimmed || getEffectivePrimaryBaseUrl(),
          })
          break
        case 'mm-model-input':
          if (!trimmed) {
            setSaveState('error')
            setError('请先输入多模态模型 ID。')
            return
          }
          setMultimodalModel(trimmed)
          await saveAndFinish(true, trimmed)
          break
      }
    } catch (err) {
      logError(err)
      setSaveState('error')
      setError(getErrorMessage(err))
    } finally {
      setCursorOffset(0)
    }
  }

  const handlePrimaryModelChoice = (value: string): void => {
    resetInlineErrors()
    if (value === CUSTOM_MODEL_VALUE) {
      setStage('primary-model-input')
      return
    }

    const selectedModel = fromModelValue(value)
    setPrimaryModel(selectedModel)
    setMultimodalModel(selectedModel)
    setStage('endpoint-mode-select')
  }

  const handleEndpointModeChoice = (value: string): void => {
    resetInlineErrors()
    setEndpointMode(value as OpenAIEndpointMode)
    setStage('multimodal-choice')
  }

  const handleMultimodalChoice = (value: string): void => {
    resetInlineErrors()
    if (value === 'reuse') {
      setMultimodalModel(primaryModel)
      void saveAndFinish(false, primaryModel)
      return
    }

    setStage('mm-api-key')
  }

  const handleMultimodalModelChoice = (value: string): void => {
    resetInlineErrors()
    if (value === CUSTOM_MODEL_VALUE) {
      setStage('mm-model-input')
      return
    }

    const selectedModel = fromModelValue(value)
    setMultimodalModel(selectedModel)
    void saveAndFinish(true, selectedModel)
  }

  const textField = getCurrentTextField()

  if (mode === 'setup-token') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>旧 Token 配置已移除</Text>
        <Text dimColor>
          {PRODUCT_NAME} 现在只使用 OpenAI 兼容 API Key，不再使用长期登录 Token。
        </Text>
        <Text dimColor>
          可通过 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`
          或 /api-config 配置接口和模型。
        </Text>
        <Text dimColor>
          按 <Text bold>Enter</Text> 继续。
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {startingMessage ? <Text>{startingMessage}</Text> : null}
      <Text bold>{PRODUCT_NAME} API 配置</Text>
      <Text dimColor>
        当前使用 OpenAI 兼容接口。配置 Base URL 后会读取 /v1/models，并让你选择实际调用的接口模式。
      </Text>
      {hasEnvOverride ? (
        <Text dimColor>
          检测到 `OPENAI_*` 环境变量；环境变量会优先于已保存配置。
        </Text>
      ) : null}
      {showEasterEgg ? (
        <Text color="professionalBlue">彩蛋：{PRODUCT_NAME} 由顾家楷开发。</Text>
      ) : null}

      {textField ? (
        <>
          <Text dimColor>当前步骤：{textField.title}</Text>
          <Text dimColor>{textField.description}</Text>
          {textField.helper ? <Text dimColor>{textField.helper}</Text> : null}
          {saveState === 'saving' ? (
            <Box gap={1}>
              <Spinner />
              <Text>正在保存 API 配置…</Text>
            </Box>
          ) : (
            <TextInput
              value={textField.value}
              onChange={handleChange}
              onSubmit={handleSubmit}
              onPaste={handleChange}
              focus={true}
              mask={textField.mask}
              showCursor={true}
              placeholder={textField.placeholder}
              columns={terminalColumns}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          )}
        </>
      ) : null}

      {stage === 'primary-model-loading' || stage === 'mm-model-loading' ? (
        <Box gap={1}>
          <Spinner />
          <Text>正在读取 /v1/models…</Text>
        </Box>
      ) : null}

      {stage === 'primary-model-select' ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>请选择默认模型：</Text>
          {modelLoadError ? <Text color="warning">{modelLoadError}</Text> : null}
          <Select
            options={buildModelOptions(primaryModelOptions, primaryModel)}
            defaultValue={toModelValue(primaryModel)}
            onChange={handlePrimaryModelChoice}
            visibleOptionCount={8}
          />
        </Box>
      ) : null}

      {stage === 'endpoint-mode-select' ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>请选择接口类型：</Text>
          <Text dimColor>
            选择服务商实际兼容的协议。选错协议时可能会无响应或报接口错误。
          </Text>
          <Select
            options={[
              {
                label: 'OpenAI Chat Completions',
                value: 'chat-completions',
                description: '调用 /v1/chat/completions，多数中转服务使用这个协议',
              },
              {
                label: 'OpenAI Responses',
                value: 'responses',
                description: '调用 /v1/responses，适合官方 OpenAI 或明确支持 Responses 的服务商',
              },
              {
                label: 'Anthropic Messages',
                value: 'messages',
                description: '调用 /v1/messages，适合 Anthropic/Claude 兼容网关',
              },
            ]}
            defaultValue={endpointMode}
            onChange={handleEndpointModeChoice}
            visibleOptionCount={3}
          />
        </Box>
      ) : null}

      {stage === 'multimodal-choice' ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>是否单独配置多模态模型？</Text>
          <Text dimColor>
            如果你的默认模型本身已经支持图片或文档，建议复用主配置。
          </Text>
          {saveState === 'saving' ? (
            <Box gap={1}>
              <Spinner />
              <Text>正在保存 API 配置…</Text>
            </Box>
          ) : (
            <Select
              options={[
                {
                  label: '不单独配置，复用主模型',
                  value: 'reuse',
                  description: `多模态请求也使用 ${primaryModel}`,
                },
                {
                  label: '单独配置多模态',
                  value: 'separate',
                  description: '多模态请求使用不同 Key、端点或模型',
                },
              ]}
              defaultValue="reuse"
              onChange={handleMultimodalChoice}
              visibleOptionCount={2}
            />
          )}
        </Box>
      ) : null}

      {stage === 'mm-model-select' ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>请选择多模态模型：</Text>
          {modelLoadError ? <Text color="warning">{modelLoadError}</Text> : null}
          <Select
            options={buildModelOptions(multimodalModelOptions, multimodalModel)}
            defaultValue={toModelValue(multimodalModel)}
            onChange={handleMultimodalModelChoice}
            visibleOptionCount={8}
          />
        </Box>
      ) : null}

      {error ? <Text color="error">{error}</Text> : null}
    </Box>
  )
}
