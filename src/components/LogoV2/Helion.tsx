import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type HelionPose =
  | 'default'
  | 'arms-up'
  | 'look-left'
  | 'look-right'

type Props = {
  pose?: HelionPose
}

type HelionGlyph = {
  lines: readonly [string, string, string]
}

const HELION_GLYPHS: Record<HelionPose, HelionGlyph> = {
  default: {
    lines: ['  ╭✦─✦╮  ', '╭─╯◕ ◕╰─╮', '  ╰╮≈╭╯  '],
  },
  'look-left': {
    lines: ['  ╭✦─✦╮  ', '╭─╯◕ ·╰─╮', '  ╰╮≈╭╯  '],
  },
  'look-right': {
    lines: ['  ╭✦─✦╮  ', '╭─╯· ◕╰─╮', '  ╰╮≈╭╯  '],
  },
  'arms-up': {
    lines: ['╭✦╮   ╭✦╮', '╰─╮◕ ◕╭─╯', '  ╰╮≈╭╯  '],
  },
}

export function Helion({ pose = 'default' }: Props = {}): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      {HELION_GLYPHS[pose].lines.map((line, index) => (
        <Text key={`${pose}-${index}`} color="helion_body">
          {line}
        </Text>
      ))}
    </Box>
  )
}
