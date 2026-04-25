import React, { useCallback, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import type { OptionWithDescription } from './CustomSelect/select.js'
import { Select } from './CustomSelect/select.js'
import { PermissionDialog } from './permissions/PermissionDialog.js'

type RemoteCalloutSelection = 'enable' | 'dismiss'

type Props = {
  onDone: (selection: RemoteCalloutSelection) => void
}

export function RemoteCallout({ onDone }: Props): React.ReactNode {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const handleDismiss = useCallback((): void => {
    onDoneRef.current('dismiss')
  }, [])

  useEffect(() => {
    saveGlobalConfig(current => {
      if (current.remoteDialogSeen) return current
      return {
        ...current,
        remoteDialogSeen: true,
      }
    })
  }, [])

  const options: OptionWithDescription<RemoteCalloutSelection>[] = [
    {
      label: '关闭',
      description: 'API Key 模式下无法使用远程控制。',
      value: 'dismiss',
    },
  ]

  return (
    <PermissionDialog title="远程控制不可用">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text>
            远程控制依赖旧版网页登录认证流程，而当前 HelionCoder 构建已禁用该流程。
          </Text>
          <Text> </Text>
          <Text>当前构建仅支持本地 API Key 会话。</Text>
        </Box>
        <Box>
          <Select
            options={options}
            onChange={handleDismiss}
            onCancel={handleDismiss}
          />
        </Box>
      </Box>
    </PermissionDialog>
  )
}

/**
 * Check whether to show the remote callout (first-time dialog).
 */
export function shouldShowRemoteCallout(): boolean {
  const config = getGlobalConfig()
  if (config.remoteDialogSeen) return false
  return false
}
