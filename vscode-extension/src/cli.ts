import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ResolvedCli {
  command: string;
  argsPrefix: string[];
  label: string;
}

export interface RunPromptOptions {
  cwd?: string;
  timeoutMs?: number;
  cancellation?: vscode.CancellationToken;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunPromptResult {
  stdout: string;
  stderr: string;
  code: number | null;
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
      .getConfiguration('helionCoder')
      .get<string>('executablePath', '')
      .trim();

    if (configured.length > 0) {
      return this.toResolvedCli(configured, '已配置的可执行文件');
    }

    const roots = this.getCandidateRoots();
    const executableName = process.platform === 'win32' ? 'helion-coder.exe' : 'helion-coder';

    for (const root of roots) {
      const nativeCandidate = path.join(root, 'dist', executableName);
      if (this.isFile(nativeCandidate)) {
        return this.toResolvedCli(nativeCandidate, '工作区 dist 可执行文件');
      }

      const moduleCandidate = path.join(root, 'dist', 'cli.mjs');
      if (this.isFile(moduleCandidate)) {
        return this.toResolvedCli(moduleCandidate, '工作区 dist 模块');
      }

      const packagedNative = path.join(root, 'bin', executableName);
      if (this.isFile(packagedNative)) {
        return this.toResolvedCli(packagedNative, '已打包可执行文件');
      }

      const packagedModule = path.join(root, 'bin', 'cli.mjs');
      if (this.isFile(packagedModule)) {
        return this.toResolvedCli(packagedModule, '已打包模块');
      }
    }

    const fromPath = this.findOnPath(executableName) ?? this.findOnPath('helion-coder');
    if (fromPath) {
      return this.toResolvedCli(fromPath, 'PATH 中的可执行文件');
    }

    return {
      command: 'helion-coder',
      argsPrefix: [],
      label: 'PATH 中的 helion-coder',
    };
  }

  async runPrompt(prompt: string, options: RunPromptOptions = {}): Promise<RunPromptResult> {
    const resolved = await this.resolve();
    const config = vscode.workspace.getConfiguration('helionCoder');
    const defaultArgs = config.get<string[]>('defaultArgs', [
      '--bare',
      '--no-session-persistence',
    ]);
    const selectedModel = config.get<string>('model', '').trim();
    const selectedEffort = config.get<string>('effort', '').trim();
    const modelArgs =
      selectedModel && !argsContainModel(defaultArgs)
        ? ['--model', selectedModel]
        : [];
    const effortArgs =
      selectedEffort && !argsContainEffort(defaultArgs)
        ? ['--effort', selectedEffort]
        : [];
    const args = [
      ...resolved.argsPrefix,
      ...defaultArgs,
      ...modelArgs,
      ...effortArgs,
      '-p',
      '--output-format',
      'text',
      prompt,
    ];
    const cwd = options.cwd ?? getWorkspaceCwd();

    this.output.appendLine(`$ ${resolved.command} ${args.map(quoteArg).join(' ')}`);
    this.output.appendLine(`工作目录：${cwd}`);

    return await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined;

      const child = spawn(resolved.command, args, {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          TERM: process.env.TERM ?? 'xterm-256color',
        },
        shell: false,
      });

      const cancel = () => {
        if (settled) {
          return;
        }
        child.kill('SIGTERM');
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

      child.stdout.on('data', data => {
        const chunk = stripAnsi(String(data));
        stdout += chunk;
        this.output.append(chunk);
        options.onStdout?.(chunk);
      });

      child.stderr.on('data', data => {
        const chunk = stripAnsi(String(data));
        stderr += chunk;
        this.output.append(chunk);
        options.onStderr?.(chunk);
      });

      child.on('error', error => {
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

      child.on('close', code => {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }

        if (timedOut) {
          reject(new Error(`HelionCoder 在 ${options.timeoutMs}ms 后超时。`));
          return;
        }

        if (options.cancellation?.isCancellationRequested) {
          reject(new Error('HelionCoder 请求已取消。'));
          return;
        }

        if (code !== 0) {
          const details = stderr.trim() || stdout.trim() || `退出码 ${code}`;
          reject(new Error(`HelionCoder 运行失败：${details}`));
          return;
        }

        resolve({
          stdout,
          stderr,
          code,
        });
      });
    });
  }

  private toResolvedCli(candidate: string, label: string): ResolvedCli {
    const expanded = expandHome(candidate);
    if (expanded.endsWith('.mjs')) {
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

    roots.add(path.resolve(this.context.extensionPath, '..'));
    roots.add(path.resolve(this.context.extensionPath, '..', '..'));
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
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
        : [''];

    for (const dir of pathValue.split(path.delimiter)) {
      for (const ext of pathExts) {
        const candidate = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
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
  return value.replace(ANSI_PATTERN, '');
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function quoteArg(value: string): string {
  if (/^[\w./:=@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value.length > 180 ? `${value.slice(0, 180)}...` : value);
}

function argsContainModel(args: string[]): boolean {
  return args.some(arg => arg === '--model' || arg.startsWith('--model='));
}

function argsContainEffort(args: string[]): boolean {
  return args.some(arg => arg === '--effort' || arg.startsWith('--effort='));
}
