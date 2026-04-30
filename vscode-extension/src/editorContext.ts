import * as path from 'path';
import * as fs from 'fs';
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
  const mentionContext = buildMentionContext(userPrompt, {
    compact: false,
    maxFileChars: 8000,
    maxTotalFileChars: 18000,
    maxWorkspaceEntries: 700,
    maxWorkspaceDepth: 4,
  });

  if (!snapshot) {
    return [
      'You are HelionCoder running inside VS Code.',
      workspaceEditInstruction(),
      mentionContext,
      'User request:',
      userPrompt,
    ].filter(Boolean).join('\n');
  }

  const selectionBlock = snapshot.selection
    ? `\nSelected text:\n\`\`\`${snapshot.languageId}\n${snapshot.selection}\n\`\`\`\n`
    : '';

  return [
    `You are HelionCoder running inside VS Code. Task purpose: ${purpose}.`,
    workspaceEditInstruction(),
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
    mentionContext,
    'User request:',
    userPrompt,
  ].filter(Boolean).join('\n');
}

export function buildCompactedContextPrompt(userPrompt: string, purpose: string): string {
  const includeContext = vscode.workspace
    .getConfiguration('helionCoder.webview')
    .get<boolean>('includeEditorContext', true);
  const snapshot = includeContext ? getEditorSnapshot(1800, 700) : undefined;
  const mentionContext = buildMentionContext(userPrompt, {
    compact: true,
    maxFileChars: 2200,
    maxTotalFileChars: 7000,
    maxWorkspaceEntries: 220,
    maxWorkspaceDepth: 3,
  });

  if (!snapshot) {
    return [
      'You are HelionCoder running inside VS Code.',
      'The previous request exceeded the model context limit, so continue with a compact prompt.',
      workspaceEditInstruction(),
      `Task purpose: ${purpose}.`,
      mentionContext,
      'User request:',
      userPrompt,
    ].filter(Boolean).join('\n');
  }

  const selection = trimMiddleByChars(snapshot.selection, 4200);
  const selectionBlock = selection
    ? `\nSelected text, compacted if needed:\n\`\`\`${snapshot.languageId}\n${selection}\n\`\`\`\n`
    : '';

  return [
    'You are HelionCoder running inside VS Code.',
    'The previous request exceeded the model context limit. Continue with this compacted context.',
    'Preserve the user intent, avoid asking the user to retry, and state any assumptions caused by compaction.',
    workspaceEditInstruction(),
    `Task purpose: ${purpose}.`,
    `Active file: ${snapshot.relativePath}`,
    `Language: ${snapshot.languageId}`,
    `Cursor line: ${snapshot.cursorLine}`,
    `Current line: ${snapshot.currentLine}`,
    selectionBlock,
    'Nearby code before cursor, compacted:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.prefix,
    '```',
    'Nearby code after cursor, compacted:',
    `\`\`\`${snapshot.languageId}`,
    snapshot.suffix,
    '```',
    mentionContext,
    'User request:',
    userPrompt,
  ].filter(Boolean).join('\n');
}

function workspaceEditInstruction(): string {
  return [
    'When the user asks you to implement, modify, fix, refactor, document, configure, or otherwise change code, edit the actual workspace files directly.',
    'If the user asks you to write or create a code artifact but does not name a target file, choose a sensible file path in the current workspace and create or update that file.',
    'Do not answer with standalone code blocks for requested implementation work unless the user explicitly asks for an example, explanation-only answer, or a patch to apply manually.',
    'Do not say that you added, created, saved, or updated code unless you actually changed a workspace file.',
    'If you cannot determine a safe target file, ask one concise question instead of returning a full code block.',
    'After editing files, summarize what changed and how to verify it.',
  ].join(' ');
}

interface MentionContextOptions {
  compact: boolean;
  maxFileChars: number;
  maxTotalFileChars: number;
  maxWorkspaceEntries: number;
  maxWorkspaceDepth: number;
}

function buildMentionContext(
  userPrompt: string,
  options: MentionContextOptions,
): string {
  const references = parseMentionReferences(userPrompt);
  const blocks: string[] = [];

  if (references.selection) {
    const snapshot = getEditorSnapshot(
      options.compact ? 1200 : 3000,
      options.compact ? 500 : 1200,
    );
    const selection = snapshot?.selection.trim();
    if (snapshot && selection) {
      blocks.push(
        [
          'Referenced selection:',
          `File: ${snapshot.relativePath}`,
          `\`\`\`${snapshot.languageId}`,
          trimMiddleByChars(selection, options.compact ? 2200 : 7000),
          '```',
        ].join('\n'),
      );
    } else {
      blocks.push('Referenced selection: no active editor selection was available.');
    }
  }

  let usedFileChars = 0;
  for (const ref of references.files) {
    if (usedFileChars >= options.maxTotalFileChars) {
      blocks.push('Referenced files: additional files omitted because the context budget is full.');
      break;
    }

    const resolved = resolveWorkspacePath(ref);
    if (!resolved || !isReadableFile(resolved.fsPath)) {
      blocks.push(`Referenced file ${ref}: not found or not readable.`);
      continue;
    }

    const remaining = options.maxTotalFileChars - usedFileChars;
    const limit = Math.min(options.maxFileChars, remaining);
    const text = trimMiddleByChars(fs.readFileSync(resolved.fsPath, 'utf8'), limit);
    usedFileChars += text.length;
    blocks.push(
      [
        `Referenced file: ${resolved.label}`,
        '```',
        text,
        '```',
      ].join('\n'),
    );
  }

  for (const ref of references.workspaces) {
    const resolved = resolveWorkspacePath(ref);
    if (!resolved || !isReadableDirectory(resolved.fsPath)) {
      blocks.push(`Referenced workspace ${ref}: not found or not readable.`);
      continue;
    }

    blocks.push(
      [
        `Referenced workspace tree: ${resolved.label}`,
        '```text',
        listWorkspaceTree(resolved.fsPath, {
          maxEntries: options.maxWorkspaceEntries,
          maxDepth: options.maxWorkspaceDepth,
        }),
        '```',
      ].join('\n'),
    );
  }

  if (blocks.length === 0) {
    return '';
  }

  return ['Explicit @ context references:', ...blocks].join('\n');
}

function parseMentionReferences(userPrompt: string): {
  files: string[];
  workspaces: string[];
  selection: boolean;
} {
  const files = new Set<string>();
  const workspaces = new Set<string>();
  const pattern = /@(file|workspace)\("((?:\\.|[^"\\])*)"\)|@selection\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(userPrompt)) !== null) {
    if (match[0] === '@selection') {
      continue;
    }
    const kind = match[1];
    const value = unescapeMentionPath(match[2]);
    if (kind === 'file') {
      files.add(value);
    } else if (kind === 'workspace') {
      workspaces.add(value);
    }
  }

  return {
    files: [...files],
    workspaces: [...workspaces],
    selection: /@selection\b/.test(userPrompt),
  };
}

function resolveWorkspacePath(ref: string): { fsPath: string; label: string } | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const cwd = getWorkspaceCwd();
  const candidates: string[] = [];

  if (ref === '.') {
    candidates.push(cwd);
  } else if (path.isAbsolute(ref)) {
    candidates.push(ref);
  } else {
    candidates.push(path.resolve(cwd, ref));
    for (const folder of workspaceFolders) {
      candidates.push(path.resolve(folder.uri.fsPath, ref));
      if (ref === folder.name || ref.startsWith(`${folder.name}/`)) {
        candidates.push(path.resolve(folder.uri.fsPath, ref.slice(folder.name.length + 1)));
      }
    }
  }

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (!isInsideWorkspace(normalized)) {
      continue;
    }
    if (fs.existsSync(normalized)) {
      return {
        fsPath: normalized,
        label: displayWorkspacePath(normalized),
      };
    }
  }

  return undefined;
}

function isInsideWorkspace(fsPath: string): boolean {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  if (roots.length === 0) {
    roots.push(getWorkspaceCwd());
  }

  return roots.some(root => {
    const relative = path.relative(root, fsPath);
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

function displayWorkspacePath(fsPath: string): string {
  const roots = vscode.workspace.workspaceFolders ?? [];
  for (const root of roots) {
    const relative = path.relative(root.uri.fsPath, fsPath);
    if (!relative) {
      return root.name;
    }
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizeSlashes(relative);
    }
  }

  const relative = path.relative(getWorkspaceCwd(), fsPath);
  return relative && !relative.startsWith('..') ? normalizeSlashes(relative) : fsPath;
}

function isReadableFile(fsPath: string): boolean {
  try {
    const stat = fs.statSync(fsPath);
    return stat.isFile() && stat.size <= 1_000_000 && !looksBinary(fsPath);
  } catch {
    return false;
  }
}

function isReadableDirectory(fsPath: string): boolean {
  try {
    return fs.statSync(fsPath).isDirectory();
  } catch {
    return false;
  }
}

function listWorkspaceTree(
  root: string,
  options: { maxEntries: number; maxDepth: number },
): string {
  const lines: string[] = [];
  let omitted = 0;

  function visit(dir: string, depth: number): void {
    if (lines.length >= options.maxEntries || depth > options.maxDepth) {
      omitted += 1;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      omitted += 1;
      return;
    }

    entries
      .filter(entry => !shouldIgnoreEntry(entry.name))
      .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
      .forEach(entry => {
        if (lines.length >= options.maxEntries) {
          omitted += 1;
          return;
        }
        const child = path.join(dir, entry.name);
        const relative = normalizeSlashes(path.relative(root, child));
        lines.push(`${'  '.repeat(depth)}${relative}${entry.isDirectory() ? '/' : ''}`);
        if (entry.isDirectory()) {
          visit(child, depth + 1);
        }
      });
  }

  visit(root, 0);
  if (omitted > 0) {
    lines.push(`... ${omitted} entries omitted`);
  }
  return lines.join('\n') || '.';
}

function shouldIgnoreEntry(name: string): boolean {
  return [
    '.git',
    'node_modules',
    'dist',
    'out',
    'build',
    '.next',
    'coverage',
    'vendor',
    '.DS_Store',
  ].includes(name);
}

function looksBinary(fsPath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|mp4|mov|woff2?|ttf|eot)$/i.test(fsPath);
}

function unescapeMentionPath(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
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

function trimMiddleByChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  return [
    value.slice(0, head),
    '\n\n/* ... middle omitted during VS Code context compaction ... */\n\n',
    value.slice(value.length - tail),
  ].join('');
}
