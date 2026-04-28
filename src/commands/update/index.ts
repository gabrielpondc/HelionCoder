import type { Command } from '../../commands.js'

const update = {
	type: 'local',
	name: 'update',
	description: '检查并更新当前 HelionCoder CLI',
	supportsNonInteractive: true,
	load: () => import('./update.js'),
} satisfies Command

export default update
