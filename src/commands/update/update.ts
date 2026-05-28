import type { LocalCommandCall } from '../../types/command.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { maybeUpdateCurrentCliFromRelease } from '../../utils/helionReleaseUpdater.js'

export const call: LocalCommandCall = async () => {
	const lines: string[] = [`当前版本：${MACRO.VERSION}`]
	const logger = {
		info: (message: string) => lines.push(message),
		warn: (message: string) => lines.push(message),
	}

	const result = await maybeUpdateCurrentCliFromRelease({
		cwd: process.cwd(),
		currentVersion: MACRO.VERSION,
		logger,
	})

	if (result.status === 'updated') {
		lines.push(result.message || '更新已安装，正在重启 CLI 以使用新版本。')
		scheduleShutdown()
	} else if (result.status === 'restart_scheduled') {
		lines.push(result.message || '更新已准备好，正在退出当前 CLI 以完成替换。')
		scheduleShutdown()
	} else if (result.status === 'skipped') {
		lines.push(
			'未执行更新。请确认当前运行的是 helion-coder 原生二进制，或设置 HELION_CLI_BIN 指向它。',
		)
	} else if (result.status === 'failed') {
		lines.push('更新检查失败，当前会话继续使用本地版本。')
	}

	if (result.latestVersion && result.latestVersion !== result.previousVersion) {
		lines.push(`最新版本：${result.latestVersion}`)
	}
	lines.push(`二进制：${result.binaryPath}`)

	return { type: 'text', value: lines.join('\n') }
}

function scheduleShutdown(): void {
	setTimeout(() => {
		void gracefulShutdown(0)
	}, 300).unref()
}
