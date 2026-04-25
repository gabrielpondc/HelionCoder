import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasOpenAIKeyConfigured } from '../../utils/openaiConfig.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    aliases: ['api-config', 'configure-api'],
    description: hasOpenAIKeyConfigured()
      ? '重新配置 API、端点和默认模型'
      : '配置 OpenAI 兼容 API 访问',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
