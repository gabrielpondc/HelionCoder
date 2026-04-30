import * as vscode from 'vscode';
import * as path from 'path';
import { HelionCli, getWorkspaceCwd } from './cli';

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
    if (!config.get<boolean>('enabled', true)) {
      return undefined;
    }

    const triggerMode = config.get<'manual' | 'automatic'>('triggerMode', 'manual');
    if (
      triggerMode === 'manual' &&
      context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke
    ) {
      return undefined;
    }

    if (document.uri.scheme !== 'file') {
      return undefined;
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (triggerMode === 'automatic' && linePrefix.trim().length < 2) {
      return undefined;
    }

    const maxPrefixChars = config.get<number>('maxPrefixChars', 5000);
    const maxSuffixChars = config.get<number>('maxSuffixChars', 2000);
    const snapshot = getCompletionSnapshot(document, position, maxPrefixChars, maxSuffixChars);

    const prompt = buildCompletionPrompt(snapshot);
    const timeoutMs = config.get<number>('timeoutMs', 15000);
    const cwd = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? getWorkspaceCwd();

    try {
      this.showStatus('$(sync~spin) Helion 补全中...', 0);
      const result = await this.cli.runPrompt(prompt, {
        cwd,
        timeoutMs,
        cancellation: token,
        permissionMode: 'dontAsk',
      });
      const insertText = sanitizeCompletion(result.stdout, snapshot);
      if (!insertText) {
        this.showStatus('Helion 没有补全建议', 2200);
        return undefined;
      }

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
        this.showStatus('Helion 补全失败', 2600);
      } else {
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
  const workspaceRoot =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? getWorkspaceCwd();
  const filePath = document.uri.fsPath;
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
