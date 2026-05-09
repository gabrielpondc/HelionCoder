import * as vscode from 'vscode';
import * as path from 'path';
import { HelionCli, getWorkspaceCwd } from './cli';

export const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';
export const SUPPORTED_COMPLETION_SCHEMES = new Set([
  'file',
  'untitled',
  NOTEBOOK_CELL_SCHEME,
]);

interface CompletionSnapshot {
  filePath: string;
  relativePath: string;
  languageId: string;
  cursorLine: number;
  cursorCharacter: number;
  currentLine: string;
  linePrefix: string;
  prefix: string;
  suffix: string;
}

export class HelionInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private hideStatusTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly cli: HelionCli,
    private readonly output: vscode.OutputChannel,
    private readonly status: vscode.StatusBarItem,
    private readonly restoreStatus: () => void,
  ) {}

  dispose(): void {
    this.clearStatusTimer();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    const config = vscode.workspace.getConfiguration('helionCoder.completion');
    const triggerKind = inlineTriggerKindName(context.triggerKind);
    const debug = config.get<boolean>('debug', false);
    const shouldLogSkip =
      debug || context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;

    const skip = (reason: string): undefined => {
      if (shouldLogSkip) {
        this.output.appendLine(
          `[completion] skipped: ${reason}; language=${document.languageId}; scheme=${document.uri.scheme}; trigger=${triggerKind}; uri=${document.uri.toString()}`,
        );
      }
      return undefined;
    };

    if (!config.get<boolean>('enabled', true)) {
      return skip('disabled by helionCoder.completion.enabled');
    }

    const triggerMode = config.get<'manual' | 'automatic'>('triggerMode', 'automatic');
    if (
      triggerMode === 'manual' &&
      context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke
    ) {
      return skip('trigger mode is manual');
    }

    if (!isSupportedCompletionDocument(document)) {
      return skip('unsupported document scheme');
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (
      triggerMode === 'automatic' &&
      context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke &&
      linePrefix.trim().length < 2
    ) {
      return skip('automatic trigger ignored because line prefix is too short');
    }

    const maxPrefixChars = config.get<number>('maxPrefixChars', 5000);
    const maxSuffixChars = config.get<number>('maxSuffixChars', 2000);
    const snapshot = getCompletionSnapshot(document, position, maxPrefixChars, maxSuffixChars);

    const prompt = buildCompletionPrompt(snapshot);
    const timeoutMs = config.get<number>('timeoutMs', 15000);
    const cwd = getCompletionCwd(document);

    try {
      this.output.appendLine(
        `[completion] request: language=${document.languageId}; scheme=${document.uri.scheme}; trigger=${triggerKind}; cwd=${cwd}; line=${position.line + 1}; character=${position.character + 1}`,
      );
      this.showStatus('$(sync~spin) Helion 补全中...', 0);
      const result = await this.cli.runPrompt(prompt, {
        cwd,
        timeoutMs,
        cancellation: token,
        permissionMode: 'dontAsk',
      });
      const insertText = sanitizeCompletion(result.stdout, snapshot);
      if (!insertText) {
        this.output.appendLine('[completion] no suggestion returned');
        this.showStatus('Helion 没有补全建议', 2200);
        return undefined;
      }

      this.output.appendLine(`[completion] suggestion ready: ${insertText.length} chars`);
      this.showStatus('$(check) Helion 补全已生成', 2200);
      return [
        new vscode.InlineCompletionItem(
          insertText,
          new vscode.Range(position, position),
        ),
      ];
    } catch (error) {
      if (!token.isCancellationRequested) {
        console.warn(error);
        this.output.appendLine(
          `[completion] failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.showStatus('Helion 补全失败', 2600);
      } else {
        this.output.appendLine('[completion] canceled');
        this.restoreStatus();
      }
      return undefined;
    }
  }

  private showStatus(text: string, hideAfterMs: number): void {
    this.clearStatusTimer();
    this.status.text = text;
    this.status.tooltip = '来自 HelionCoder 的编辑器行内补全';
    this.status.show();
    if (hideAfterMs > 0) {
      this.hideStatusTimer = setTimeout(() => {
        this.hideStatusTimer = undefined;
        this.restoreStatus();
      }, hideAfterMs);
    }
  }

  private clearStatusTimer(): void {
    if (this.hideStatusTimer) {
      clearTimeout(this.hideStatusTimer);
      this.hideStatusTimer = undefined;
    }
  }
}

function getCompletionSnapshot(
  document: vscode.TextDocument,
  position: vscode.Position,
  maxPrefixChars: number,
  maxSuffixChars: number,
): CompletionSnapshot {
  const start = new vscode.Position(0, 0);
  const end = document.lineAt(document.lineCount - 1).range.end;
  const filePath = getCompletionFilePath(document);
  const workspaceRoot = getCompletionWorkspaceRoot(document) ?? path.dirname(filePath);
  const prefix = trimStartByChars(
    document.getText(new vscode.Range(start, position)),
    maxPrefixChars,
  );
  const suffix = trimEndByChars(
    document.getText(new vscode.Range(position, end)),
    maxSuffixChars,
  );

  return {
    filePath,
    relativePath: path.relative(workspaceRoot, filePath) || path.basename(filePath),
    languageId: document.languageId,
    cursorLine: position.line + 1,
    cursorCharacter: position.character + 1,
    currentLine: document.lineAt(position.line).text,
    linePrefix: document.lineAt(position.line).text.slice(0, position.character),
    prefix,
    suffix,
  };
}

export function isSupportedCompletionDocument(document: vscode.TextDocument): boolean {
  return SUPPORTED_COMPLETION_SCHEMES.has(document.uri.scheme);
}

export function getCompletionCwd(document: vscode.TextDocument): string {
  const workspaceRoot = getCompletionWorkspaceRoot(document);
  if (workspaceRoot) {
    return workspaceRoot;
  }

  const filePath = getCompletionFilePath(document);
  return filePath ? path.dirname(filePath) : getWorkspaceCwd();
}

function getCompletionWorkspaceRoot(document: vscode.TextDocument): string | undefined {
  const directWorkspace = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  if (directWorkspace) {
    return directWorkspace;
  }

  const filePath = getCompletionFilePath(document);
  const fileWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
  return fileWorkspace;
}

function getCompletionFilePath(document: vscode.TextDocument): string {
  return document.uri.fsPath || document.fileName;
}

function inlineTriggerKindName(kind: vscode.InlineCompletionTriggerKind): string {
  return kind === vscode.InlineCompletionTriggerKind.Invoke ? 'invoke' : 'automatic';
}

function buildCompletionPrompt(snapshot: CompletionSnapshot): string {
  return [
    'Task: /complete inline code completion.',
    'You are HelionCoder running as a VS Code inline completion engine.',
    'Return only the exact code text to insert at <CURSOR>.',
    'Do not include markdown fences, prose, explanations, quotes, or placeholders.',
    'Do not repeat any code that already appears before <CURSOR>.',
    'Do not repeat any code that already appears after <CURSOR>.',
    'Preserve the correct indentation for the inserted text.',
    'If no useful completion is possible, return an empty response.',
    `File: ${snapshot.relativePath}`,
    `Language: ${snapshot.languageId}`,
    `Cursor: line ${snapshot.cursorLine}, character ${snapshot.cursorCharacter}`,
    `Current line: ${snapshot.currentLine}`,
    `Current line before cursor: ${snapshot.linePrefix}`,
    '',
    'Nearby code with cursor marker:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.prefix,
    '<CURSOR>',
    snapshot.suffix,
    '```',
  ].join('\n');
}

function sanitizeCompletion(
  value: string,
  snapshot: CompletionSnapshot,
): string | undefined {
  let result = value.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');

  const fenced = result.trim().match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  if (fenced) {
    result = fenced[1];
  }

  result = result
    .replace(/^\s*Here is (the )?(completion|code):\s*/i, '')
    .replace(/^\s*Completion:\s*/i, '')
    .replace(/^\s*Insert:\s*/i, '')
    .replace(/^\s*<CURSOR>/i, '');

  result = result.replace(/^\n+/, '').replace(/\n+$/, '');
  result = removePrefixOverlap(snapshot.prefix, result);
  result = removeSuffixOverlap(result, snapshot.suffix);

  if (/^(no completion|none|n\/a)$/i.test(result.trim())) {
    return undefined;
  }

  if (result.length > 4000) {
    result = result.slice(0, 4000);
  }

  return result.trim().length > 0 ? result : undefined;
}

function removePrefixOverlap(prefix: string, completion: string): string {
  const max = Math.min(prefix.length, completion.length, 2000);
  for (let length = max; length > 0; length -= 1) {
    if (prefix.endsWith(completion.slice(0, length))) {
      return completion.slice(length);
    }
  }
  return completion;
}

function removeSuffixOverlap(completion: string, suffix: string): string {
  const max = Math.min(completion.length, suffix.length, 1000);
  for (let length = max; length > 0; length -= 1) {
    if (completion.endsWith(suffix.slice(0, length))) {
      return completion.slice(0, -length);
    }
  }
  return completion;
}

function trimStartByChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(value.length - maxChars);
}

function trimEndByChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}
