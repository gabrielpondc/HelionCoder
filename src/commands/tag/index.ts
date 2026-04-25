import type { Command } from '../../commands.js'

const tag = {
  type: 'local-jsx',
  name: 'tag',
  description: '为当前会话切换可搜索标签',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  argumentHint: '<标签名>',
  load: () => import('./tag.js'),
} satisfies Command

export default tag
