/**
 * MCP add CLI subcommand
 *
 * Extracted from main.tsx to enable direct testing.
 */
import { type Command, Option } from '@commander-js/extra-typings'
import { cliError, cliOk } from '../../cli/exit.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  readClientSecret,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js'
import { addMcpConfig } from '../../services/mcp/config.js'
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  ensureTransport,
  parseHeaders,
} from '../../services/mcp/utils.js'
import {
  getXaaIdpSettings,
  isXaaEnabled,
} from '../../services/mcp/xaaIdpLogin.js'
import { parseEnvVars } from '../../utils/envUtils.js'
import { CLI_NAME } from '../../utils/brand.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * Registers the `mcp add` subcommand on the given Commander command.
 */
export function registerMcpAddCommand(mcp: Command): void {
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .description(
      `向 HelionCoder 添加 MCP 服务器。\n\n` +
        '示例：\n' +
        `  # 添加 HTTP 服务器：\n` +
        `  ${CLI_NAME} mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n` +
        `  # 添加带请求头的 HTTP 服务器：\n` +
        `  ${CLI_NAME} mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n` +
        `  # 添加带环境变量的 stdio 服务器：\n` +
        `  ${CLI_NAME} mcp add -e API_KEY=xxx my-server -- npx my-mcp-server\n\n` +
        `  # 添加带子进程参数的 stdio 服务器：\n` +
        `  ${CLI_NAME} mcp add my-server -- my-command --some-flag arg1`,
    )
    .option(
      '-s, --scope <scope>',
      '配置范围（local、user 或 project）',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      '传输类型（stdio、sse、http）。未指定时默认为 stdio。',
    )
    .option(
      '-e, --env <env...>',
      '设置环境变量（例如 -e KEY=value）',
    )
    .option(
      '-H, --header <header...>',
      '设置请求头（例如 -H "Authorization: Bearer ..." -H "X-Custom: value"）',
    )
    .option('--client-id <clientId>', 'HTTP/SSE 服务器的 OAuth client ID')
    .option(
      '--client-secret',
      '提示输入 OAuth client secret（或设置 MCP_CLIENT_SECRET 环境变量）',
    )
    .option(
      '--callback-port <port>',
      'OAuth 回调固定端口（用于需要预注册 redirect URI 的服务器）',
    )
    .helpOption('-h, --help', '显示命令帮助')
    .addOption(
      new Option(
        '--xaa',
        `为此服务器启用 XAA（SEP-990）。需要先运行 '${CLI_NAME} mcp xaa setup'，并提供 --client-id 和 --client-secret。`,
      ).hideHelp(!isXaaEnabled()),
    )
    .action(async (name, commandOrUrl, args, options) => {
      // Commander.js handles -- natively: it consumes -- and everything after becomes args
      const actualCommand = commandOrUrl
      const actualArgs = args

      // If no name is provided, error
      if (!name) {
        cliError(
          '错误：必须提供服务器名称。\n' +
            `用法：${CLI_NAME} mcp add <name> <command> [args...]`,
        )
      } else if (!actualCommand) {
        cliError(
          '错误：提供服务器名称时也必须提供命令。\n' +
            `用法：${CLI_NAME} mcp add <name> <command> [args...]`,
        )
      }

      try {
        const scope = ensureConfigScope(options.scope)
        const transport = ensureTransport(options.transport)

        // XAA fail-fast: validate at add-time, not auth-time.
        if (options.xaa && !isXaaEnabled()) {
          cliError(
            '错误：--xaa 需要在环境变量中设置 CLAUDE_CODE_ENABLE_XAA=1',
          )
        }
        const xaa = Boolean(options.xaa)
        if (xaa) {
          const missing: string[] = []
          if (!options.clientId) missing.push('--client-id')
          if (!options.clientSecret) missing.push('--client-secret')
          if (!getXaaIdpSettings()) {
            missing.push(
              `'${CLI_NAME} mcp xaa setup'（settings.xaaIdp 未配置）`,
            )
          }
          if (missing.length) {
            cliError(`错误：--xaa 还需要：${missing.join(', ')}`)
          }
        }

        // Check if transport was explicitly provided
        const transportExplicit = options.transport !== undefined

        // Check if the command looks like a URL (likely incorrect usage)
        const looksLikeUrl =
          actualCommand.startsWith('http://') ||
          actualCommand.startsWith('https://') ||
          actualCommand.startsWith('localhost') ||
          actualCommand.endsWith('/sse') ||
          actualCommand.endsWith('/mcp')

        logEvent('tengu_mcp_add', {
          type: transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          scope:
            scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source:
            'command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transport:
            transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transportExplicit: transportExplicit,
          looksLikeUrl: looksLikeUrl,
        })

        if (transport === 'sse') {
          if (!actualCommand) {
            cliError('错误：SSE 传输必须提供 URL。')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'sse' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `已将 SSE MCP 服务器 ${name}（URL：${actualCommand}）添加到 ${scope} 配置\n`,
          )
          if (headers) {
            process.stdout.write(
              `请求头：${jsonStringify(headers, null, 2)}\n`,
            )
          }
        } else if (transport === 'http') {
          if (!actualCommand) {
            cliError('错误：HTTP 传输必须提供 URL。')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'http' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `已将 HTTP MCP 服务器 ${name}（URL：${actualCommand}）添加到 ${scope} 配置\n`,
          )
          if (headers) {
            process.stdout.write(
              `请求头：${jsonStringify(headers, null, 2)}\n`,
            )
          }
        } else {
          if (
            options.clientId ||
            options.clientSecret ||
            options.callbackPort ||
            options.xaa
          ) {
            process.stderr.write(
              `警告：--client-id、--client-secret、--callback-port 和 --xaa 仅支持 HTTP/SSE 传输，将在 stdio 中忽略。\n`,
            )
          }

          // Warn if this looks like a URL but transport wasn't explicitly specified
          if (!transportExplicit && looksLikeUrl) {
            process.stderr.write(
              `\n警告：命令 "${actualCommand}" 看起来像 URL，但未指定 --transport，将按 stdio 服务器处理。\n`,
            )
            process.stderr.write(
              `如果这是 HTTP 服务器，请使用：${CLI_NAME} mcp add --transport http ${name} ${actualCommand}\n`,
            )
            process.stderr.write(
              `如果这是 SSE 服务器，请使用：${CLI_NAME} mcp add --transport sse ${name} ${actualCommand}\n`,
            )
          }

          const env = parseEnvVars(options.env)
          await addMcpConfig(
            name,
            { type: 'stdio', command: actualCommand, args: actualArgs, env },
            scope,
          )

          process.stdout.write(
            `已将 stdio MCP 服务器 ${name}（命令：${actualCommand} ${actualArgs.join(' ')}）添加到 ${scope} 配置\n`,
          )
        }
        cliOk(`已修改文件：${describeMcpConfigFilePath(scope)}`)
      } catch (error) {
        cliError((error as Error).message)
      }
    })
}

