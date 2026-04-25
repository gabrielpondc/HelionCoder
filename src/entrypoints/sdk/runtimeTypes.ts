export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type SDKMessage = Record<string, unknown>
export type SDKAssistantMessage = Record<string, unknown>
export type SDKAssistantMessageError = Record<string, unknown>
export type SDKResultMessage = Record<string, unknown>
export type SDKSessionInfo = Record<string, unknown>
export type SDKUserMessage = Record<string, unknown>
export type SDKStatus = string
export type ModelUsage = Record<string, unknown>
export type ExitReason = string
export type HookEvent = string
export type HookInput = Record<string, unknown>
export type HookJSONOutput = Record<string, unknown>

export type AnyZodRawShape = Record<string, unknown>
export type InferShape<T> = T extends Record<string, unknown>
  ? Record<string, unknown>
  : Record<string, unknown>
export type SdkMcpToolDefinition<T = unknown> = T & Record<string, unknown>
export type McpSdkServerConfigWithInstance = Record<string, unknown>
export type InternalOptions = Record<string, unknown>
export type InternalQuery = Record<string, unknown>
export type Options = Record<string, unknown>
export type Query = Record<string, unknown>
export type SDKSession = Record<string, unknown>
export type SDKSessionOptions = Record<string, unknown>
export type SessionMessage = Record<string, unknown>
export type SessionMutationOptions = Record<string, unknown>
export type GetSessionMessagesOptions = Record<string, unknown>
export type ListSessionsOptions = Record<string, unknown>
export type GetSessionInfoOptions = Record<string, unknown>
export type ForkSessionOptions = Record<string, unknown>
export type ForkSessionResult = Record<string, unknown>
