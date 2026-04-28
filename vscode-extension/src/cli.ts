import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export interface RunPromptController {
  sendSideQuestion(question: string): string | undefined;
  sendPermissionResponse(
    requestId: string,
    response: PermissionResponseInput,
  ): boolean;
}

export interface ResolvedCli {
  command: string;
  argsPrefix: string[];
  label: string;
}

export interface RunPromptOptions {
  cwd?: string;
  timeoutMs?: number;
  cancellation?: vscode.CancellationToken;
  sessionId?: string;
  permissionMode?: string;
  thinkingMode?: string;
  planMode?: boolean;
  addDirs?: string[];
  streamJson?: boolean;
  onController?: (controller: RunPromptController) => void;
  onSideQuestion?: (response: SideQuestionResponse) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onPermissionCancel?: (requestId: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onToolStep?: (event: ToolStepEvent) => void;
  onThinking?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SideQuestionResponse {
  requestId: string;
  response?: string;
  error?: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  description?: string;
  blockedPath?: string;
  permissionSuggestions?: unknown[];
}

export type PermissionResponseInput =
  | {
      behavior: "allow";
      updatedInput: Record<string, unknown>;
      updatedPermissions?: unknown[];
      toolUseID?: string;
      decisionClassification?: "user_temporary" | "user_permanent";
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
      decisionClassification?: "user_reject";
    };

export interface RunPromptResult {
  stdout: string;
  stderr: string;
  code: number | null;
  sessionId?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
}

export type ToolStepStatus =
  | "started"
  | "running"
  | "completed"
  | "failed"
  | "status";

export interface ToolStepEvent {
  id: string;
  toolName: string;
  status: ToolStepStatus;
  label: string;
  detail?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  elapsedSeconds?: number;
  input?: Record<string, unknown>;
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export class HelionCli {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  async resolve(): Promise<ResolvedCli> {
    const configured = vscode.workspace
      .getConfiguration("helionCoder")
      .get<string>("executablePath", "")
      .trim();

    if (configured.length > 0) {
      return this.toResolvedCli(configured, "已配置的可执行文件");
    }

    const roots = this.getCandidateRoots();
    const executableName =
      process.platform === "win32" ? "helion-coder.exe" : "helion-coder";

    for (const root of roots) {
      const nativeCandidate = path.join(root, "dist", executableName);
      if (this.isFile(nativeCandidate)) {
        return this.toResolvedCli(nativeCandidate, "工作区 dist 可执行文件");
      }

      const moduleCandidate = path.join(root, "dist", "cli.mjs");
      if (this.isFile(moduleCandidate)) {
        return this.toResolvedCli(moduleCandidate, "工作区 dist 模块");
      }

      const packagedNative = path.join(root, "bin", executableName);
      if (this.isFile(packagedNative)) {
        return this.toResolvedCli(packagedNative, "已打包可执行文件");
      }

      const packagedModule = path.join(root, "bin", "cli.mjs");
      if (this.isFile(packagedModule)) {
        return this.toResolvedCli(packagedModule, "已打包模块");
      }
    }

    const fromPath =
      this.findOnPath(executableName) ?? this.findOnPath("helion-coder");
    if (fromPath) {
      return this.toResolvedCli(fromPath, "PATH 中的可执行文件");
    }

    return {
      command: "helion-coder",
      argsPrefix: [],
      label: "PATH 中的 helion-coder",
    };
  }

  async runPrompt(
    prompt: string,
    options: RunPromptOptions = {},
  ): Promise<RunPromptResult> {
    const resolved = await this.resolve();
    const config = vscode.workspace.getConfiguration("helionCoder");
    const defaultArgs = config.get<string[]>("defaultArgs", ["--bare"]);
    const selectedModel = config.get<string>("model", "").trim();
    const selectedEffort = config.get<string>("effort", "").trim();
    const selectedPermissionMode =
      options.permissionMode ?? config.get<string>("permissionMode", "").trim();
    const selectedThinkingMode =
      options.thinkingMode ?? config.get<string>("thinking", "").trim();
    const modelArgs =
      selectedModel && !argsContainModel(defaultArgs)
        ? ["--model", selectedModel]
        : [];
    const effortArgs =
      selectedEffort && !argsContainEffort(defaultArgs)
        ? ["--effort", selectedEffort]
        : [];
    const permissionArgs =
      selectedPermissionMode && !argsContainPermissionMode(defaultArgs)
        ? ["--permission-mode", selectedPermissionMode]
        : [];
    const thinkingArgs =
      selectedThinkingMode && !argsContainThinking(defaultArgs)
        ? ["--thinking", selectedThinkingMode]
        : [];
    const planArgs =
      options.planMode && !argsContainPlanMode(defaultArgs)
        ? ["--plan-mode-required"]
        : [];
    const addDirArgs = uniquePaths(options.addDirs ?? []).flatMap((dir) => [
      "--add-dir",
      dir,
    ]);
    const outputArgs = options.streamJson
      ? [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--permission-prompt-tool",
          "stdio",
        ]
      : ["-p", "--output-format", "text", prompt];
    const args = [
      ...resolved.argsPrefix,
      ...defaultArgs,
      ...addDirArgs,
      ...modelArgs,
      ...effortArgs,
      ...permissionArgs,
      ...thinkingArgs,
      ...planArgs,
      ...outputArgs,
    ];
    const cwd = options.cwd ?? getWorkspaceCwd();

    this.output.appendLine(
      `$ ${quoteArg(resolved.command)} ${args.map(quoteArg).join(" ")}`,
    );
    this.output.appendLine(`工作目录：${cwd}`);

    return await new Promise((resolve, reject) => {
      let stdout = "";
      let rawStdout = "";
      let stderr = "";
      let streamBuffer = "";
      let streamText = "";
      let streamResult = "";
      let streamError = "";
      let streamDone = false;
      let streamSessionId: string | undefined;
      let streamUsage: TokenUsage | undefined;
      let settled = false;
      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined;
      const sideQuestionRequests = new Set<string>();

      const handleParsed = (parsed: StreamJsonParseResult) => {
        if (parsed.text) {
          streamText += parsed.text;
          options.onStdout?.(parsed.text);
        }
        if (parsed.thinking) {
          options.onThinking?.(parsed.thinking);
        }
        if (parsed.finalText !== undefined) {
          streamResult = parsed.finalText;
        }
        if (parsed.errorText) {
          streamError = parsed.errorText;
        }
        if (parsed.sessionId) {
          streamSessionId = parsed.sessionId;
        }
        if (parsed.usage) {
          streamUsage = parsed.usage;
          options.onUsage?.(parsed.usage);
        }
        for (const step of parsed.toolSteps ?? []) {
          options.onToolStep?.(step);
        }
        if (
          parsed.sideQuestion &&
          sideQuestionRequests.has(parsed.sideQuestion.requestId)
        ) {
          sideQuestionRequests.delete(parsed.sideQuestion.requestId);
          options.onSideQuestion?.(parsed.sideQuestion);
        }
        if (parsed.permissionRequest) {
          options.onPermissionRequest?.(parsed.permissionRequest);
        }
        if (parsed.permissionCancelRequestId) {
          options.onPermissionCancel?.(parsed.permissionCancelRequestId);
        }
        if (parsed.done) {
          streamDone = true;
          child.stdin?.end();
        }
      };

      const child = spawn(resolved.command, args, {
        cwd,
        env: {
          ...process.env,
          CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          TERM: process.env.TERM ?? "xterm-256color",
        },
        shell: false,
        stdio: [options.streamJson ? "pipe" : "ignore", "pipe", "pipe"],
      });

      if (options.streamJson && child.stdin) {
        options.onController?.({
          sendSideQuestion: (question: string) => {
            if (
              !child.stdin ||
              child.stdin.destroyed ||
              child.killed ||
              streamDone
            ) {
              return undefined;
            }
            const requestId = randomId();
            sideQuestionRequests.add(requestId);
            child.stdin.write(
              `${JSON.stringify({
                type: "control_request",
                request_id: requestId,
                request: {
                  subtype: "side_question",
                  question,
                },
              })}\n`,
            );
            return requestId;
          },
          sendPermissionResponse: (requestId, response) => {
            if (
              !child.stdin ||
              child.stdin.destroyed ||
              child.killed ||
              streamDone
            ) {
              return false;
            }
            child.stdin.write(
              `${JSON.stringify({
                type: "control_response",
                response: {
                  subtype: "success",
                  request_id: requestId,
                  response,
                },
              })}\n`,
            );
            return true;
          },
        });

        child.stdin.write(
          `${JSON.stringify({
            type: "user",
            session_id: options.sessionId ?? "",
            message: {
              role: "user",
              content: prompt,
            },
            parent_tool_use_id: null,
          })}\n`,
        );
      }

      const cancel = () => {
        if (settled) {
          return;
        }
        child.kill("SIGTERM");
      };

      if (options.cancellation) {
        options.cancellation.onCancellationRequested(cancel);
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          timedOut = true;
          cancel();
        }, options.timeoutMs);
      }

      child.stdout?.on("data", (data) => {
        const chunk = stripAnsi(String(data));
        rawStdout += chunk;
        this.output.append(chunk);
        if (options.streamJson) {
          streamBuffer += chunk;
          const lines = streamBuffer.split(/\r?\n/);
          streamBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const parsed = parseStreamJsonLine(line);
            handleParsed(parsed);
          }
          stdout = streamResult || streamText;
        } else {
          stdout += chunk;
          options.onStdout?.(chunk);
        }
      });

      child.stderr?.on("data", (data) => {
        const chunk = stripAnsi(String(data));
        stderr += chunk;
        this.output.append(chunk);
        options.onStderr?.(chunk);
      });

      child.on("error", (error) => {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        reject(
          new Error(
            `无法启动 HelionCoder CLI（${resolved.label}）：${error.message}`,
          ),
        );
      });

      child.on("close", (code) => {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }

        if (options.streamJson && streamBuffer.trim()) {
          const parsed = parseStreamJsonLine(streamBuffer);
          handleParsed(parsed);
          stdout = streamResult || streamText;
        }
        if (streamError && !stderr.trim()) {
          stderr = streamError;
        }

        if (timedOut) {
          reject(new Error(`HelionCoder 在 ${options.timeoutMs}ms 后超时。`));
          return;
        }

        if (options.cancellation?.isCancellationRequested) {
          reject(new Error("HelionCoder 请求已取消。"));
          return;
        }

        if (code !== 0) {
          const details =
            stderr.trim() ||
            stdout.trim() ||
            rawStdout.trim() ||
            `退出码 ${code}`;
          reject(new Error(`HelionCoder 运行失败：${details}`));
          return;
        }

        resolve({
          stdout,
          stderr,
          code,
          sessionId: streamSessionId,
          usage: streamUsage,
        });
      });
    });
  }

  private toResolvedCli(candidate: string, label: string): ResolvedCli {
    const expanded = expandHome(normalizeConfiguredExecutable(candidate));
    if (expanded.endsWith(".mjs")) {
      return {
        command: process.execPath,
        argsPrefix: [expanded],
        label,
      };
    }

    return {
      command: expanded,
      argsPrefix: [],
      label,
    };
  }

  private getCandidateRoots(): string[] {
    const roots = new Set<string>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.add(folder.uri.fsPath);
    }

    roots.add(path.resolve(this.context.extensionPath, ".."));
    roots.add(path.resolve(this.context.extensionPath, "..", ".."));
    roots.add(this.context.extensionPath);

    return [...roots];
  }

  private isFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private findOnPath(command: string): string | undefined {
    const pathValue = process.env.PATH;
    if (!pathValue) {
      return undefined;
    }

    const pathExts =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
        : [""];

    for (const dir of pathValue.split(path.delimiter)) {
      for (const ext of pathExts) {
        const candidate = path.join(
          dir,
          command.endsWith(ext) ? command : `${command}${ext}`,
        );
        if (this.isFile(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }
}

export function getWorkspaceCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalizeConfiguredExecutable(value: string): string {
  let normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  if (process.platform !== "win32") {
    normalized = normalized.replace(/\\([\\ "'`$&(){}[\];<>|?*!])/g, "$1");
  }

  return normalized;
}

function quoteArg(value: string): string {
  if (/^[\w./:=@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(
    value.length > 180 ? `${value.slice(0, 180)}...` : value,
  );
}

function argsContainModel(args: string[]): boolean {
  return args.some((arg) => arg === "--model" || arg.startsWith("--model="));
}

function argsContainEffort(args: string[]): boolean {
  return args.some((arg) => arg === "--effort" || arg.startsWith("--effort="));
}

function argsContainPermissionMode(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--permission-mode" || arg.startsWith("--permission-mode="),
  );
}

function argsContainThinking(args: string[]): boolean {
  return args.some(
    (arg) => arg === "--thinking" || arg.startsWith("--thinking="),
  );
}

function argsContainPlanMode(args: string[]): boolean {
  return args.some((arg) => arg === "--plan-mode-required");
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const normalized = path.resolve(item);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

interface StreamJsonParseResult {
  text?: string;
  thinking?: string;
  finalText?: string;
  errorText?: string;
  done?: boolean;
  sessionId?: string;
  usage?: TokenUsage;
  toolSteps?: ToolStepEvent[];
  sideQuestion?: SideQuestionResponse;
  permissionRequest?: PermissionRequest;
  permissionCancelRequestId?: string;
}

function parseStreamJsonLine(line: string): StreamJsonParseResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return parseStreamJsonMessage(JSON.parse(trimmed) as unknown);
  } catch {
    return {};
  }
}

function parseStreamJsonMessage(message: unknown): StreamJsonParseResult {
  const object = asRecord(message);
  if (!object) {
    return {};
  }

  const type = asString(object.type);
  if (type === "stream_event") {
    const event = asRecord(object.event);
    const usage = parseTokenUsage(
      event?.usage,
      undefined,
      asRecord(event?.message)?.usage,
    );
    const delta = asRecord(event?.delta);
    if (asString(event?.type) === "content_block_start") {
      const step = toolStepFromToolUseBlock(
        asRecord(event?.content_block),
        "started",
      );
      return {
        ...(usage ? { usage } : {}),
        ...(step ? { toolSteps: [step] } : {}),
      };
    }
    if (
      asString(event?.type) === "content_block_delta" &&
      asString(delta?.type) === "text_delta"
    ) {
      return { text: asString(delta?.text) ?? "", usage };
    }
    if (
      asString(event?.type) === "content_block_delta" &&
      asString(delta?.type) === "thinking_delta"
    ) {
      return { thinking: asString(delta?.thinking) ?? "", usage };
    }
    return usage ? { usage } : {};
  }

  if (type === "streamlined_text") {
    return { text: asString(object.text) ?? asString(object.delta) ?? "" };
  }

  if (type === "assistant") {
    const message = asRecord(object.message);
    const usage = parseTokenUsage(message?.usage);
    const steps = toolStepsFromContent(message?.content, "started");
    const thinking = thinkingFromContent(message?.content);
    return {
      ...(usage ? { usage } : {}),
      ...(steps.length > 0 ? { toolSteps: steps } : {}),
      ...(thinking ? { thinking } : {}),
    };
  }

  if (type === "user") {
    const message = asRecord(object.message);
    const steps = toolResultStepsFromContent(message?.content);
    return steps.length > 0 ? { toolSteps: steps } : {};
  }

  if (type === "tool_progress") {
    const toolUseId =
      asString(object.tool_use_id) ?? asString(object.toolUseID);
    const toolName =
      asString(object.tool_name) ?? asString(object.toolName) ?? "Tool";
    if (!toolUseId) {
      return {};
    }
    return {
      toolSteps: [
        {
          id: toolUseId,
          toolName,
          status: "running",
          label: toolName,
          detail: formatElapsed(asNumber(object.elapsed_time_seconds)),
          elapsedSeconds: asNumber(object.elapsed_time_seconds),
        },
      ],
    };
  }

  if (type === "streamlined_tool_use_summary") {
    const summary = asString(object.tool_summary);
    return summary
      ? {
          toolSteps: [
            {
              id: asString(object.uuid) ?? `summary-${summary}`,
              toolName: "Summary",
              status: "completed",
              label: "工具汇总",
              detail: summary,
            },
          ],
        }
      : {};
  }

  if (type === "tool_use_summary") {
    const summary = asString(object.summary);
    return summary
      ? {
          toolSteps: [
            {
              id: asString(object.uuid) ?? `summary-${summary}`,
              toolName: "Summary",
              status: "completed",
              label: "工具汇总",
              detail: summary,
            },
          ],
        }
      : {};
  }

  if (type === "system" && asString(object.subtype) === "status") {
    const status = asString(object.status);
    if (status === "compacting") {
      return {
        toolSteps: [
          {
            id: asString(object.uuid) ?? "status-compacting",
            toolName: "Status",
            status: "status",
            label: "压缩上下文",
            detail: "正在整理上下文窗口后继续",
          },
        ],
      };
    }
  }

  if (type === "result") {
    const errors = asStringArray(object.errors);
    const base = {
      sessionId: asString(object.session_id),
      usage: parseTokenUsage(object.usage, asNumber(object.total_cost_usd)),
    };
    if (errors.length > 0) {
      return { ...base, errorText: errors.join("\n"), done: true };
    }
    if (asString(object.subtype) === "success") {
      return { ...base, finalText: asString(object.result) ?? "", done: true };
    }
    return { ...base, done: true };
  }

  if (type === "control_response") {
    const response = asRecord(object.response);
    const requestId = asString(response?.request_id);
    if (!requestId) {
      return {};
    }

    if (asString(response?.subtype) === "error") {
      return {
        sideQuestion: {
          requestId,
          error: asString(response?.error) ?? "支线问题执行失败。",
        },
      };
    }

    const payload = asRecord(response?.response);
    return {
      sideQuestion: {
        requestId,
        response: asString(payload?.response) ?? "",
      },
    };
  }

  if (type === "control_request") {
    const requestId = asString(object.request_id);
    const request = asRecord(object.request);
    if (!requestId || !request) {
      return {};
    }
    if (asString(request.subtype) === "can_use_tool") {
      return {
        permissionRequest: {
          requestId,
          toolName: asString(request.tool_name) ?? "Tool",
          input: asRecord(request.input) ?? {},
          toolUseId: asString(request.tool_use_id) ?? "",
          description: asString(request.description),
          blockedPath: asString(request.blocked_path),
          permissionSuggestions: Array.isArray(request.permission_suggestions)
            ? request.permission_suggestions
            : undefined,
        },
      };
    }
  }

  if (type === "control_cancel_request") {
    const requestId = asString(object.request_id);
    return requestId ? { permissionCancelRequestId: requestId } : {};
  }

  return {};
}

function toolStepsFromContent(
  content: unknown,
  status: ToolStepStatus,
): ToolStepEvent[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .map((block) => toolStepFromToolUseBlock(asRecord(block), status))
    .filter((step): step is ToolStepEvent => Boolean(step));
}

function thinkingFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .map((block) => {
      const record = asRecord(block);
      return asString(record?.type) === "thinking"
        ? (asString(record?.thinking) ?? "")
        : "";
    })
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

function toolResultStepsFromContent(content: unknown): ToolStepEvent[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const steps: ToolStepEvent[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record || asString(record.type) !== "tool_result") {
      continue;
    }
    const id = asString(record.tool_use_id);
    if (!id) {
      continue;
    }
    steps.push({
      id,
      toolName: "Tool",
      status: record.is_error === true ? "failed" : "completed",
      label: record.is_error === true ? "执行失败" : "执行完成",
      detail: summarizeToolResult(record.content),
    });
  }
  return steps;
}

function toolStepFromToolUseBlock(
  block: Record<string, unknown> | undefined,
  status: ToolStepStatus,
): ToolStepEvent | undefined {
  if (!block || asString(block.type) !== "tool_use") {
    return undefined;
  }

  const id = asString(block.id);
  if (!id) {
    return undefined;
  }

  const toolName = asString(block.name) ?? "Tool";
  const input = asRecord(block.input) ?? {};
  const metadata = toolMetadata(toolName, input);
  return {
    id,
    toolName,
    status,
    label: metadata.label,
    detail: metadata.detail,
    filePath: metadata.filePath,
    lineStart: metadata.lineStart,
    lineEnd: metadata.lineEnd,
    input,
  };
}

function toolMetadata(
  toolName: string,
  input: Record<string, unknown>,
): Pick<
  ToolStepEvent,
  "label" | "detail" | "filePath" | "lineStart" | "lineEnd"
> {
  const filePath = firstString(input.file_path, input.filePath, input.path);
  const absoluteFilePath = filePath
    ? normalizeToolFilePath(filePath)
    : undefined;
  const offset = firstNumber(input.offset, input.start_line, input.startLine);
  const limit = firstNumber(input.limit, input.line_count, input.lineCount);
  const lineStart = offset;
  const lineEnd =
    offset !== undefined && limit !== undefined
      ? offset + Math.max(0, limit - 1)
      : undefined;

  if (/^read$/i.test(toolName) && absoluteFilePath) {
    const readLineStart = lineStart ?? (limit !== undefined ? 1 : undefined);
    const readLineEnd =
      readLineStart !== undefined && limit !== undefined
        ? readLineStart + Math.max(0, limit - 1)
        : lineEnd;
    return {
      label: "Read",
      detail: lineRangeDetail(readLineStart, readLineEnd),
      filePath: absoluteFilePath,
      lineStart: readLineStart,
      lineEnd: readLineEnd,
    };
  }

  if (
    /^(edit|write|multiedit|notebookedit)$/i.test(toolName) &&
    absoluteFilePath
  ) {
    return {
      label: toolDisplayName(toolName),
      detail: undefined,
      filePath: absoluteFilePath,
      lineStart,
      lineEnd,
    };
  }

  if (/^(grep|glob|search)$/i.test(toolName)) {
    const pattern = firstString(input.pattern, input.query);
    const basePath = firstString(input.path);
    return {
      label: toolDisplayName(toolName),
      detail: [
        pattern ? `pattern: ${pattern}` : undefined,
        basePath ? `path: ${path.basename(basePath) || basePath}` : undefined,
      ]
        .filter(Boolean)
        .join(", "),
      filePath:
        absoluteFilePath && isProbablyFilePath(absoluteFilePath)
          ? absoluteFilePath
          : undefined,
    };
  }

  if (/^(bash|powershell)$/i.test(toolName)) {
    const command = firstString(input.command, input.script);
    return {
      label: toolDisplayName(toolName),
      detail: command ? truncateMiddle(command, 96) : undefined,
    };
  }

  return {
    label: toolDisplayName(toolName),
    detail: compactInputDetail(input),
    filePath:
      absoluteFilePath && isProbablyFilePath(absoluteFilePath)
        ? absoluteFilePath
        : undefined,
    lineStart,
    lineEnd,
  };
}

function toolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    read: "Read",
    edit: "Edit",
    multiedit: "MultiEdit",
    write: "Write",
    notebookedit: "NotebookEdit",
    grep: "Search",
    glob: "Search",
    search: "Search",
    bash: "Bash",
    powershell: "PowerShell",
  };
  return names[toolName.toLowerCase()] ?? toolName;
}

function normalizeToolFilePath(filePath: string): string {
  const expanded = expandHome(filePath);
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(getWorkspaceCwd(), expanded);
}

function isProbablyFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return Boolean(path.extname(filePath));
  }
}

function lineRangeDetail(
  start: number | undefined,
  end: number | undefined,
): string | undefined {
  if (start === undefined) {
    return undefined;
  }
  return end === undefined ? `${start} 行起` : `${start}~${end} 行`;
}

function compactInputDetail(
  input: Record<string, unknown>,
): string | undefined {
  const preferred = firstString(
    input.pattern,
    input.query,
    input.command,
    input.description,
  );
  if (preferred) {
    return truncateMiddle(preferred, 96);
  }
  return undefined;
}

function summarizeToolResult(content: unknown): string | undefined {
  const text =
    typeof content === "string" ? content : textFromToolResultContent(content);
  if (!text) {
    return undefined;
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  return firstLine ? truncateMiddle(firstLine.trim(), 120) : undefined;
}

function textFromToolResultContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      const record = asRecord(item);
      return asString(record?.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatElapsed(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `已运行 ${Math.round(value)} 秒`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return undefined;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.ceil((maxLength - 1) * 0.62);
  const tail = Math.max(8, maxLength - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseTokenUsage(
  value: unknown,
  totalCostUsd?: number,
  fallback?: unknown,
): TokenUsage | undefined {
  const usage = asRecord(value) ?? asRecord(fallback);
  if (!usage && totalCostUsd === undefined) {
    return undefined;
  }

  const inputTokens = asNumber(usage?.input_tokens);
  const outputTokens = asNumber(usage?.output_tokens);
  const cacheCreationInputTokens = asNumber(usage?.cache_creation_input_tokens);
  const cacheReadInputTokens = asNumber(usage?.cache_read_input_tokens);
  const totalTokens =
    asNumber(usage?.total_tokens) ??
    [inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens]
      .filter((item): item is number => item !== undefined)
      .reduce((sum, item) => sum + item, 0);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    totalTokens === 0 &&
    totalCostUsd === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
    totalCostUsd,
  };
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
