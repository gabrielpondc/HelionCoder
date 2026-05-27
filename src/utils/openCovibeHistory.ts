import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AssistantMessage, Message, UserMessage } from '../types/message.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'

type SyncOptions = {
	sessionId: string
	cwd: string
	transcriptPath: string
}

type SyncMessagesOptions = SyncOptions & {
	messages: Message[]
}

type SyncTitleOptions = SyncOptions & {
	title: string
}

type RunMeta = {
	id: string
	prompt: string
	cwd: string
	agent: string
	auth_mode: string
	status: string
	started_at: string
	ended_at?: string
	session_id: string
	model?: string
	name?: string
	source: string
	cli_session_path: string
	hidden: boolean
	no_session_persistence: boolean
	execution_path: string
	conversation_ref: {
		kind: string
		id: string
	}
}

type EventState = {
	nextSeq: number
	eventIds: Set<string>
	hasSessionInit: boolean
	firstUserText?: string
	firstTs?: string
	lastTs?: string
	messageCount: number
	userMessageCount: number
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	costUsd: number
}

type BusEvent = Record<string, unknown> & {
	type: string
	run_id: string
}

const RUN_SOURCE = 'cli_import'
const HELION_AGENT = 'helioncoder'

export async function syncOpenCovibeMessages({
	sessionId,
	cwd,
	transcriptPath,
	messages,
}: SyncMessagesOptions): Promise<void> {
	if (shouldSkipOpenCovibeSync() || messages.length === 0) {
		return
	}

	try {
		const home = getClaudeConfigHomeDir()
		const runId = await resolveRunId(home, sessionId, cwd)
		const runDir = join(home, 'runs', runId)
		const eventsPath = join(runDir, 'events.jsonl')
		await mkdir(runDir, { recursive: true, mode: 0o700 })

		const existingMeta = await readRunMeta(runDir)
		const state = await readEventState(eventsPath)
		const firstIncomingUser = firstMeaningfulUserText(messages)
		const startedAt =
			existingMeta?.started_at ?? state.firstTs ?? firstMessageTimestamp(messages) ?? nowIso()

		let model = existingMeta?.model
		let seq = state.nextSeq
		const appendBusEvent = async (event: BusEvent, ts: string): Promise<void> => {
			const envelope = {
				_bus: true,
				seq,
				ts,
				event,
			}
			seq += 1
			await appendFile(eventsPath, `${JSON.stringify(envelope)}\n`, {
				encoding: 'utf8',
				mode: 0o600,
			})
			state.lastTs = ts
		}

		if (!state.hasSessionInit) {
			await appendBusEvent(
				{
					type: 'session_init',
					run_id: runId,
					session_id: sessionId,
					model: model ?? null,
					tools: [],
					cwd,
					slash_commands: [],
					mcp_servers: [],
					agents: [],
					skills: [],
					plugins: [],
					plugin_errors: [],
				},
				startedAt,
			)
			state.hasSessionInit = true
		}

		let userTurnCount = state.userMessageCount
		for (const message of messages) {
			if (message.type === 'user') {
				const text = messageText(message)
				if (!text || isMetaHistoryText(text)) {
					continue
				}
				const eventId = message.uuid
				if (state.eventIds.has(eventId)) {
					continue
				}
				await appendBusEvent(
					{
						type: 'user_message',
						run_id: runId,
						text,
						uuid: eventId,
					},
					message.timestamp ?? nowIso(),
				)
				state.eventIds.add(eventId)
				state.messageCount += 1
				userTurnCount += 1
				state.firstUserText ??= text
				state.firstTs ??= message.timestamp
			} else if (message.type === 'assistant') {
				const text = messageText(message)
				if (!text) {
					continue
				}
				const eventId = assistantMessageId(message)
				if (state.eventIds.has(eventId)) {
					continue
				}
				model ??= assistantModel(message)
				await appendBusEvent(
					{
						type: 'message_complete',
						run_id: runId,
						message_id: eventId,
						text,
						model: assistantModel(message) ?? null,
						stop_reason: assistantStopReason(message) ?? null,
						message_usage: assistantUsage(message) ?? null,
					},
					message.timestamp ?? nowIso(),
				)
				state.eventIds.add(eventId)
				state.messageCount += 1

				const usage = assistantUsage(message)
				if (usage) {
					const inputTokens = numericUsage(usage, 'input_tokens')
					const outputTokens = numericUsage(usage, 'output_tokens')
					const cacheReadTokens = numericUsage(usage, 'cache_read_input_tokens')
					const cacheWriteTokens = numericUsage(usage, 'cache_creation_input_tokens')
					await appendBusEvent(
						{
							type: 'usage_update',
							run_id: runId,
							input_tokens: inputTokens,
							output_tokens: outputTokens,
							cache_read_tokens: cacheReadTokens,
							cache_write_tokens: cacheWriteTokens,
							total_cost_usd: 0,
							turn_index: userTurnCount || undefined,
							model_usage: model
								? {
										[model]: {
											input_tokens: inputTokens,
											output_tokens: outputTokens,
											cache_read_tokens: cacheReadTokens,
											cache_write_tokens: cacheWriteTokens,
											cost_usd: 0,
										},
									}
								: undefined,
						},
						message.timestamp ?? nowIso(),
					)
					state.inputTokens += inputTokens
					state.outputTokens += outputTokens
					state.cacheReadTokens += cacheReadTokens
					state.cacheWriteTokens += cacheWriteTokens
				}
			}
		}

		const prompt = existingMeta?.prompt || state.firstUserText || firstIncomingUser || 'No prompt'
		const refreshedState = await readEventState(eventsPath)
		const meta: RunMeta = {
			id: runId,
			prompt: truncate(prompt.replace(/\n/g, ' ').trim(), 400),
			cwd,
			agent: existingMeta?.agent ?? HELION_AGENT,
			auth_mode: existingMeta?.auth_mode ?? 'cli',
			status: 'stopped',
			started_at: startedAt,
			ended_at: refreshedState.lastTs ?? state.lastTs ?? startedAt,
			session_id: sessionId,
			model,
			name: existingMeta?.name,
			source: RUN_SOURCE,
			cli_session_path: transcriptPath,
			hidden: false,
			no_session_persistence: false,
			execution_path: 'session_actor',
			conversation_ref: {
				kind: 'claude_session',
				id: sessionId,
			},
		}
		await writeRunMeta(runDir, meta)
		await refreshUsageSqlite(home, meta, refreshedState)
	} catch {
		// Best-effort sync: OpenCovibe history should never break CLI transcript persistence.
	}
}

export async function syncOpenCovibeTitle({
	sessionId,
	cwd,
	transcriptPath,
	title,
}: SyncTitleOptions): Promise<void> {
	if (shouldSkipOpenCovibeSync()) {
		return
	}
	const trimmed = title.trim()
	if (!trimmed) {
		return
	}

	try {
		const home = getClaudeConfigHomeDir()
		const runId = await resolveRunId(home, sessionId, cwd)
		const runDir = join(home, 'runs', runId)
		await mkdir(runDir, { recursive: true, mode: 0o700 })
		const existingMeta = await readRunMeta(runDir)
		const state = await readEventState(join(runDir, 'events.jsonl'))
		const now = nowIso()
		const meta: RunMeta = {
			id: runId,
			prompt: existingMeta?.prompt ?? state.firstUserText ?? trimmed,
			cwd,
			agent: existingMeta?.agent ?? HELION_AGENT,
			auth_mode: existingMeta?.auth_mode ?? 'cli',
			status: existingMeta?.status ?? 'stopped',
			started_at: existingMeta?.started_at ?? state.firstTs ?? now,
			ended_at: existingMeta?.ended_at ?? state.lastTs,
			session_id: sessionId,
			model: existingMeta?.model,
			name: truncate(trimmed, 120),
			source: RUN_SOURCE,
			cli_session_path: existingMeta?.cli_session_path ?? transcriptPath,
			hidden: false,
			no_session_persistence: false,
			execution_path: 'session_actor',
			conversation_ref: {
				kind: 'claude_session',
				id: sessionId,
			},
		}
		await writeRunMeta(runDir, meta)
		await refreshUsageSqlite(home, meta, state)
	} catch {
		// Title sync is best effort.
	}
}

async function resolveRunId(home: string, sessionId: string, cwd: string): Promise<string> {
	const runsDir = join(home, 'runs')
	try {
		for (const entry of await readdir(runsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue
			}
			const meta = await readRunMeta(join(runsDir, entry.name))
			if (meta?.source === RUN_SOURCE && meta.session_id === sessionId && meta.cwd === cwd) {
				return meta.id || entry.name
			}
		}
	} catch {
		// No existing runs directory yet.
	}

	const hash = createHash('sha256').update(`${cwd}\0${sessionId}`).digest('hex').slice(0, 32)
	return `cli-${hash}`
}

async function readRunMeta(runDir: string): Promise<RunMeta | undefined> {
	try {
		return JSON.parse(await readFile(join(runDir, 'meta.json'), 'utf8')) as RunMeta
	} catch {
		return undefined
	}
}

async function writeRunMeta(runDir: string, meta: RunMeta): Promise<void> {
	const compactMeta = Object.fromEntries(
		Object.entries(meta).filter(([, value]) => value !== undefined),
	)
	await writeFile(join(runDir, 'meta.json'), `${JSON.stringify(compactMeta)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
	})
}

async function readEventState(eventsPath: string): Promise<EventState> {
	const state: EventState = {
		nextSeq: 1,
		eventIds: new Set(),
		hasSessionInit: false,
		messageCount: 0,
		userMessageCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0,
	}

	let content = ''
	try {
		content = await readFile(eventsPath, 'utf8')
	} catch {
		return state
	}

	for (const line of content.split(/\r?\n/)) {
		if (!line.trim()) {
			continue
		}
		try {
			const envelope = JSON.parse(line) as Record<string, unknown>
			if (typeof envelope.seq === 'number') {
				state.nextSeq = Math.max(state.nextSeq, envelope.seq + 1)
			}
			const ts =
				typeof envelope.ts === 'string'
					? envelope.ts
					: typeof envelope.timestamp === 'string'
						? envelope.timestamp
						: undefined
			const event =
				envelope._bus === true && envelope.event && typeof envelope.event === 'object'
					? (envelope.event as Record<string, unknown>)
					: envelope
			const type = typeof event.type === 'string' ? event.type : ''
			if (type === 'session_init') {
				state.hasSessionInit = true
				state.firstTs ??= ts
			} else if (type === 'user_message') {
				state.messageCount += 1
				state.userMessageCount += 1
				state.firstTs ??= ts
				state.lastTs = ts ?? state.lastTs
				if (typeof event.uuid === 'string') {
					state.eventIds.add(event.uuid)
				}
				if (!state.firstUserText && typeof event.text === 'string') {
					state.firstUserText = event.text
				}
			} else if (type === 'message_complete') {
				state.messageCount += 1
				state.lastTs = ts ?? state.lastTs
				if (typeof event.message_id === 'string') {
					state.eventIds.add(event.message_id)
				}
			} else if (type === 'usage_update') {
				state.inputTokens += numberField(event, 'input_tokens')
				state.outputTokens += numberField(event, 'output_tokens')
				state.cacheReadTokens += numberField(event, 'cache_read_tokens')
				state.cacheWriteTokens += numberField(event, 'cache_write_tokens')
				state.costUsd += numberField(event, 'total_cost_usd')
				state.lastTs = ts ?? state.lastTs
			}
		} catch {
			// Ignore malformed lines.
		}
	}
	return state
}

function firstMeaningfulUserText(messages: Message[]): string | undefined {
	for (const message of messages) {
		if (message.type !== 'user' || message.isMeta) {
			continue
		}
		const text = messageText(message)
		if (text && !isMetaHistoryText(text)) {
			return text
		}
	}
	return undefined
}

function firstMessageTimestamp(messages: Message[]): string | undefined {
	for (const message of messages) {
		if ('timestamp' in message && typeof message.timestamp === 'string') {
			return message.timestamp
		}
	}
	return undefined
}

function messageText(message: UserMessage | AssistantMessage): string {
	if (message.type === 'user') {
		return stripPromptForHistory(extractText(message.message.content))
	}
	return extractText(message.message.content)
}

function extractText(content: unknown): string {
	if (typeof content === 'string') {
		return content.trim()
	}
	if (!Array.isArray(content)) {
		return ''
	}
	const parts: string[] = []
	for (const block of content) {
		if (!block || typeof block !== 'object') {
			continue
		}
		const record = block as Record<string, unknown>
		if (record.type === 'text' && typeof record.text === 'string') {
			parts.push(record.text)
		} else if (record.type === 'tool_use' && typeof record.name === 'string') {
			parts.push(`使用工具：${record.name}`)
		} else if (record.type === 'tool_result') {
			const nested = extractText(record.content)
			if (nested) {
				parts.push(nested)
			}
		}
	}
	return parts.join('\n\n').trim()
}

function assistantMessageId(message: AssistantMessage): string {
	return message.message.id || message.uuid
}

function assistantModel(message: AssistantMessage): string | undefined {
	const model = message.message.model
	return typeof model === 'string' && model ? model : undefined
}

function assistantStopReason(message: AssistantMessage): string | undefined {
	const stopReason = message.message.stop_reason
	return typeof stopReason === 'string' ? stopReason : undefined
}

function assistantUsage(message: AssistantMessage): Record<string, unknown> | undefined {
	const usage = message.message.usage
	return usage && typeof usage === 'object'
		? (usage as unknown as Record<string, unknown>)
		: undefined
}

function numericUsage(usage: Record<string, unknown>, key: string): number {
	return numberField(usage, key)
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function refreshUsageSqlite(home: string, meta: RunMeta, state: EventState): Promise<void> {
	const updatedAt = nowIso()
	const totalTokens =
		state.inputTokens + state.outputTokens + state.cacheReadTokens + state.cacheWriteTokens
	const model = meta.model || 'Unknown'
	const dbPath = join(home, 'helioncoder.sqlite')
	await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 })

	const sql = `
CREATE TABLE IF NOT EXISTS usage_sessions (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_activity_at TEXT,
  model TEXT,
  messages INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_models (
  model TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR REPLACE INTO usage_sessions
  (run_id, started_at, last_activity_at, model, messages, input_tokens, output_tokens,
   cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, additions, deletions, updated_at)
VALUES
  (${sqlValue(meta.id)}, ${sqlValue(meta.started_at)}, ${sqlValue(state.lastTs ?? meta.ended_at ?? meta.started_at)},
   ${sqlValue(model)}, ${state.messageCount}, ${state.inputTokens}, ${state.outputTokens},
   ${state.cacheReadTokens}, ${state.cacheWriteTokens}, ${totalTokens}, ${state.costUsd}, 0, 0,
   ${sqlValue(updatedAt)});
DELETE FROM usage_daily;
INSERT INTO usage_daily
  (day, sessions, messages, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
   total_tokens, cost_usd, additions, deletions, updated_at)
SELECT substr(started_at, 1, 10), COUNT(*), COALESCE(SUM(messages), 0),
       COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
       COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0),
       COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost_usd), 0),
       COALESCE(SUM(additions), 0), COALESCE(SUM(deletions), 0), ${sqlValue(updatedAt)}
FROM usage_sessions
GROUP BY substr(started_at, 1, 10);
DELETE FROM usage_models;
INSERT INTO usage_models
  (model, sessions, messages, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
   total_tokens, cost_usd, additions, deletions, updated_at)
SELECT COALESCE(NULLIF(model, ''), 'Unknown'), COUNT(*), COALESCE(SUM(messages), 0),
       COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
       COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0),
       COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost_usd), 0),
       COALESCE(SUM(additions), 0), COALESCE(SUM(deletions), 0), ${sqlValue(updatedAt)}
FROM usage_sessions
GROUP BY COALESCE(NULLIF(model, ''), 'Unknown');
INSERT OR REPLACE INTO app_profile (key, value, updated_at)
VALUES ('schema_version', '1', ${sqlValue(updatedAt)});
`
	await runSqlite(dbPath, sql)
}

async function runSqlite(dbPath: string, sql: string): Promise<void> {
	await new Promise<void>((resolve) => {
		const child = spawn('sqlite3', [dbPath], {
			stdio: ['pipe', 'ignore', 'ignore'],
		})
		child.on('error', () => resolve())
		child.on('close', () => resolve())
		child.stdin.on('error', () => resolve())
		child.stdin.end(sql)
	})
}

function sqlValue(value: string | undefined): string {
	if (value === undefined) {
		return 'NULL'
	}
	return `'${value.replace(/'/g, "''")}'`
}

function shouldSkipOpenCovibeSync(): boolean {
	const allowTestPersistence = isEnvTruthy(process.env.TEST_ENABLE_SESSION_PERSISTENCE)
	return (
		isEnvTruthy(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY) ||
		(process.env.NODE_ENV === 'test' && !allowTestPersistence)
	)
}

function stripPromptForHistory(value: string): string {
	let text = value.trim()
	for (let index = 0; index < 4; index += 1) {
		const next = stripKnownPromptWrapper(stripLeadingContextTags(text)).trim()
		if (next === text) {
			break
		}
		text = next
	}
	return text
}

function stripKnownPromptWrapper(value: string): string {
	const text = value.trim()
	if (
		text.startsWith('You are HelionCoder running inside VS Code') ||
		text.startsWith('You are HelionCoder running inside a JetBrains IDE')
	) {
		const matches = Array.from(text.matchAll(/\nUser request:\s*\n/gi))
		const marker = matches.at(-1)
		return marker?.index === undefined ? text : text.slice(marker.index + marker[0].length).trim()
	}
	if (text.startsWith('Previous conversation context from this VS Code assistant panel.')) {
		const marker = text.match(/\n\nCurrent user request:\s*\n/i)
		return marker?.index === undefined ? text : text.slice(marker.index + marker[0].length).trim()
	}
	return text
}

function stripLeadingContextTags(value: string): string {
	let text = value.trim()
	const tagPattern =
		/^<(ide_opened_file|ide_selection|local-command-stdout|command-name|command-message|command-args|file-history-snapshot|task-notification)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/i
	for (let index = 0; index < 8; index += 1) {
		const next = text.replace(tagPattern, '').trim()
		if (next === text) {
			break
		}
		text = next
	}
	return text
}

function isMetaHistoryText(value: string): boolean {
	const text = value.trim()
	return (
		text.startsWith('<local-command-stdout>') ||
		text.startsWith('<command-name>') ||
		text.startsWith('<ide_') ||
		/^\/(?:api-config|clear|compact|config|cost|doctor|help|init|login|logout|model|permissions?|plugins?|release-notes|resume|statusline|theme)(?:\s|$)/i.test(
			text,
		)
	)
}

function truncate(value: string, maxChars: number): string {
	const chars = Array.from(value)
	if (chars.length <= maxChars) {
		return value
	}
	return `${chars.slice(0, maxChars).join('').trim()}...`
}

function nowIso(): string {
	return new Date().toISOString()
}
