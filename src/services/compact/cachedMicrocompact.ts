export type CacheEditsBlock = {
  type: 'cache_edits'
  toolsToDelete: string[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  pinnedEdits: PinnedCacheEdits[]
}

export function createCachedMCState(): CachedMCState {
  return { pinnedEdits: [] }
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(state: CachedMCState): void {
  state.pinnedEdits.length = 0
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  toolsToDelete: string[],
): CacheEditsBlock | null {
  if (toolsToDelete.length === 0) {
    return null
  }

  return {
    type: 'cache_edits',
    toolsToDelete,
  }
}
