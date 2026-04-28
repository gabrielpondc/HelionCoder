import { randomUUID } from 'crypto'
import {
  resolveApiBaseUrl,
  type OpenAIEndpointMode,
} from '../../utils/openaiConfig.js'

type AdapterOptions = {
  baseUrl: string
  endpointMode: OpenAIEndpointMode
}

type AnthropicBlock = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  source?: {
    type?: string
    media_type?: string
    data?: string
    url?: string
  }
}

type ToolCallAccumulator = {
  id?: string
  callId?: string
  name?: string
  arguments: string
}

type ChatTextPart = {
  type: 'text'
  text: string
}

type ChatImagePart = {
  type: 'image_url'
  image_url: {
    url: string
  }
}

type ChatContentPart = ChatTextPart | ChatImagePart

type ResponsesTextPart = {
  type: 'input_text'
  text: string
}

type ResponsesImagePart = {
  type: 'input_image'
  image_url: string
}

type ResponsesContentPart = ResponsesTextPart | ResponsesImagePart

type ToolChoice = {
  type?: string
  name?: string
  disable_parallel_tool_use?: boolean
}

type OutputFormat = {
  type?: string
  name?: string
  description?: string
  schema?: unknown
  strict?: boolean
}

function isMessagesRequest(input: RequestInfo | URL): boolean {
  const url = input instanceof Request ? input.url : String(input)
  try {
    const parsed = new URL(url)
    return parsed.pathname.replace(/\/+$/, '').endsWith('/messages')
  } catch {
    return false
  }
}

async function readJsonBody(input: RequestInfo | URL, init?: RequestInit) {
  const raw =
    typeof init?.body === 'string'
      ? init.body
      : input instanceof Request
        ? await input.clone().text()
        : ''
  return raw ? JSON.parse(raw) : {}
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return {
      error: {
        message: raw,
        type: 'api_error',
      },
    }
  }
}

function imageUrlFromBlock(block: AnthropicBlock): string | undefined {
  if (block.type !== 'image') {
    return undefined
  }
  if (block.source?.type === 'base64' && block.source.data) {
    const mediaType = block.source.media_type ?? 'image/png'
    return `data:${mediaType};base64,${block.source.data}`
  }
  return block.source?.url
}

function hasChatMedia(parts: ChatContentPart[]): boolean {
  return parts.some(part => part.type === 'image_url')
}

function chatContentFromParts(parts: ChatContentPart[]): string | ChatContentPart[] {
  const filtered = parts.filter(
    part => part.type !== 'text' || part.text.length > 0,
  )
  if (!hasChatMedia(filtered)) {
    return filtered
      .map(part => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return filtered
}

function responsesContentFromChatParts(
  parts: ChatContentPart[],
): string | ResponsesContentPart[] {
  const filtered = parts.filter(
    part => part.type !== 'text' || part.text.length > 0,
  )
  if (!hasChatMedia(filtered)) {
    return filtered
      .map(part => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return filtered.map(part =>
    part.type === 'text'
      ? { type: 'input_text', text: part.text }
      : { type: 'input_image', image_url: part.image_url.url },
  )
}

function imagePartsFromContent(content: unknown): ChatImagePart[] {
  if (!Array.isArray(content)) {
    return []
  }
  return content.flatMap(block => {
    if (!block || typeof block !== 'object') {
      return []
    }
    const imageUrl = imageUrlFromBlock(block as AnthropicBlock)
    return imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl } }] : []
  })
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map(block =>
      block && typeof block === 'object' && (block as AnthropicBlock).type === 'text'
        ? ((block as AnthropicBlock).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('\n')
}

function textFromSystem(system: unknown): string | undefined {
  const text = textFromContent(system)
  if (text) {
    return text
  }
  return typeof system === 'string' && system.trim() ? system : undefined
}

function validOpenAIToolName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : undefined
}

function openAIToolCallName(call: any): string | undefined {
  return validOpenAIToolName(
    call?.function?.name ?? call?.name ?? call?.tool_name ?? call?.function_name,
  )
}

function openAIToolCallArguments(call: any): string {
  const value =
    call?.function?.arguments ?? call?.arguments ?? call?.args ?? call?.input
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '{}'
    }
  }
  return ''
}

function anthropicToolUseName(block: AnthropicBlock): string | undefined {
  return validOpenAIToolName(block.name)
}

function anthropicToolUseId(block: AnthropicBlock): string | undefined {
  return typeof block.id === 'string' && block.id.trim() ? block.id : undefined
}

function toOpenAIChatToolChoice(toolChoice: unknown): unknown | undefined {
  if (!toolChoice || typeof toolChoice !== 'object') {
    return undefined
  }

  const choice = toolChoice as ToolChoice
  if (choice.type === 'auto') {
    return 'auto'
  }
  if (choice.type === 'none') {
    return 'none'
  }
  if (choice.type === 'any') {
    return 'required'
  }
  const name = validOpenAIToolName(choice.name)
  if (choice.type === 'tool' && name) {
    return {
      type: 'function',
      function: { name },
    }
  }
  return undefined
}

function toOpenAIResponsesToolChoice(toolChoice: unknown): unknown | undefined {
  const chatToolChoice = toOpenAIChatToolChoice(toolChoice)
  if (
    chatToolChoice &&
    typeof chatToolChoice === 'object' &&
    'function' in chatToolChoice
  ) {
    const name = (chatToolChoice as { function?: { name?: string } }).function
      ?.name
    return name ? { type: 'function', name } : undefined
  }
  return chatToolChoice
}

function parallelToolCallsFromToolChoice(toolChoice: unknown): boolean | undefined {
  if (!toolChoice || typeof toolChoice !== 'object') {
    return undefined
  }

  return (toolChoice as ToolChoice).disable_parallel_tool_use === true
    ? false
    : undefined
}

function jsonSchemaFormatFromOutputConfig(outputConfig: unknown) {
  if (!outputConfig || typeof outputConfig !== 'object') {
    return undefined
  }
  const format = (outputConfig as { format?: unknown }).format
  if (!format || typeof format !== 'object') {
    return undefined
  }

  const outputFormat = format as OutputFormat
  if (outputFormat.type !== 'json_schema' || !outputFormat.schema) {
    return undefined
  }

  return {
    type: 'json_schema',
    name: outputFormat.name ?? 'response_schema',
    ...(outputFormat.description && { description: outputFormat.description }),
    schema: outputFormat.schema,
    ...(typeof outputFormat.strict === 'boolean' && {
      strict: outputFormat.strict,
    }),
  }
}

function chatResponseFormatFromOutputConfig(outputConfig: unknown) {
  const jsonSchema = jsonSchemaFormatFromOutputConfig(outputConfig)
  if (!jsonSchema) {
    return undefined
  }
  const { type: _type, ...chatJsonSchema } = jsonSchema
  return {
    type: 'json_schema',
    json_schema: chatJsonSchema,
  }
}

function reasoningFromOutputConfig(outputConfig: unknown) {
  if (!outputConfig || typeof outputConfig !== 'object') {
    return undefined
  }
  const effort = (outputConfig as { effort?: unknown }).effort
  if (typeof effort !== 'string') {
    return undefined
  }

  const openAIEffort = effort === 'max' ? 'xhigh' : effort
  if (
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(
      openAIEffort,
    )
  ) {
    return undefined
  }
  return { effort: openAIEffort }
}

function toChatMessages(
  messages: Array<{ role: string; content: unknown }>,
  options: { responses?: boolean } = {},
) {
  const result: unknown[] = []
  const pendingToolCallIds = new Set<string>()
  const pushPendingToolResults = () => {
    for (const id of pendingToolCallIds) {
      result.push({
        role: 'tool',
        tool_call_id: id,
        content: '[Tool result missing due to interrupted conversation state]',
      })
    }
    pendingToolCallIds.clear()
  }

  for (const message of messages) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      const contentParts: ChatContentPart[] = []
      const flushUserContent = () => {
        if (contentParts.length === 0) {
          return
        }
        if (!options.responses) {
          pushPendingToolResults()
        }
        result.push({
          role: 'user',
          content: options.responses
            ? responsesContentFromChatParts(contentParts)
            : chatContentFromParts(contentParts),
        })
        contentParts.length = 0
      }

      const blocks = message.content as AnthropicBlock[]
      const orderedBlocks = options.responses
        ? blocks
        : [
            ...blocks.filter(block => block.type === 'tool_result'),
            ...blocks.filter(block => block.type !== 'tool_result'),
          ]

      for (const block of orderedBlocks) {
        if (block.type === 'tool_result') {
          if (block.tool_use_id && pendingToolCallIds.has(block.tool_use_id)) {
            pendingToolCallIds.delete(block.tool_use_id)
            result.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: textFromContent(block.content),
            })
          } else {
            const orphanText = textFromContent(block.content)
            if (orphanText) {
              contentParts.push({
                type: 'text',
                text: `[Tool result without matching call]\n${orphanText}`,
              })
            }
          }
          const toolResultImages = imagePartsFromContent(block.content)
          if (toolResultImages.length > 0) {
            if (options.responses) {
              result.push({
                role: 'user',
                content: responsesContentFromChatParts(toolResultImages),
              })
            } else {
              contentParts.push(...toolResultImages)
            }
          }
        } else if (block.type === 'text') {
          contentParts.push({ type: 'text', text: block.text ?? '' })
        } else {
          const imageUrl = imageUrlFromBlock(block)
          if (imageUrl) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            })
          }
        }
      }
      flushUserContent()
      continue
    }

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      if (!options.responses) {
        pushPendingToolResults()
      }
      const toolCalls = (message.content as AnthropicBlock[])
        .filter(block => block.type === 'tool_use')
        .flatMap(block => {
          const id = anthropicToolUseId(block)
          const name = anthropicToolUseName(block)
          if (!id || !name) {
            return []
          }
          return [
            {
              id,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            },
          ]
        })
      const assistantText = textFromContent(message.content)
      result.push({
        role: 'assistant',
        content: assistantText || (toolCalls.length > 0 ? null : ''),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      })
      if (!options.responses) {
        for (const call of toolCalls) {
          if (call.id) {
            pendingToolCallIds.add(call.id)
          }
        }
      }
      continue
    }

    if (!options.responses) {
      pushPendingToolResults()
    }
    result.push({
      role: message.role,
      content: textFromContent(message.content),
    })
  }
  if (!options.responses) {
    pushPendingToolResults()
  }
  return result
}

function toResponsesInput(messages: Array<{ role: string; content: unknown }>) {
  const result: unknown[] = []
  const pendingFunctionCallIds = new Set<string>()
  const pushPendingFunctionOutputs = () => {
    for (const id of pendingFunctionCallIds) {
      result.push({
        type: 'function_call_output',
        call_id: id,
        output: '[Tool result missing due to interrupted conversation state]',
      })
    }
    pendingFunctionCallIds.clear()
  }

  for (const message of messages) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      const contentParts: ChatContentPart[] = []
      const flushUserContent = () => {
        if (contentParts.length === 0) {
          return
        }
        pushPendingFunctionOutputs()
        result.push({
          role: 'user',
          content: responsesContentFromChatParts(contentParts),
        })
        contentParts.length = 0
      }

      const blocks = message.content as AnthropicBlock[]
      const orderedBlocks = [
        ...blocks.filter(block => block.type === 'tool_result'),
        ...blocks.filter(block => block.type !== 'tool_result'),
      ]

      for (const block of orderedBlocks) {
        if (block.type === 'tool_result') {
          if (block.tool_use_id && pendingFunctionCallIds.has(block.tool_use_id)) {
            pendingFunctionCallIds.delete(block.tool_use_id)
            result.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output: textFromContent(block.content),
            })
          } else {
            const orphanText = textFromContent(block.content)
            if (orphanText) {
              contentParts.push({
                type: 'text',
                text: `[Tool result without matching call]\n${orphanText}`,
              })
            }
          }
          contentParts.push(...imagePartsFromContent(block.content))
        } else if (block.type === 'text') {
          contentParts.push({ type: 'text', text: block.text ?? '' })
        } else {
          const imageUrl = imageUrlFromBlock(block)
          if (imageUrl) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            })
          }
        }
      }
      flushUserContent()
      continue
    }

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      pushPendingFunctionOutputs()
      const text = textFromContent(message.content)
      if (text) {
        result.push({ role: 'assistant', content: text })
      }
      for (const block of message.content as AnthropicBlock[]) {
        const id = anthropicToolUseId(block)
        const name = anthropicToolUseName(block)
        if (block.type !== 'tool_use' || !id || !name) {
          continue
        }
        result.push({
          type: 'function_call',
          call_id: id,
          name,
          arguments: JSON.stringify(block.input ?? {}),
        })
        pendingFunctionCallIds.add(id)
      }
      continue
    }

    pushPendingFunctionOutputs()
    result.push({
      role: message.role,
      content: textFromContent(message.content),
    })
  }
  pushPendingFunctionOutputs()
  return result
}

function toChatTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }
  const converted = tools.flatMap(tool => {
    const t = tool as { name?: string; description?: string; input_schema?: unknown }
    const name = validOpenAIToolName(t.name)
    if (!name) {
      return []
    }
    return [
      {
        type: 'function',
        function: {
          name,
          description: t.description,
          parameters: t.input_schema ?? { type: 'object', properties: {} },
        },
      },
    ]
  })
  return converted.length > 0 ? converted : undefined
}

function toResponseTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }
  const converted = tools.flatMap(tool => {
    const t = tool as { name?: string; description?: string; input_schema?: unknown }
    const name = validOpenAIToolName(t.name)
    if (!name) {
      return []
    }
    return [
      {
        type: 'function',
        name,
        description: t.description,
        parameters: t.input_schema ?? { type: 'object', properties: {} },
      },
    ]
  })
  return converted.length > 0 ? converted : undefined
}

function toOpenAIRequest(body: Record<string, unknown>, mode: OpenAIEndpointMode) {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role: string; content: unknown }>)
    : []
  const system = textFromSystem(body.system)
  const maxTokens = body.max_tokens
  const parallelToolCalls = parallelToolCallsFromToolChoice(body.tool_choice)
  const stop =
    Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0
      ? body.stop_sequences
      : undefined
  const temperature =
    typeof body.temperature === 'number' && body.temperature !== 1
      ? body.temperature
      : undefined
  const topP = typeof body.top_p === 'number' ? body.top_p : undefined

  if (mode === 'chat-completions') {
    const toolChoice = toOpenAIChatToolChoice(body.tool_choice)
    const responseFormat = chatResponseFormatFromOutputConfig(body.output_config)
    return {
      model: body.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...toChatMessages(messages),
      ],
      stream: body.stream === true,
      ...(typeof maxTokens === 'number' && { max_tokens: maxTokens }),
      ...(toChatTools(body.tools) && { tools: toChatTools(body.tools) }),
      ...(toolChoice && { tool_choice: toolChoice }),
      ...(parallelToolCalls !== undefined && {
        parallel_tool_calls: parallelToolCalls,
      }),
      ...(stop && { stop }),
      ...(temperature !== undefined && { temperature }),
      ...(topP !== undefined && { top_p: topP }),
      ...(responseFormat && { response_format: responseFormat }),
    }
  }

  const input = toResponsesInput(messages)
  const toolChoice = toOpenAIResponsesToolChoice(body.tool_choice)
  const textFormat = jsonSchemaFormatFromOutputConfig(body.output_config)
  const reasoning = reasoningFromOutputConfig(body.output_config)
  return {
    model: body.model,
    input,
    ...(system && { instructions: system }),
    stream: body.stream === true,
    ...(typeof maxTokens === 'number' && { max_output_tokens: maxTokens }),
    ...(toResponseTools(body.tools) && { tools: toResponseTools(body.tools) }),
    ...(toolChoice && { tool_choice: toolChoice }),
    ...(parallelToolCalls !== undefined && {
      parallel_tool_calls: parallelToolCalls,
    }),
    ...(stop && { stop }),
    ...(temperature !== undefined && { temperature }),
    ...(topP !== undefined && { top_p: topP }),
    ...(textFormat && { text: { format: textFormat } }),
    ...(reasoning && { reasoning }),
  }
}

function extractResponseContent(payload: any): AnthropicBlock[] {
  if (Array.isArray(payload?.choices)) {
    const message = payload.choices[0]?.message ?? {}
    const blocks: AnthropicBlock[] = []
    if (message.content) {
      blocks.push({ type: 'text', text: String(message.content) })
    }
    for (const call of message.tool_calls ?? []) {
      const name = openAIToolCallName(call)
      if (!name) {
        continue
      }
      blocks.push({
        type: 'tool_use',
        id: call.id ?? `toolu_${randomUUID()}`,
        name,
        input: parseJsonObject(openAIToolCallArguments(call)),
      })
    }
    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }]
  }

  const blocks: AnthropicBlock[] = []
  for (const item of payload?.output ?? []) {
    if (item?.type === 'function_call') {
      const name = validOpenAIToolName(item.name)
      if (name) {
        blocks.push({
          type: 'tool_use',
          id: item.call_id ?? item.id ?? `toolu_${randomUUID()}`,
          name,
          input: parseJsonObject(item.arguments),
        })
      }
    }
    for (const part of item?.content ?? []) {
      if (part?.type === 'output_text') {
        blocks.push({ type: 'text', text: part.text ?? '' })
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: payload?.output_text ?? '' }]
}

function hasResponseToolCall(payload: any): boolean {
  return Array.isArray(payload?.output)
    ? payload.output.some((item: any) => item?.type === 'function_call')
    : false
}

function parseJsonObject(value: unknown): unknown {
  if (value && typeof value === 'object') {
    return value
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {}
  }
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function toAnthropicMessage(payload: any, model: string): Record<string, unknown> {
  const usage = payload?.usage ?? {}
  return {
    id: payload?.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: payload?.model ?? model,
    content: extractResponseContent(payload),
    stop_reason:
      payload?.choices?.[0]?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : hasResponseToolCall(payload)
        ? 'tool_use'
        : payload?.choices?.[0]?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn',
    usage: {
      input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
    },
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function toAnthropicSSE(message: Record<string, unknown>): string {
  const blocks = message.content as AnthropicBlock[]
  let output = sseEvent('message_start', {
    type: 'message_start',
    message: { ...message, content: [], usage: { input_tokens: 0, output_tokens: 0 } },
  })
  blocks.forEach((block, index) => {
    output += sseEvent('content_block_start', {
      type: 'content_block_start',
      index,
      content_block:
        block.type === 'tool_use'
          ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
          : { type: 'text', text: '' },
    })
    if (block.type === 'tool_use') {
      output += sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(block.input ?? {}),
        },
      })
    } else {
      output += sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text ?? '' },
      })
    }
    output += sseEvent('content_block_stop', {
      type: 'content_block_stop',
      index,
    })
  })
  output += sseEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason },
    usage: (message.usage as Record<string, unknown>) ?? { output_tokens: 0 },
  })
  output += sseEvent('message_stop', { type: 'message_stop' })
  return output
}

function copyResponseHeaders(response: Response, contentType: string): Headers {
  const headers = new Headers(response.headers)
  headers.set('content-type', contentType)
  headers.delete('content-length')
  return headers
}

function buildOpenAIHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.delete('content-length')
  headers.delete('Content-Length')
  headers.delete('x-api-key')
  headers.delete('X-Api-Key')
  headers.delete('anthropic-version')
  headers.delete('Anthropic-Version')
  headers.delete('anthropic-beta')
  headers.delete('Anthropic-Beta')
  headers.delete('anthropic-dangerous-direct-browser-access')
  headers.delete('Anthropic-Dangerous-Direct-Browser-Access')
  headers.set('content-type', 'application/json')
  return headers
}

function streamFromString(value: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(value))
      controller.close()
    },
  })
}

function decodeSSEChunks(
  source: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: any) => string | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = source.getReader()
  let buffer = ''

  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const trimmedStart = buffer.trimStart()
        const boundary = trimmedStart.startsWith('{')
          ? buffer.indexOf('\n')
          : buffer.indexOf('\n\n')
        if (boundary !== -1) {
          const raw = buffer.slice(0, boundary)
          buffer = buffer.slice(
            boundary + (trimmedStart.startsWith('{') ? 1 : 2),
          )
          const converted = convertRawSSEEvent(raw, onEvent)
          if (converted) {
            controller.enqueue(encoder.encode(converted))
            return
          }
          continue
        }

        const { done, value } = await reader.read()
        if (done) {
          const converted = buffer ? convertRawSSEEvent(buffer, onEvent) : undefined
          buffer = ''
          if (converted) {
            controller.enqueue(encoder.encode(converted))
            return
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
    },
  })
}

function convertRawSSEEvent(
  raw: string,
  onEvent: (event: string, data: any) => string | undefined,
): string | undefined {
  let event = 'message'
  const dataLines: string[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  const dataText = dataLines.length > 0 ? dataLines.join('\n') : raw.trim()
  if (!dataText || dataText === '[DONE]') {
    return undefined
  }
  try {
    return onEvent(event, JSON.parse(dataText))
  } catch {
    return undefined
  }
}

function createChatStreamAdapter(model: string) {
  let started = false
  let textBlockOpen = false
  let blockIndex = 0
  const toolCalls = new Map<number, ToolCallAccumulator>()
  const messageId = `msg_${randomUUID()}`

  return (_event: string, data: any): string | undefined => {
    let output = ''
    if (!started) {
      started = true
      output += sseEvent('message_start', {
        type: 'message_start',
        message: {
          id: data.id ?? messageId,
          type: 'message',
          role: 'assistant',
          model: data.model ?? model,
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })
    }

    const choice = data.choices?.[0]
    const delta = choice?.delta ?? {}
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (!textBlockOpen) {
        textBlockOpen = true
        output += sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text', text: '' },
        })
      }
      output += sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: delta.content },
      })
    }

    for (const call of delta.tool_calls ?? []) {
      const index = Number(call.index ?? 0)
      const current = toolCalls.get(index) ?? { arguments: '' }
      current.id = call.id ?? current.id
      current.name = openAIToolCallName(call) ?? current.name
      current.arguments += openAIToolCallArguments(call)
      toolCalls.set(index, current)
    }

    if (choice?.finish_reason) {
      if (textBlockOpen) {
        output += sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: blockIndex,
        })
        blockIndex += 1
        textBlockOpen = false
      }
      const validToolCalls = [...toolCalls.values()].filter(call =>
        validOpenAIToolName(call.name),
      )
      for (const call of validToolCalls) {
        output += sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: call.id ?? `toolu_${randomUUID()}`,
            name: validOpenAIToolName(call.name),
            input: {},
          },
        })
        output += sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: call.arguments || '{}',
          },
        })
        output += sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: blockIndex,
        })
        blockIndex += 1
      }
      output += sseEvent('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason:
            choice.finish_reason === 'tool_calls' && validToolCalls.length > 0
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn',
        },
        usage: {
          output_tokens: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0,
        },
      })
      output += sseEvent('message_stop', { type: 'message_stop' })
    }

    return output || undefined
  }
}

function createResponsesStreamAdapter(model: string) {
  let started = false
  let textBlockOpen = false
  let blockIndex = 0
  const messageId = `msg_${randomUUID()}`
  const toolCalls = new Map<number, ToolCallAccumulator>()

  return (event: string, data: any): string | undefined => {
    let output = ''
    const response = data.response
    if (!started && response) {
      started = true
      output += sseEvent('message_start', {
        type: 'message_start',
        message: {
          id: response.id ?? messageId,
          type: 'message',
          role: 'assistant',
          model: response.model ?? model,
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })
    }

    if (event === 'response.output_text.delta' && typeof data.delta === 'string') {
      if (!textBlockOpen) {
        textBlockOpen = true
        output += sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text', text: '' },
        })
      }
      output += sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: data.delta },
      })
    }

    if (event === 'response.output_item.added' && data.item?.type === 'function_call') {
      const index = Number(data.output_index ?? toolCalls.size)
      toolCalls.set(index, {
        id: data.item.id,
        callId: data.item.call_id,
        name: validOpenAIToolName(data.item.name),
        arguments: openAIToolCallArguments(data.item),
      })
    }

    if (event === 'response.output_item.done' && data.item?.type === 'function_call') {
      const index = Number(data.output_index ?? 0)
      const current = toolCalls.get(index) ?? { arguments: '' }
      current.id = data.item.id ?? current.id
      current.callId = data.item.call_id ?? current.callId
      current.name = validOpenAIToolName(data.item.name) ?? current.name
      current.arguments = openAIToolCallArguments(data.item) || current.arguments
      toolCalls.set(index, current)
    }

    if (
      event === 'response.function_call_arguments.delta' &&
      typeof data.delta === 'string'
    ) {
      const index = Number(data.output_index ?? 0)
      const current = toolCalls.get(index) ?? { arguments: '' }
      current.arguments += data.delta
      toolCalls.set(index, current)
    }

    if (event === 'response.function_call_arguments.done') {
      const index = Number(data.output_index ?? 0)
      const current = toolCalls.get(index) ?? { arguments: '' }
      current.arguments = data.arguments ?? current.arguments
      current.callId = data.call_id ?? current.callId
      current.name = validOpenAIToolName(data.name) ?? current.name
      toolCalls.set(index, current)
    }

    if (event === 'response.completed') {
      if (textBlockOpen) {
        output += sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: blockIndex,
        })
        blockIndex += 1
        textBlockOpen = false
      }
      const validToolCalls = [...toolCalls.values()].filter(call =>
        validOpenAIToolName(call.name),
      )
      for (const call of validToolCalls) {
        output += sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: call.callId ?? call.id ?? `toolu_${randomUUID()}`,
            name: validOpenAIToolName(call.name),
            input: {},
          },
        })
        output += sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: call.arguments || '{}',
          },
        })
        output += sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: blockIndex,
        })
        blockIndex += 1
      }
      output += sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: validToolCalls.length > 0 ? 'tool_use' : 'end_turn' },
        usage: {
          output_tokens: data.response?.usage?.output_tokens ?? 0,
        },
      })
      output += sseEvent('message_stop', { type: 'message_stop' })
    }

    return output || undefined
  }
}

export function maybeWrapOpenAIEndpointFetch(
  inner: typeof globalThis.fetch,
  options: AdapterOptions,
): typeof globalThis.fetch {
  if (options.endpointMode === 'messages') {
    return inner
  }

  return async (input, init) => {
    if (!isMessagesRequest(input)) {
      return inner(input, init)
    }

    const body = await readJsonBody(input, init)
    const endpoint =
      options.endpointMode === 'responses' ? 'responses' : 'chat/completions'
    const openAIRequest = toOpenAIRequest(body, options.endpointMode)
    const response = await inner(resolveApiBaseUrl(options.baseUrl, endpoint), {
      ...init,
      headers: buildOpenAIHeaders(init),
      body: JSON.stringify(openAIRequest),
    })
    if (body.stream === true) {
      if (!response.ok || !response.body) {
        const payload = await response.text()
        return new Response(payload, {
          status: response.status,
          statusText: response.statusText,
          headers: copyResponseHeaders(response, 'application/json'),
        })
      }
      const adapter =
        options.endpointMode === 'responses'
          ? createResponsesStreamAdapter(String(body.model ?? ''))
          : createChatStreamAdapter(String(body.model ?? ''))
      return new Response(decodeSSEChunks(response.body, adapter), {
        status: 200,
        headers: copyResponseHeaders(response, 'text/event-stream'),
      })
    }

    const payload = await readResponsePayload(response)
    if (!response.ok) {
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: copyResponseHeaders(response, 'application/json'),
      })
    }

    const message = toAnthropicMessage(payload, String(body.model ?? ''))
    if (body.stream === true) {
      return new Response(toAnthropicSSE(message), {
        status: 200,
        headers: copyResponseHeaders(response, 'text/event-stream'),
      })
    }
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: copyResponseHeaders(response, 'application/json'),
    })
  }
}
