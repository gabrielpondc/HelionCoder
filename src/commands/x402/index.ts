import type { Command } from '../../commands.js'

const x402 = {
  type: 'local',
  name: 'x402',
  aliases: ['wallet', 'pay'],
  description: '配置 x402 加密支付（Base 链 USDC）',
  argumentHint: '[setup|status|enable|disable|set-limit|remove]',
  supportsNonInteractive: true,
  load: () => import('./x402.js'),
} satisfies Command

export default x402
