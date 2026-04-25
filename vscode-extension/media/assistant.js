(function () {
  const vscode = acquireVsCodeApi();
  const state = {
    currentRequestId: undefined,
    currentOutput: '',
    running: false,
  };

  const timeline = byId('timeline');
  const prompt = byId('prompt');
  const composer = byId('composer');
  const stop = byId('stop');
  const configure = byId('configure');
  const showOutput = byId('showOutput');
  const modelSelect = byId('modelSelect');
  const effortSelect = byId('effortSelect');
  const refreshModels = byId('refreshModels');
  const cliLabel = byId('cliLabel');
  const contextFile = byId('contextFile');
  const contextLanguage = byId('contextLanguage');
  const contextSelection = byId('contextSelection');

  composer.addEventListener('submit', event => {
    event.preventDefault();
    const value = prompt.value.trim();
    if (!value || state.running) {
      return;
    }
    vscode.postMessage({ type: 'ask', prompt: value, mode: 'ask' });
    prompt.value = '';
  });

  stop.addEventListener('click', () => {
    vscode.postMessage({ type: 'stop' });
  });

  configure.addEventListener('click', () => {
    vscode.postMessage({ type: 'configureExecutable' });
  });

  showOutput.addEventListener('click', () => {
    vscode.postMessage({ type: 'showOutput' });
  });

  modelSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'selectModel', model: modelSelect.value });
  });

  effortSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'selectEffort', effort: effortSelect.value });
  });

  refreshModels.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshModels' });
  });

  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      if (state.running) {
        return;
      }
      vscode.postMessage({
        type: 'quickAction',
        action: button.getAttribute('data-action'),
      });
    });
  }

  prompt.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      composer.requestSubmit();
    }
  });

  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'context':
        cliLabel.textContent = message.cli;
        contextFile.textContent = message.file;
        contextLanguage.textContent = message.language;
        contextSelection.textContent = `${message.selectedChars} 字符`;
        renderModels(message.models || [], message.model || 'default');
        renderEffort(message.effort || 'auto');
        return;
      case 'run-start':
        startRun(message);
        return;
      case 'run-chunk':
        appendChunk(message);
        return;
      case 'run-done':
        finishRun(message);
        return;
      case 'run-error':
        failRun(message);
        return;
    }
  });

  vscode.postMessage({ type: 'ready' });

  function startRun(message) {
    state.running = true;
    state.currentRequestId = message.requestId;
    state.currentOutput = '';
    document.body.classList.add('is-running');

    timeline.innerHTML = '';
    timeline.appendChild(
      createBubble('user', message.prompt, {
        badge: titleForMode(message.mode),
      }),
    );
    timeline.appendChild(
      createBubble('assistant', '', {
        id: message.requestId,
        badge: '运行中',
        pending: true,
      }),
    );
    scrollToBottom();
  }

  function appendChunk(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.currentOutput += message.chunk;
    const body = document.querySelector(`[data-request-id="${message.requestId}"] .bubble-body`);
    if (body) {
      body.textContent = state.currentOutput.trimStart() || '正在连接 HelionCoder...';
    }
    scrollToBottom();
  }

  function finishRun(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.running = false;
    document.body.classList.remove('is-running');

    const bubble = document.querySelector(`[data-request-id="${message.requestId}"]`);
    if (!bubble) {
      return;
    }
    bubble.classList.remove('pending');
    const badge = bubble.querySelector('.badge');
    if (badge) {
      badge.textContent = '完成';
    }
    const body = bubble.querySelector('.bubble-body');
    const finalText = (message.text || state.currentOutput || '').trim();
    if (body) {
      body.textContent = finalText || '没有输出。';
    }
    addInsertAction(bubble, finalText);
    state.currentRequestId = undefined;
    scrollToBottom();
  }

  function failRun(message) {
    state.running = false;
    document.body.classList.remove('is-running');
    const bubble = document.querySelector(`[data-request-id="${message.requestId}"]`);
    if (bubble) {
      bubble.classList.remove('pending');
      bubble.classList.add('error');
      const badge = bubble.querySelector('.badge');
      if (badge) {
        badge.textContent = '错误';
      }
      const body = bubble.querySelector('.bubble-body');
      if (body) {
        body.textContent = message.message;
      }
    } else {
      timeline.appendChild(createBubble('assistant error', message.message, { badge: '错误' }));
    }
    state.currentRequestId = undefined;
    scrollToBottom();
  }

  function createBubble(kind, text, options = {}) {
    const article = document.createElement('article');
    article.className = `bubble ${kind}${options.pending ? ' pending' : ''}`;
    if (options.id) {
      article.dataset.requestId = options.id;
    }

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    const role = document.createElement('span');
    role.textContent = kind.includes('user') ? '你' : 'HelionCoder';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = options.badge || '提问';
    meta.append(role, badge);

    const body = document.createElement('pre');
    body.className = 'bubble-body';
    body.textContent = text || '正在连接 HelionCoder...';

    article.append(meta, body);
    return article;
  }

  function addInsertAction(bubble, text) {
    if (!text) {
      return;
    }
    const actions = document.createElement('div');
    actions.className = 'bubble-actions';
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.textContent = '插入到光标位置';
    insert.addEventListener('click', () => {
      vscode.postMessage({ type: 'insertText', text });
    });
    actions.append(insert);
    bubble.append(actions);
  }

  function titleForMode(mode) {
    const titles = {
      ask: '提问',
      explain: '解释',
      fix: '修复',
      complete: '补全',
      tests: '测试',
    };
    return titles[mode] || '提问';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });
  }

  function renderModels(models, selected) {
    const previous = modelSelect.value;
    modelSelect.innerHTML = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent =
        model.id === 'default' ? 'CLI 默认模型' : `${model.label} · ${model.source}`;
      option.title = model.description || model.source || model.id;
      modelSelect.append(option);
    }

    const next = selected || previous || 'default';
    if ([...modelSelect.options].some(option => option.value === next)) {
      modelSelect.value = next;
    } else {
      const option = document.createElement('option');
      option.value = next;
      option.textContent = `${next} · 当前选择`;
      modelSelect.prepend(option);
      modelSelect.value = next;
    }
  }

  function renderEffort(effort) {
    const next = effort || 'auto';
    if ([...effortSelect.options].some(option => option.value === next)) {
      effortSelect.value = next;
      return;
    }
    effortSelect.value = 'auto';
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`缺少 HelionCoder Webview 元素：${id}`);
    }
    return element;
  }
})();
