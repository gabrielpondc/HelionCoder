import type { Command } from '../../commands.js'

const rewind = {
  description: `将代码或对话恢复到之前的位置`,
  name: 'rewind',
  aliases: ['checkpoint'],
  argumentHint: '',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./rewind.js'),
} satisfies Command

export default rewind

