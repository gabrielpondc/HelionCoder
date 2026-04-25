import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: '打开 API 配置界面的兼容旧入口',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND),
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
