import { homedir } from 'os'
import { join } from 'path'
import React, { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import { CONFIG_DIR_NAME } from '../../utils/brand.js'

type NewInstallWizardProps = {
  defaultDir: string
  onInstalled(dir: string): void
  onCancel(): void
  onError(message: string): void
}

export async function computeDefaultInstallDir(): Promise<string> {
  return join(homedir(), CONFIG_DIR_NAME, 'assistant')
}

export function NewInstallWizard({
  defaultDir,
  onCancel,
}: NewInstallWizardProps): React.ReactNode {
  useEffect(() => {
    onCancel()
  }, [onCancel])

  return (
    <Box flexDirection="column">
      <Text bold>Assistant installer unavailable</Text>
      <Text dimColor>
        This build does not include the assistant installation wizard.
      </Text>
      <Text dimColor>Suggested install dir: {defaultDir}</Text>
    </Box>
  )
}
