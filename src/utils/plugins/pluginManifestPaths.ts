import type { Dirent } from 'node:fs'
import { readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { logForDebugging } from '../debug.js'
import { errorMessage, isENOENT } from '../errors.js'
import { pathExists } from '../file.js'

export const HELION_PLUGIN_MANIFEST_DIR = '.helion-plugin'
export const LEGACY_CLAUDE_PLUGIN_MANIFEST_DIR = '.claude-plugin'

export const PLUGIN_MANIFEST_DIRS = [
	HELION_PLUGIN_MANIFEST_DIR,
	LEGACY_CLAUDE_PLUGIN_MANIFEST_DIR,
] as const

export function isPluginManifestDirName(name: string): boolean {
	return (PLUGIN_MANIFEST_DIRS as readonly string[]).includes(name)
}

export function getPreferredPluginManifestPath(pluginRoot: string, fileName: string): string {
	return join(pluginRoot, HELION_PLUGIN_MANIFEST_DIR, fileName)
}

export function getPluginManifestPathCandidates(pluginRoot: string, fileName: string): string[] {
	return PLUGIN_MANIFEST_DIRS.map((dir) => join(pluginRoot, dir, fileName))
}

export async function findPluginManifestPath(
	pluginRoot: string,
	fileName: string,
): Promise<string> {
	for (const candidate of getPluginManifestPathCandidates(pluginRoot, fileName)) {
		if (await pathExists(candidate)) return candidate
	}
	return getPreferredPluginManifestPath(pluginRoot, fileName)
}

export async function normalizePluginManifestDirectories(root: string): Promise<void> {
	try {
		await renameLegacyManifestDirectories(root)
	} catch (error) {
		if (!isENOENT(error)) {
			logForDebugging(
				`Failed to normalize plugin manifest directories under ${root}: ${errorMessage(error)}`,
				{ level: 'warn' },
			)
		}
	}
}

async function renameLegacyManifestDirectories(dir: string): Promise<void> {
	let entries: Dirent[]
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch (error) {
		if (isENOENT(error)) return
		throw error
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		if (entry.name === '.git') continue

		const entryPath = join(dir, entry.name)
		if (entry.name === LEGACY_CLAUDE_PLUGIN_MANIFEST_DIR) {
			const helionPath = join(dir, HELION_PLUGIN_MANIFEST_DIR)
			if (!(await pathExists(helionPath))) {
				await rename(entryPath, helionPath)
			}
			continue
		}

		await renameLegacyManifestDirectories(entryPath)
	}
}
