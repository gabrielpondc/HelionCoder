import * as vscode from 'vscode';
import { HelionCli, getWorkspaceCwd } from './cli';
import { getEditorSnapshot } from './editorContext';

export class HelionInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  constructor(private readonly cli: HelionCli) {}

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
    const snapshot = getEditorSnapshot(maxPrefixChars, maxSuffixChars);
    if (!snapshot || snapshot.filePath !== document.uri.fsPath) {
      return undefined;
    }

    const prompt = buildCompletionPrompt(snapshot);
    const timeoutMs = config.get<number>('timeoutMs', 15000);

    try {
      const result = await this.cli.runPrompt(prompt, {
        cwd: getWorkspaceCwd(),
        timeoutMs,
        cancellation: token,
      });
      const insertText = sanitizeCompletion(result.stdout);
      if (!insertText) {
        return undefined;
      }

      return [
        new vscode.InlineCompletionItem(
          insertText,
          new vscode.Range(position, position),
          {
            title: 'Accept Helion Completion',
            command: 'editor.action.inlineSuggest.commit',
          },
        ),
      ];
    } catch (error) {
      if (!token.isCancellationRequested) {
        console.warn(error);
      }
      return undefined;
    }
  }
}

function buildCompletionPrompt(snapshot: ReturnType<typeof getEditorSnapshot> & {}): string {
  return [
    'You are an inline code completion engine inside VS Code.',
    'Return only the exact code text to insert at <CURSOR>.',
    'Do not include markdown fences, prose, explanations, quotes, or placeholders.',
    'If no useful completion is possible, return an empty response.',
    `File: ${snapshot.relativePath}`,
    `Language: ${snapshot.languageId}`,
    '',
    'Code before cursor:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.prefix,
    '<CURSOR>',
    '```',
    '',
    'Code after cursor:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.suffix,
    '```',
  ].join('\n');
}

function sanitizeCompletion(value: string): string | undefined {
  let result = value.replace(/\r\n/g, '\n').trim();

  const fenced = result.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  if (fenced) {
    result = fenced[1];
  }

  result = result
    .replace(/^Here is (the )?(completion|code):\s*/i, '')
    .replace(/^Completion:\s*/i, '');

  if (/^(no completion|none|n\/a)$/i.test(result.trim())) {
    return undefined;
  }

  if (result.length > 4000) {
    result = result.slice(0, 4000);
  }

  return result.length > 0 ? result : undefined;
}
