import React, { useCallback, useEffect, useState } from 'react'
import {
  checkIsGitClean,
  checkNeedsClaudeAiLogin,
} from 'src/utils/background/remote/preconditions.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { TeleportStash } from './TeleportStash.js'

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash'

type TeleportErrorProps = {
  onComplete: () => void
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>
}

const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set()

export function TeleportError({
  onComplete,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE,
}: TeleportErrorProps): React.ReactNode {
  const [currentError, setCurrentError] =
    useState<TeleportLocalErrorType | null>(null)

  const checkErrors = useCallback(async () => {
    const currentErrors = await getTeleportErrors()
    const filteredErrors = new Set(
      Array.from(currentErrors).filter(error => !errorsToIgnore.has(error)),
    )

    if (filteredErrors.size === 0) {
      onComplete()
      return
    }

    if (filteredErrors.has('needsLogin')) {
      setCurrentError('needsLogin')
      return
    }

    if (filteredErrors.has('needsGitStash')) {
      setCurrentError('needsGitStash')
    }
  }, [errorsToIgnore, onComplete])

  useEffect(() => {
    void checkErrors()
  }, [checkErrors])

  const onCancel = useCallback(() => {
    gracefulShutdownSync(0)
  }, [])

  const handleStashComplete = useCallback(() => {
    void checkErrors()
  }, [checkErrors])

  if (!currentError) {
    return null
  }

  if (currentError === 'needsGitStash') {
    return (
      <TeleportStash
        onStashAndContinue={handleStashComplete}
        onCancel={onCancel}
      />
    )
  }

  return (
    <Dialog title="远程会话不可用" onCancel={onCancel}>
      <Box flexDirection="column">
        <Text dimColor>
          远程会话需要远程账号认证，而当前构建已移除旧版 OAuth 登录流程。
        </Text>
        <Text dimColor>
          API Key 模式下暂不可使用远程 Web 会话。
        </Text>
      </Box>
      <Select
        options={[{ label: '退出', value: 'exit' }]}
        onChange={onCancel}
      />
    </Dialog>
  )
}

/**
 * Gets current teleport errors that need to be resolved
 * @returns Set of teleport error types that need to be handled
 */
export async function getTeleportErrors(): Promise<Set<TeleportLocalErrorType>> {
  const errors = new Set<TeleportLocalErrorType>()
  const [needsLogin, isGitClean] = await Promise.all([
    checkNeedsClaudeAiLogin(),
    checkIsGitClean(),
  ])

  if (needsLogin) {
    errors.add('needsLogin')
  }
  if (!isGitClean) {
    errors.add('needsGitStash')
  }

  return errors
}
