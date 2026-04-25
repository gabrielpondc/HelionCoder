import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceCwd } from './cli';

export interface EditorSnapshot {
  filePath: string;
  relativePath: string;
  languageId: string;
  selection: string;
  cursorLine: number;
  currentLine: string;
  prefix: string;
  suffix: string;
}

export function getEditorSnapshot(
  maxPrefixChars = 5000,
  maxSuffixChars = 2000,
): EditorSnapshot | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const { document, selection } = editor;
  if (document.uri.scheme !== 'file') {
    return undefined;
  }

  const cursor = selection.active;
  const start = new vscode.Position(0, 0);
  const end = document.lineAt(document.lineCount - 1).range.end;
  const prefix = trimStartByChars(
    document.getText(new vscode.Range(start, cursor)),
    maxPrefixChars,
  );
  const suffix = trimEndByChars(
    document.getText(new vscode.Range(cursor, end)),
    maxSuffixChars,
  );
  const cwd = getWorkspaceCwd();
  const filePath = document.uri.fsPath;

  return {
    filePath,
    relativePath: path.relative(cwd, filePath) || path.basename(filePath),
    languageId: document.languageId,
    selection: document.getText(selection),
    cursorLine: cursor.line + 1,
    currentLine: document.lineAt(cursor.line).text,
    prefix,
    suffix,
  };
}

export function buildContextPrompt(userPrompt: string, purpose: string): string {
  const includeContext = vscode.workspace
    .getConfiguration('helionCoder.webview')
    .get<boolean>('includeEditorContext', true);
  const snapshot = includeContext ? getEditorSnapshot(6000, 2500) : undefined;

  if (!snapshot) {
    return userPrompt;
  }

  const selectionBlock = snapshot.selection
    ? `\nSelected text:\n\`\`\`${snapshot.languageId}\n${snapshot.selection}\n\`\`\`\n`
    : '';

  return [
    `You are HelionCoder running inside VS Code. Task purpose: ${purpose}.`,
    `Active file: ${snapshot.relativePath}`,
    `Language: ${snapshot.languageId}`,
    `Cursor line: ${snapshot.cursorLine}`,
    `Current line: ${snapshot.currentLine}`,
    selectionBlock,
    'Nearby code before cursor:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.prefix,
    '```',
    'Nearby code after cursor:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.suffix,
    '```',
    'User request:',
    userPrompt,
  ].join('\n');
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
