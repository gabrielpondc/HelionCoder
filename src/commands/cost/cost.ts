import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'
import { PRODUCT_NAME } from '../../utils/brand.js'

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        `当前正在使用额外用量支持 ${PRODUCT_NAME}。订阅额度重置后会自动切回订阅额度。`
    } else {
      value =
        `当前正在使用订阅额度支持 ${PRODUCT_NAME}。`
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] 仍显示费用：\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}

