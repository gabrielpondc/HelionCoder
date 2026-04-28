import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceCwd } from './cli';

export interface ModelCandidate {
  id: string;
  label: string;
  source: string;
  description?: string;
}

export interface DefaultModelInfo {
  id: string;
  source: string;
}

interface EndpointConfig {
  apiKey?: string;
  baseUrl?: string;
}

export class ModelResolver {
  constructor(private readonly output: vscode.OutputChannel) {}

  getSelectedModel(): string | undefined {
    const model = vscode.workspace
      .getConfiguration('helionCoder')
      .get<string>('model', '')
      .trim();
    return model.length > 0 ? model : undefined;
  }

  getDefaultModelInfo(): DefaultModelInfo {
    return resolveCliDefaultModel();
  }

  async setSelectedModel(model: string | undefined): Promise<void> {
    await vscode.workspace
      .getConfiguration('helionCoder')
      .update('model', model ?? '', vscode.ConfigurationTarget.Global);
  }

  async listModels(options: { refreshApi?: boolean } = {}): Promise<ModelCandidate[]> {
    const models: ModelCandidate[] = [];
    const defaultModel = this.getDefaultModelInfo();

    models.push({
      id: 'default',
      label: `命令行默认：${defaultModel.id}`,
      source: defaultModel.source,
      description: '不传 --model，让 HelionCoder CLI 按当前配置解析默认模型。',
    });

    let apiModels: ModelCandidate[] = [];
    if (
      options.refreshApi ||
      vscode.workspace.getConfiguration('helionCoder').get<boolean>('autoDetectModels', true)
    ) {
      apiModels = await this.fetchApiModels().catch(error => {
        this.output.appendLine(
          `已跳过模型自动检测：${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      });
    }

    if (apiModels.length > 0) {
      models.push(...apiModels);
    }
    this.addConfiguredModels(models);
    this.addEnvironmentModels(models);
    this.addFileModels(models);

    const selected = this.getSelectedModel();
    if (selected) {
      models.unshift({
        id: selected,
        label: selected,
        source: '当前选择',
        description: '当前 VS Code 选择的模型。',
      });
    }

    return dedupeModels(models);
  }

  async pickModel(): Promise<string | undefined> {
    const models = await this.listModels({ refreshApi: true });
    const selected = this.getSelectedModel();
    const items: vscode.QuickPickItem[] = models.map(model => ({
      label: model.id === 'default' ? `$(check) ${model.label}` : model.label,
      description:
        model.id === selected
          ? `${model.source} · 当前`
          : model.source,
      detail: model.description,
      alwaysShow: model.id === selected,
    }));

    items.push({
      label: '$(edit) 手动输入模型...',
      description: '手动',
      detail: '使用当前 API 端点支持的任意模型 ID。',
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: '选择 HelionCoder 模型',
      placeHolder: selected ?? '命令行默认',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      return undefined;
    }

    if (picked.label.includes('手动输入模型')) {
      const custom = await vscode.window.showInputBox({
        title: '自定义模型',
        prompt: '传给 helion-coder --model 的模型 ID。',
        value: selected ?? '',
      });
      if (custom === undefined) {
        return undefined;
      }
      const trimmed = custom.trim();
      await this.setSelectedModel(trimmed || undefined);
      return trimmed || undefined;
    }

    const model = models.find(
      candidate =>
        picked.label === candidate.label ||
        picked.label.endsWith(candidate.id) ||
        picked.label.endsWith(candidate.label),
    );
    const value = model?.id === 'default' ? undefined : model?.id;
    await this.setSelectedModel(value);
    return value;
  }

  private addConfiguredModels(models: ModelCandidate[]): void {
    const config = vscode.workspace.getConfiguration('helionCoder');
    const configured = config.get<string[]>('models', []);
    for (const id of configured) {
      addModel(models, id, 'VS Code 设置');
    }

    const selected = config.get<string>('model', '').trim();
    addModel(models, selected, 'VS Code 设置');
  }

  private addEnvironmentModels(models: ModelCandidate[]): void {
    const envKeys = [
      'OPENAI_MODEL',
      'OPENAI_SMALL_MODEL',
      'OPENAI_MM_MODEL',
      'OPENAI_MULTIMODAL_MODEL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL',
    ];

    for (const key of envKeys) {
      addModel(models, process.env[key], `环境变量 ${key}`);
    }
  }

  private addFileModels(models: ModelCandidate[]): void {
    for (const filePath of getConfigFileCandidates()) {
      const data = readJson(filePath);
      if (!data) {
        continue;
      }

      const source = shortPath(filePath);
      collectModelsFromObject(data, source, models);
    }
  }

  private async fetchApiModels(): Promise<ModelCandidate[]> {
    const endpoint = this.getEndpointConfig();
    if (!endpoint.apiKey) {
      return [];
    }

    const timeoutMs = vscode.workspace
      .getConfiguration('helionCoder')
      .get<number>('modelListTimeoutMs', 5000);
    const url = toModelsUrl(endpoint.baseUrl ?? 'https://api.openai.com/v1');
    const payload = await requestJson(url, endpoint.apiKey, timeoutMs);
    const rawModels = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];

    return rawModels
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
          return (item as { id: string }).id;
        }
        return undefined;
      })
      .filter((id): id is string => !!id && id.trim().length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map(id => ({
        id,
        label: id,
        source: new URL(url).host,
        description: '从 OpenAI 兼容 /models 端点检测到。',
      }));
  }

  private getEndpointConfig(): EndpointConfig {
    const fromFiles: EndpointConfig = {};
    for (const filePath of getConfigFileCandidates()) {
      const data = readJson(filePath);
      if (!data) {
        continue;
      }
      const openai =
        data.openai && typeof data.openai === 'object'
          ? (data.openai as Record<string, unknown>)
          : {};
      fromFiles.apiKey ??= firstString(
        data.openaiApiKey,
        data.primaryApiKey,
        data.apiKey,
        data.api_key,
        openai.apiKey,
        openai.api_key,
        openai.token,
      );
      fromFiles.baseUrl ??= firstString(
        data.openaiBaseUrl,
        data.openaiModelOptionsCacheBaseUrl,
        data.baseUrl,
        data.baseURL,
        data.apiBaseUrl,
        openai.baseUrl,
        openai.baseURL,
        openai.apiBaseUrl,
      );
    }

    return {
      apiKey: firstString(
        process.env.OPENAI_API_KEY,
        fromFiles.apiKey,
        process.env.ANTHROPIC_API_KEY,
      ),
      baseUrl: firstString(
        process.env.OPENAI_BASE_URL,
        fromFiles.baseUrl,
        process.env.ANTHROPIC_BASE_URL,
      ),
    };
  }
}

function collectModelsFromObject(
  data: Record<string, unknown>,
  source: string,
  models: ModelCandidate[],
): void {
  addModel(models, data.model, source);
  addModel(models, data.openaiModel, source);
  addModel(models, data.openaiSmallModel, source);
  addModel(models, data.openaiMultimodalModel, source);

  if (Array.isArray(data.openaiModelOptionsCache)) {
    for (const model of data.openaiModelOptionsCache) {
      addModel(models, model, `${source} /v1/models 缓存`);
    }
  }

  if (Array.isArray(data.availableModels)) {
    for (const model of data.availableModels) {
      addModel(models, model, `${source} 可用模型`);
    }
  }

  if (Array.isArray(data.models)) {
    for (const model of data.models) {
      addModel(models, model, `${source} 模型`);
    }
  }

  if (data.openai && typeof data.openai === 'object') {
    const openai = data.openai as Record<string, unknown>;
    addModel(models, openai.model, `${source} OpenAI 配置`);
    addModel(models, openai.smallModel, `${source} OpenAI 配置`);
    if (Array.isArray(openai.models)) {
      for (const model of openai.models) {
        addModel(models, model, `${source} OpenAI 模型`);
      }
    }
  }

  if (data.modelOverrides && typeof data.modelOverrides === 'object') {
    for (const value of Object.values(data.modelOverrides)) {
      addModel(models, value, `${source} 模型覆盖`);
    }
  }
}

function resolveCliDefaultModel(): DefaultModelInfo {
  const explicit = firstString(process.env.ANTHROPIC_MODEL);
  if (explicit) {
    return { id: explicit, source: '环境变量 ANTHROPIC_MODEL' };
  }

  for (const filePath of getConfigFileCandidates()) {
    const data = readJson(filePath);
    if (!data) {
      continue;
    }
    const settingsModel = firstString(data.model);
    if (settingsModel) {
      return { id: settingsModel, source: shortPath(filePath) };
    }
  }

  const openaiEnv = firstString(process.env.OPENAI_MODEL);
  if (openaiEnv) {
    return { id: openaiEnv, source: '环境变量 OPENAI_MODEL' };
  }

  for (const filePath of getConfigFileCandidates()) {
    const data = readJson(filePath);
    if (!data) {
      continue;
    }
    const openai =
      data.openai && typeof data.openai === 'object'
        ? (data.openai as Record<string, unknown>)
        : {};
    const configured = firstString(data.openaiModel, openai.model);
    if (configured) {
      return { id: configured, source: shortPath(filePath) };
    }
  }

  const sonnetEnv = firstString(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  if (sonnetEnv) {
    return { id: sonnetEnv, source: '环境变量 ANTHROPIC_DEFAULT_SONNET_MODEL' };
  }

  return { id: 'gpt-5.4', source: '内置默认' };
}

function getConfigFileCandidates(): string[] {
  const home = os.homedir();
  const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [
    getWorkspaceCwd(),
  ];
  const configHome = process.env.HELIONCODER_CONFIG_DIR;
  const candidates = new Set<string>();
  const helionConfigHome = configHome ?? path.join(home, '.helioncoder');

  candidates.add(path.join(helionConfigHome, 'settings.json'));
  candidates.add(path.join(helionConfigHome, 'settings.local.json'));
  candidates.add(path.join(helionConfigHome, 'config.json'));
  candidates.add(path.join(helionConfigHome, '.config.json'));

  for (const root of workspaceRoots) {
    candidates.add(path.join(root, '.helioncoder', 'settings.json'));
    candidates.add(path.join(root, '.helioncoder', 'settings.local.json'));
    candidates.add(path.join(root, '.helion-models.json'));

  }

  return [...candidates];
}

function addModel(models: ModelCandidate[], value: unknown, source: string): void {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    return;
  }
  models.push({
    id,
    label: id,
    source,
  });
}

function dedupeModels(models: ModelCandidate[]): ModelCandidate[] {
  const seen = new Set<string>();
  const deduped: ModelCandidate[] = [];
  for (const model of models) {
    const key = model.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(model);
  }
  return deduped;
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function toModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  let pathname = url.pathname.replace(/\/+$/, '');
  for (const suffix of ['/responses', '/models', '/chat/completions', '/completions']) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length);
      break;
    }
  }

  url.pathname = pathname.endsWith('/v1')
    ? `${pathname}/models`
    : `${pathname || ''}/v1/models`.replace(/\/{2,}/g, '/');
  return url.toString();
}

function requestJson(url: string, apiKey: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport =
      parsed.protocol === 'http:' ? http : parsed.protocol === 'https:' ? https : null;
    if (!transport) {
      reject(new Error(`/models 不支持的协议：${parsed.protocol}`));
      return;
    }

    const req = transport.get(
      parsed,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            const status = res.statusCode ?? '未知';
            const detail =
              status === 401
                ? '（未授权：请求已携带 token，请检查 API Key 是否和 Base URL 匹配）'
                : '';
            reject(new Error(`/models 返回 HTTP ${status}${detail}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`/models 请求超时：${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

function shortPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
