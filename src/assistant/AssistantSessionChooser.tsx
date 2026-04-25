import React, { useEffect } from 'react'
import { Box, Text } from '../ink.js'

type Props = {
  sessions: Array<{ id?: string }>
  onSelect(id: string): void
  onCancel(): void
}

export function AssistantSessionChooser({
  sessions,
  onCancel,
}: Props): React.ReactNode {
  useEffect(() => {
    onCancel()
  }, [onCancel])

  return (
    <Box flexDirection="column">
      <Text bold>Assistant session chooser unavailable</Text>
      <Text dimColor>
        This build does not include the assistant bridge UI.
      </Text>
      <Text dimColor>Detected sessions: {sessions.length}</Text>
    </Box>
  )
}
