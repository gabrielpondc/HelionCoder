import type { Message } from '../../types/message.js'

type ContextCollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: {
    totalErrors: number
    totalEmptySpawns: number
    totalSpawns: number
    emptySpawnWarningEmitted: boolean
    lastError: string | null
  }
}

const EMPTY_STATS: ContextCollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalErrors: 0,
    totalEmptySpawns: 0,
    totalSpawns: 0,
    emptySpawnWarningEmitted: false,
    lastError: null,
  },
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
): Promise<{ messages: Message[] }> {
  return { messages }
}

export function recoverFromOverflow(
  messages: Message[],
): { messages: Message[]; committed: number } {
  return { messages, committed: 0 }
}

export function isWithheldPromptTooLong(): boolean {
  return false
}

export function resetContextCollapse(): void {}

export function getStats(): ContextCollapseStats {
  return EMPTY_STATS
}

export function subscribe(_listener: () => void): () => void {
  return () => {}
}
