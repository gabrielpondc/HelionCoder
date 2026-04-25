import { feature } from 'bun:bundle'
import React, {
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { MailboxProvider } from '../context/mailbox.js'
import { useSettingsChange } from '../hooks/useSettingsChange.js'
import { logForDebugging } from '../utils/debug.js'
import {
  createDisabledBypassPermissionsContext,
  isBypassPermissionsModeDisabled,
} from '../utils/permissions/permissionSetup.js'
import { applySettingsChange } from '../utils/settings/applySettingsChange.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { createStore } from './store.js'

const VoiceProvider: (props: {
  children: React.ReactNode
}) => React.ReactNode = feature('VOICE_MODE')
  ? (require('../context/voice.js') as typeof import('../context/voice.js'))
      .VoiceProvider
  : ({ children }) => children

import {
  type AppState,
  type AppStateStore,
  getDefaultAppState,
} from './AppStateStore.js'

export {
  type AppState,
  type AppStateStore,
  type CompletionBoundary,
  getDefaultAppState,
  IDLE_SPECULATION_STATE,
  type SpeculationResult,
  type SpeculationState,
} from './AppStateStore.js'

export const AppStoreContext = React.createContext<AppStateStore | null>(null)

type Props = {
  children: React.ReactNode
  initialState?: AppState
  onChangeAppState?: (args: {
    newState: AppState
    oldState: AppState
  }) => void
}

const HasAppStateContext = React.createContext<boolean>(false)

export function AppStateProvider({
  children,
  initialState,
  onChangeAppState,
}: Props): React.ReactNode {
  const hasAppStateContext = useContext(HasAppStateContext)
  if (hasAppStateContext) {
    throw new Error(
      'AppStateProvider can not be nested within another AppStateProvider',
    )
  }

  const [store] = useState(() =>
    createStore<AppState>(
      initialState ?? getDefaultAppState(),
      onChangeAppState,
    ),
  )

  useEffect(() => {
    const { toolPermissionContext } = store.getState()
    if (
      toolPermissionContext.isBypassPermissionsModeAvailable &&
      isBypassPermissionsModeDisabled()
    ) {
      logForDebugging(
        'Disabling bypass permissions mode on mount (remote settings loaded before mount)',
      )
      store.setState(prev => ({
        ...prev,
        toolPermissionContext: createDisabledBypassPermissionsContext(
          prev.toolPermissionContext,
        ),
      }))
    }
  }, [store])

  const onSettingsChange = useCallback(
    (source: SettingSource) => applySettingsChange(source, store.setState),
    [store],
  )

  useSettingsChange(onSettingsChange)

  return (
    <HasAppStateContext.Provider value={true}>
      <AppStoreContext.Provider value={store}>
        <MailboxProvider>
          <VoiceProvider>{children}</VoiceProvider>
        </MailboxProvider>
      </AppStoreContext.Provider>
    </HasAppStateContext.Provider>
  )
}

function useAppStore(): AppStateStore {
  const store = useContext(AppStoreContext)
  if (!store) {
    throw new ReferenceError(
      'useAppState/useSetAppState cannot be called outside of an <AppStateProvider />',
    )
  }
  return store
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useAppStore()

  const get = () => {
    const state = store.getState()
    const selected = selector(state)
    if (false && state === selected) {
      throw new Error(
        `Your selector in \`useAppState(${selector.toString()})\` returned the original state, which is not allowed. You must instead return a property for optimised rendering.`,
      )
    }
    return selected
  }

  return useSyncExternalStore(store.subscribe, get, get)
}

export function useSetAppState(): (
  updater: (prev: AppState) => AppState,
) => void {
  return useAppStore().setState
}

export function useAppStateStore(): AppStateStore {
  return useAppStore()
}

const NOOP_SUBSCRIBE = () => () => {}

export function useAppStateMaybeOutsideOfProvider<T>(
  selector: (state: AppState) => T,
): T | undefined {
  const store = useContext(AppStoreContext)
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    () => (store ? selector(store.getState()) : undefined),
  )
}
