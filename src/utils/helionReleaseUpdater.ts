import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_RELEASE_REPO = 'gabrielpondc/HelionCoder'
const DEFAULT_API_BASE = 'https://api.github.com'
const DOWNLOAD_TIMEOUT_MS = 60_000
const VERSION_TIMEOUT_MS = 10_000

type GitHubReleaseAsset = {
	name: string
	url?: string
	browser_download_url?: string
}

type GitHubRelease = {
	tag_name?: string
	name?: string
	body?: string
	assets?: GitHubReleaseAsset[]
}

type InstallTarget = {
	path: string
	displayPath: string
}

type VersionInfo = {
	raw: string
	normalized: string
	major: number
	minor: number
	patch: number
}

export type HelionReleaseUpdateStatus = 'disabled' | 'skipped' | 'current' | 'updated' | 'failed'

export type HelionReleaseUpdateResult = {
	status: HelionReleaseUpdateStatus
	binaryPath: string
	previousVersion?: string
	latestVersion?: string
	message: string
}

export type HelionReleaseUpdateLogger = {
	info(message: string): void
	warn(message: string): void
}

type UpdateOptions = {
	binaryPath: string
	cwd: string
	label?: string
	currentVersion?: string
	respectDisableEnv?: boolean
	quietIfCurrent?: boolean
	logger?: HelionReleaseUpdateLogger
}

const defaultLogger: HelionReleaseUpdateLogger = {
	info: (message) => console.log(message),
	warn: (message) => console.warn(message),
}

export async function maybeUpdateHelionReleaseBinary({
	binaryPath,
	cwd,
	label = 'HelionCoder',
	currentVersion,
	respectDisableEnv = true,
	quietIfCurrent = false,
	logger = defaultLogger,
}: UpdateOptions): Promise<HelionReleaseUpdateResult> {
	if (respectDisableEnv && releaseUpdateDisabled()) {
		return {
			status: 'disabled',
			binaryPath,
			message: `${label} 版本检测：已通过环境变量禁用。`,
		}
	}

	const target = await resolveInstallTarget(binaryPath, cwd)
	if (!target) {
		const message = `${label} 版本检测：未找到可更新的本地 helion-coder 二进制。`
		logger.info(message)
		return { status: 'skipped', binaryPath, message }
	}

	try {
		return await updateResolvedTarget({
			target,
			label,
			currentVersion,
			quietIfCurrent,
			logger,
		})
	} catch (error) {
		const message = `${label} 版本检测：检查失败，继续使用本地二进制。${formatError(error)}`
		logger.warn(message)
		return { status: 'failed', binaryPath: target.path, message }
	}
}

async function updateResolvedTarget({
	target,
	label,
	currentVersion,
	quietIfCurrent,
	logger,
}: {
	target: InstallTarget
	label: string
	currentVersion?: string
	quietIfCurrent: boolean
	logger: HelionReleaseUpdateLogger
}): Promise<HelionReleaseUpdateResult> {
	logger.info(`${label} 版本检测：正在检查 GitHub Releases...`)
	const localVersion = currentVersion
		? extractVersion(currentVersion)
		: await readBinaryVersion(target.path)
	const releaseInfo = await fetchReleaseInfo(label, target.path, logger)
	if ('status' in releaseInfo) {
		return releaseInfo
	}

	const noUpdate = getNoUpdateResult({
		target,
		label,
		localVersion,
		releaseVersion: releaseInfo.releaseVersion,
		quietIfCurrent,
		logger,
	})
	if (noUpdate) {
		return noUpdate
	}

	const assetInfo = findInstallableAsset(label, target.path, releaseInfo.release, logger)
	if ('status' in assetInfo) {
		return assetInfo
	}

	return installAndVerifyRelease({
		target,
		label,
		localVersion,
		release: releaseInfo.release,
		releaseVersion: releaseInfo.releaseVersion,
		asset: assetInfo.asset,
		logger,
	})
}

async function fetchReleaseInfo(
	label: string,
	binaryPath: string,
	logger: HelionReleaseUpdateLogger,
): Promise<
	| HelionReleaseUpdateResult
	| {
			release: GitHubRelease
			releaseVersion: VersionInfo
	  }
> {
	const release = await fetchRelease()
	const releaseVersion = extractVersion(release.tag_name ?? release.name ?? '')
	if (!releaseVersion) {
		const message = `${label} 版本检测：发布版本号无法解析，已跳过更新。`
		logger.warn(message)
		return { status: 'skipped', binaryPath, message }
	}
	return { release, releaseVersion }
}

function getNoUpdateResult({
	target,
	label,
	localVersion,
	releaseVersion,
	quietIfCurrent,
	logger,
}: {
	target: InstallTarget
	label: string
	localVersion: VersionInfo | null
	releaseVersion: VersionInfo
	quietIfCurrent: boolean
	logger: HelionReleaseUpdateLogger
}): HelionReleaseUpdateResult | null {
	if (!localVersion) {
		return null
	}
	if (versionsMatch(localVersion, releaseVersion)) {
		const message = `${label} 版本检测：已是最新版本 ${localVersion.raw}。`
		if (!quietIfCurrent) {
			logger.info(message)
		}
		return currentResult(target.path, localVersion.raw, releaseVersion.raw, message)
	}
	if (
		isReleaseOlderThanLocal(releaseVersion, localVersion) &&
		process.env.HELION_ALLOW_RELEASE_DOWNGRADE !== '1'
	) {
		const message = `${label} 版本检测：本地版本 ${localVersion.raw} 高于发布版本 ${releaseVersion.raw}，已跳过自动替换。`
		logger.info(message)
		return currentResult(target.path, localVersion.raw, releaseVersion.raw, message)
	}
	return null
}

function currentResult(
	binaryPath: string,
	previousVersion: string,
	latestVersion: string,
	message: string,
): HelionReleaseUpdateResult {
	return {
		status: 'current',
		binaryPath,
		previousVersion,
		latestVersion,
		message,
	}
}

function findInstallableAsset(
	label: string,
	binaryPath: string,
	release: GitHubRelease,
	logger: HelionReleaseUpdateLogger,
): HelionReleaseUpdateResult | { asset: GitHubReleaseAsset } {
	const assetName = expectedAssetName()
	if (!assetName) {
		const message = `${label} 版本检测：当前平台 ${process.platform}/${process.arch} 暂无对应发布资产。`
		logger.warn(message)
		return { status: 'skipped', binaryPath, message }
	}

	const asset = findReleaseAsset(release, assetName)
	if (!asset) {
		const message = `${label} 版本检测：未找到适配资产 ${assetName}，已跳过更新。`
		logger.warn(message)
		return { status: 'skipped', binaryPath, message }
	}

	return { asset }
}

async function installAndVerifyRelease({
	target,
	label,
	localVersion,
	release,
	releaseVersion,
	asset,
	logger,
}: {
	target: InstallTarget
	label: string
	localVersion: VersionInfo | null
	release: GitHubRelease
	releaseVersion: VersionInfo
	asset: GitHubReleaseAsset
	logger: HelionReleaseUpdateLogger
}): Promise<HelionReleaseUpdateResult> {
	const from = localVersion?.raw ?? '未安装'
	logger.info(
		`${label} 版本检测：发现版本 ${from} -> ${releaseVersion.raw}，正在下载 ${asset.name}...`,
	)
	await installReleaseAsset(release, asset, target.path)

	const installedVersion = await readBinaryVersion(target.path)
	if (!installedVersion || !versionsMatch(installedVersion, releaseVersion)) {
		throw new Error(
			`安装后版本校验失败：期望 ${releaseVersion.raw}，实际 ${installedVersion?.raw ?? '未知'}`,
		)
	}

	const message = `${label} 版本检测：已更新 ${target.displayPath} 到 ${installedVersion.raw}。`
	logger.info(message)
	return {
		status: 'updated',
		binaryPath: target.path,
		previousVersion: localVersion?.raw,
		latestVersion: installedVersion.raw,
		message,
	}
}

export async function maybeUpdateCurrentCliFromRelease(options: {
	cwd: string
	currentVersion: string
	logger?: HelionReleaseUpdateLogger
}): Promise<HelionReleaseUpdateResult> {
	const binaryPath = resolveCurrentCliBinaryPath()
	if (!binaryPath) {
		const message = 'HelionCoder CLI 版本检测：当前不是可直接替换的 helion-coder 原生二进制。'
		options.logger?.info(message)
		return {
			status: 'skipped',
			binaryPath: process.execPath,
			message,
		}
	}

	return maybeUpdateHelionReleaseBinary({
		binaryPath,
		cwd: options.cwd,
		label: 'HelionCoder CLI',
		currentVersion: options.currentVersion,
		respectDisableEnv: false,
		logger: options.logger,
	})
}

export function resolveCurrentCliBinaryPath(): string | null {
	const explicit = process.env.HELION_CLI_BIN
	if (explicit) {
		return path.resolve(process.cwd(), explicit)
	}

	if (isHelionCommand(process.execPath)) {
		return process.execPath
	}

	const entrypoint = process.argv[1]
	if (entrypoint && isPathLike(entrypoint) && isHelionCommand(entrypoint)) {
		return path.resolve(process.cwd(), entrypoint)
	}

	return null
}

function releaseUpdateDisabled(): boolean {
	return (
		process.env.HELION_DISABLE_STARTUP_UPDATE === '1' ||
		process.env.HELION_SKIP_STARTUP_UPDATE === '1' ||
		process.env.AUTO_UPDATE === '0'
	)
}

async function resolveInstallTarget(
	binaryPath: string,
	cwd: string,
): Promise<InstallTarget | null> {
	if (isPathLike(binaryPath)) {
		const resolved = path.resolve(cwd, binaryPath)
		return {
			path: resolved,
			displayPath: path.relative(cwd, resolved) || resolved,
		}
	}

	if (!isHelionCommand(binaryPath)) {
		return null
	}

	const resolved = await resolveCommandPath(binaryPath)
	if (!resolved) {
		return null
	}

	return {
		path: resolved,
		displayPath: resolved,
	}
}

function isPathLike(binaryPath: string): boolean {
	return (
		path.isAbsolute(binaryPath) ||
		binaryPath.startsWith('.') ||
		binaryPath.includes('/') ||
		binaryPath.includes('\\')
	)
}

function isHelionCommand(commandPath: string): boolean {
	const base = path.basename(commandPath).toLowerCase()
	return base === 'helion-coder' || base === 'helioncoder' || base === 'helion-coder.exe'
}

async function resolveCommandPath(command: string): Promise<string | null> {
	const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
	try {
		const { stdout } = await execFileAsync(lookup, [command], { timeout: VERSION_TIMEOUT_MS })
		const first = stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean)
		return first ?? null
	} catch {
		return null
	}
}

async function readBinaryVersion(binaryPath: string): Promise<VersionInfo | null> {
	try {
		await access(binaryPath)
		const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], {
			timeout: VERSION_TIMEOUT_MS,
		})
		return extractVersion(`${stdout}\n${stderr}`)
	} catch {
		return null
	}
}

async function fetchRelease(): Promise<GitHubRelease> {
	const repo = process.env.HELION_RELEASE_REPO ?? DEFAULT_RELEASE_REPO
	const apiBase = (process.env.HELION_RELEASE_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '')
	const tag = process.env.HELION_RELEASE_TAG
	const includePrerelease = process.env.HELION_RELEASE_INCLUDE_PRERELEASE === '1'
	const endpoint = tag
		? `${apiBase}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
		: includePrerelease
			? `${apiBase}/repos/${repo}/releases?per_page=20`
			: `${apiBase}/repos/${repo}/releases/latest`

	const response = await fetchWithTimeout(endpoint, {
		headers: githubHeaders('application/vnd.github+json'),
	})

	if (!response.ok) {
		throw new Error(`/releases 返回 HTTP ${response.status}`)
	}

	const payload = (await response.json()) as GitHubRelease | GitHubRelease[]
	if (Array.isArray(payload)) {
		const release = payload.find((item) => item.assets?.length)
		if (!release) {
			throw new Error('未找到可下载的 release')
		}
		return release
	}

	return payload
}

function githubHeaders(accept: string): Record<string, string> {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
	return {
		Accept: accept,
		'User-Agent': 'HelionCoder-Release-Updater',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	}
}

function expectedAssetName(): string | null {
	const platform = process.platform
	const arch = process.arch

	if (platform === 'darwin' && arch === 'arm64') return 'helion-coder-darwin-arm64'
	if (platform === 'darwin' && arch === 'x64') return 'helion-coder-darwin-x64'
	if (platform === 'linux' && arch === 'arm64') return 'helion-coder-linux-arm64'
	if (platform === 'linux' && arch === 'x64') return 'helion-coder-linux-x64'
	if (platform === 'win32' && arch === 'x64') return 'helion-coder-windows-x64.exe'

	return null
}

function findReleaseAsset(release: GitHubRelease, expectedName: string): GitHubReleaseAsset | null {
	const assets = release.assets ?? []
	return assets.find((asset) => asset.name === expectedName) ?? null
}

async function installReleaseAsset(
	release: GitHubRelease,
	asset: GitHubReleaseAsset,
	targetPath: string,
): Promise<void> {
	const dir = path.dirname(targetPath)
	await mkdir(dir, { recursive: true })

	const tempPath = path.join(
		dir,
		`.${path.basename(targetPath)}.${process.pid}.${Date.now()}.download`,
	)
	const backupPath = `${targetPath}.bak-${process.pid}-${Date.now()}`
	let backupCreated = false

	try {
		const bytes = await downloadAsset(asset)
		await writeFile(tempPath, bytes)
		if (process.platform !== 'win32') {
			await chmod(tempPath, 0o755)
		}

		const checksum = await findChecksum(release, asset)
		if (checksum) {
			const actual = createHash('sha256').update(bytes).digest('hex')
			if (actual.toLowerCase() !== checksum.toLowerCase()) {
				throw new Error(`SHA256 校验失败：期望 ${checksum}，实际 ${actual}`)
			}
		}

		if (await fileExists(targetPath)) {
			await copyFile(targetPath, backupPath)
			backupCreated = true
		}

		await rename(tempPath, targetPath)
		if (backupCreated) {
			await rm(backupPath, { force: true })
		}
	} catch (error) {
		await rm(tempPath, { force: true })
		if (backupCreated && (await fileExists(backupPath))) {
			await rename(backupPath, targetPath).catch(() => undefined)
		}
		throw error
	}
}

async function downloadAsset(asset: GitHubReleaseAsset): Promise<Uint8Array> {
	const url = asset.url ?? asset.browser_download_url
	if (!url) {
		throw new Error(`资产 ${asset.name} 缺少下载地址`)
	}

	const response = await fetchWithTimeout(url, {
		headers: githubHeaders('application/octet-stream'),
	})

	if (!response.ok) {
		throw new Error(`下载 ${asset.name} 失败：HTTP ${response.status}`)
	}

	return new Uint8Array(await response.arrayBuffer())
}

async function findChecksum(
	release: GitHubRelease,
	asset: GitHubReleaseAsset,
): Promise<string | null> {
	const fromBody = extractChecksum(release.body ?? '', asset.name)
	if (fromBody) {
		return fromBody
	}

	const checksumAsset = (release.assets ?? []).find((candidate) => {
		const name = candidate.name.toLowerCase()
		return (
			name === `${asset.name.toLowerCase()}.sha256` ||
			name === `${asset.name.toLowerCase()}.sha256.txt`
		)
	})

	if (!checksumAsset) {
		return null
	}

	const text = new TextDecoder().decode(await downloadAsset(checksumAsset))
	return extractChecksum(text, asset.name) ?? extractFirstSha256(text)
}

function extractVersion(text: string): VersionInfo | null {
	const match = text.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/)
	if (!match?.[1]) {
		return null
	}

	const normalized = match[1]
	const parts = normalized.match(/^(\d+)\.(\d+)\.(\d+)/)
	if (!parts) {
		return null
	}

	return {
		raw: normalized,
		normalized,
		major: Number(parts[1]),
		minor: Number(parts[2]),
		patch: Number(parts[3]),
	}
}

function versionsMatch(a: VersionInfo, b: VersionInfo): boolean {
	return a.normalized === b.normalized
}

function isReleaseOlderThanLocal(release: VersionInfo, local: VersionInfo): boolean {
	if (release.major !== local.major) return release.major < local.major
	if (release.minor !== local.minor) return release.minor < local.minor
	if (release.patch !== local.patch) return release.patch < local.patch
	return false
}

function extractChecksum(text: string, assetName: string): string | null {
	const escapedName = escapeRegExp(assetName)
	const beforeName = new RegExp(`([a-fA-F0-9]{64})\\s+\\*?${escapedName}`)
	const afterName = new RegExp(`${escapedName}[\\s\\S]{0,120}?([a-fA-F0-9]{64})`)
	return text.match(beforeName)?.[1] ?? text.match(afterName)?.[1] ?? null
}

function extractFirstSha256(text: string): string | null {
	return text.match(/[a-fA-F0-9]{64}/)?.[0] ?? null
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath)
		return true
	} catch {
		return false
	}
}

async function fetchWithTimeout(url: string, init: { headers: Record<string, string> }) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
		})
	} finally {
		clearTimeout(timer)
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error && error.message) {
		return `原因：${error.message}`
	}
	return String(error)
}
