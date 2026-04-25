import type { Command } from '../../commands.js'
import { PRODUCT_NAME } from '../../utils/brand.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `设置 ${PRODUCT_NAME} 使用的 AI 模型（当前：${renderModelName(getMainLoopModel())}）`
  },
  argumentHint: '[模型]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
