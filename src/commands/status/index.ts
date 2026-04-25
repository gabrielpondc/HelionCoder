import type { Command } from '../../commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    '显示 HelionCoder 状态，包括版本、模型、账号、API 连通性和工具状态',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status

