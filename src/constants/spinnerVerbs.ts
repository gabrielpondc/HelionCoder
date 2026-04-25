import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

// Spinner verbs for loading messages.
export const SPINNER_VERBS = [
  '分析中',
  '思考中',
  '规划中',
  '整理中',
  '推理中',
  '编排中',
  '检索中',
  '阅读中',
  '撰写中',
  '修正中',
  '验证中',
  '运行中',
  '合并中',
  '构建中',
  '检查中',
  '调试中',
  '探索中',
  '计算中',
  '处理中',
  '协作中',
  '收敛中',
  '生成中',
  '提炼中',
  '理解中',
  '对齐中',
  '响应中',
  '推进中',
  '准备中',
  '灵动中',
  '唤醒中',
  '梳理中',
  '完成中',
]
