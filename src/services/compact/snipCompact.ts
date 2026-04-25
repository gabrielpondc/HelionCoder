import type { Message, SystemMessage } from '../../types/message.js'

export function isSnipRuntimeEnabled(): boolean {
  return false
}

export function shouldNudgeForSnips(_messages: Message[]): boolean {
  return false
}

export function isSnipMarkerMessage(_message: Message): boolean {
  return false
}

export function snipCompactIfNeeded(
  messages: Message[],
  _options?: { force?: boolean },
): {
  messages: Message[]
  tokensFreed: number
  boundaryMessage: SystemMessage | null
  executed: boolean
} {
  return {
    messages,
    tokensFreed: 0,
    boundaryMessage: null,
    executed: false,
  }
}
