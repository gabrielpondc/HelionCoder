(() => {
  const vscode = acquireVsCodeApi();
  const state = {
    currentRequestId: undefined,
    currentOutput: "",
    currentThinking: "",
    running: false,
    permissionMode: "default",
    thinkingMode: "",
    includeContext: true,
    planMode: false,
    queue: [],
    attachments: [],
    hasConversation: false,
    conversationTitle: "任务",
    recentHistory: [],
    recentHistoryTotal: 0,
    pendingPermissions: new Map(),
    shouldAutoScroll: true,
  };
  const sendIcon =
    '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>';
  const stopIcon =
    '<svg class="ui-icon stop-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"></rect></svg>';
  const copyIcon =
    '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><rect x="4" y="4" width="11" height="11" rx="2"></rect></svg>';
  const editIcon =
    '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
  const insertIcon =
    '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>';
  const pendingAssistantText = "正在生成回复...";
  const guidePromptPrefix =
    "请把下面内容作为对上一条正在处理任务的后续引导/补充要求，并在当前回答或下一步执行中考虑：";
  const autoScrollBottomThreshold = 48;
  let markdownRenderer;

  const timeline = byId("timeline");
  const prompt = byId("prompt");
  const attachmentTray = byId("attachmentTray");
  const composer = byId("composer");
  const stop = byId("stop");
  const guide = byId("guide");
  const headerTitle = byId("headerTitle");
  const backToTasks = byId("backToTasks");
  const settingsMenu = byId("settingsMenu");
  const settingsPopover = byId("settingsPopover");
  const modelSelect = byId("modelSelect");
  const effortSelect = byId("effortSelect");
  const modelEffortMenu = byId("modelEffortMenu");
  const modelEffortPopover = byId("modelEffortPopover");
  const modelSubPopover = byId("modelSubPopover");
  const modelOptions = byId("modelOptions");
  const modelDisplay = byId("modelDisplay");
  const effortDisplay = byId("effortDisplay");
  const modelMenuLabel = byId("modelMenuLabel");
  const openModelSubmenu = byId("openModelSubmenu");
  const newConversation = byId("newConversation");
  const history = byId("history");
  const cliLabel = byId("cliLabel");
  const contextFile = byId("contextFile");
  const contextLanguage = byId("contextLanguage");
  const contextSelection = byId("contextSelection");
  const suggest = byId("suggest");
  const addMenu = byId("addMenu");
  const addPopover = byId("addPopover");
  const permissionMenu = byId("permissionMenu");
  const permissionPopover = byId("permissionPopover");
  const permissionLabel = byId("permissionLabel");
  const permissionIcon = byId("permissionIcon");
  const includeContextSwitch = byId("includeContextSwitch");
  const planSwitch = byId("planSwitch");
  const planToggle = byId("planToggle");
  const contextWindow = byId("contextWindow");
  const contextRing = byId("contextRing");
  const contextWindowPercent = byId("contextWindowPercent");
  const contextWindowTokens = byId("contextWindowTokens");

  const commandItems = [
    {
      trigger: "/fix",
      title: "修复问题",
      hint: "检查当前上下文并给出最小修复",
      action: "fix",
    },
    {
      trigger: "/review",
      title: "代码审查",
      hint: "查找 bug、回归风险和缺失测试",
      action: "review",
    },
    {
      trigger: "/explain",
      title: "解释代码",
      hint: "说明意图、副作用和风险",
      action: "explain",
    },
    {
      trigger: "/test",
      title: "生成测试",
      hint: "为当前代码生成聚焦测试",
      action: "tests",
    },
    {
      trigger: "/refactor",
      title: "重构",
      hint: "降低复杂度并保持行为不变",
      action: "refactor",
    },
    {
      trigger: "/docs",
      title: "补文档",
      hint: "添加必要注释或说明",
      action: "docs",
    },
    {
      trigger: "/optimize",
      title: "优化",
      hint: "分析性能和资源使用",
      action: "optimize",
    },
    {
      trigger: "/complete",
      title: "续写",
      hint: "补全光标位置下一步代码",
      action: "complete",
    },
    {
      trigger: "/debug",
      title: "调试问题",
      hint: "定位复现路径、根因和修复步骤",
      text: "请帮我调试当前问题：先给排查路径，再判断最可能根因，最后给出最小修复步骤。",
    },
    {
      trigger: "/plan",
      title: "制定计划",
      hint: "拆解实现步骤和验证方式",
      text: "请先制定实现计划：列出要检查的文件、修改步骤、风险点和验证方式，暂时不要改代码。",
    },
    {
      trigger: "/implement",
      title: "实现功能",
      hint: "按当前需求完成代码修改",
      text: "请根据当前上下文实现这个功能，保持改动聚焦，并在最后说明如何验证。",
    },
    {
      trigger: "/commit",
      title: "准备提交",
      hint: "检查改动并生成提交说明",
      text: "请检查当前改动，整理提交说明，并指出提交前还需要运行的验证。",
    },
    {
      trigger: "/diff",
      title: "查看改动",
      hint: "总结当前工作区差异",
      text: "请查看并总结当前工作区改动：按文件说明变更意图、风险和建议验证。",
    },
    {
      trigger: "/security",
      title: "安全检查",
      hint: "审查注入、权限和敏感信息风险",
      text: "请对当前代码做安全检查，优先关注注入、认证授权、敏感信息泄漏和不安全默认值。",
    },
    {
      trigger: "/types",
      title: "类型检查",
      hint: "分析类型设计和类型错误",
      text: "请检查当前代码的类型设计和潜在类型错误，给出最小修复建议。",
    },
    {
      trigger: "/deps",
      title: "依赖分析",
      hint: "检查依赖、版本和集成风险",
      text: "请分析当前任务涉及的依赖和集成点，指出版本、配置和兼容性风险。",
    },
    {
      trigger: "/init",
      title: "项目入门",
      hint: "了解项目结构和启动方式",
      text: "请快速梳理这个项目：目录结构、关键入口、运行方式、测试方式和需要注意的约定。",
    },
    {
      trigger: "/help",
      title: "使用帮助",
      hint: "说明当前助手能做什么",
      text: "请根据当前项目和上下文，告诉我你能帮我完成哪些开发任务，并给出几个可直接使用的请求示例。",
    },
    {
      trigger: "/status",
      title: "当前状态",
      hint: "汇总会话和工作区状态",
      text: "请汇总当前任务状态：已经知道什么、还缺什么、工作区有哪些相关改动、下一步建议做什么。",
    },
    {
      trigger: "/memory",
      title: "项目记忆",
      hint: "提炼可写入项目记忆的约定",
      text: "请从当前上下文中提炼值得记录到项目记忆的约定、命令和注意事项，先列候选项让我确认。",
    },
    {
      trigger: "/plugins",
      title: "插件建议",
      hint: "根据任务推荐可用插件或能力",
      text: "请根据当前项目和任务，建议可能有帮助的插件、MCP、技能或自动化，并说明适用场景。",
    },
    {
      trigger: "/compact",
      title: "压缩上下文",
      hint: "整理关键信息方便继续",
      text: "请把当前上下文压缩成一份继续工作的摘要：目标、已完成、关键文件、未解决问题和下一步。",
    },
  ];

  const helpItems = [
    {
      trigger: "?review",
      title: "审查模板",
      hint: "按严重程度列出发现",
      text: "请按代码审查格式回答：先列出问题和风险，再给出最小修改建议。",
    },
    {
      trigger: "?patch",
      title: "补丁模板",
      hint: "要求可应用的最小变更",
      text: "请给出最小补丁方案，说明要改哪些文件、为什么改、如何验证。",
    },
    {
      trigger: "?debug",
      title: "调试模板",
      hint: "定位复现路径和根因",
      text: "请帮我定位这个问题：先给排查路径，再判断最可能根因，最后给修复步骤。",
    },
    {
      trigger: "?tests",
      title: "测试模板",
      hint: "覆盖关键分支和回归",
      text: "请为当前代码设计测试：列出测试文件、用例名称、关键断言和边界条件。",
    },
  ];

  const mentionItems = [
    {
      trigger: "@file",
      title: "选择文件",
      hint: "从工作区选择一个文件作为上下文",
      mention: "file",
    },
    {
      trigger: "@selection",
      title: "当前选区",
      hint: "优先使用编辑器选中的代码",
      mention: "selection",
    },
    {
      trigger: "@workspace",
      title: "选择工作区",
      hint: "选择工作区并附带项目结构",
      mention: "workspace",
    },
    {
      trigger: "@terminal",
      title: "终端输出",
      hint: "粘贴日志后让 Helion 分析",
      text: "请分析下面的 @终端输出，并给出根因和修复步骤：\n",
    },
  ];

  let suggestState = {
    open: false,
    trigger: "",
    start: 0,
    end: 0,
    selected: 0,
    items: [],
  };
  let pendingMentionRange;

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = prompt.value.trim();
    const attachments = displayAttachments();
    const finalPrompt =
      composePrompt(value) || (attachments.length ? "请查看附件。" : "");
    if (!finalPrompt) {
      if (state.running) {
        vscode.postMessage({ type: "stop" });
      }
      return;
    }
    if (state.running) {
      enqueuePrompt(
        finalPrompt,
        attachments,
        value || (attachments.length ? "已添加附件" : ""),
        value,
      );
      prompt.value = "";
      clearAttachments();
      return;
    }
    vscode.postMessage({
      type: "ask",
      prompt: finalPrompt,
      displayPrompt: value || (attachments.length ? "已添加附件" : ""),
      editPrompt: value,
      attachments,
      mode: "ask",
    });
    prompt.value = "";
    clearAttachments();
  });

  for (const button of document.querySelectorAll("[data-prompt]")) {
    button.addEventListener("click", () => {
      prompt.value = button.getAttribute("data-prompt") || "";
      prompt.focus();
      updateSuggest();
      updateQueueState();
    });
  }

  stop.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });

  guide.addEventListener("click", () => {
    const value = prompt.value.trim();
    if (!state.running || !value) {
      return;
    }
    sendSideQuestion(value, formatGuideDisplay(value));
    prompt.value = "";
    updateQueueState();
  });

  backToTasks.addEventListener("click", () => {
    vscode.postMessage({ type: "newConversation" });
    resetConversation();
  });

  settingsMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover(settingsPopover);
  });

  modelSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "selectModel", model: modelSelect.value });
    updateModelEffortDisplay();
    renderModelOptions();
  });

  effortSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "selectEffort", effort: effortSelect.value });
    updateModelEffortDisplay();
  });

  modelEffortMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = modelEffortPopover.hidden;
    closePopovers();
    modelEffortPopover.hidden = !willOpen;
    modelSubPopover.hidden = true;
  });

  modelEffortPopover.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    event.stopPropagation();
    const effort = button.getAttribute("data-effort-option");
    if (effort) {
      effortSelect.value = effort;
      updateModelEffortDisplay();
      vscode.postMessage({ type: "selectEffort", effort });
      return;
    }
    if (button.id === "openModelSubmenu") {
      modelSubPopover.hidden = false;
    }
  });

  openModelSubmenu.addEventListener("mouseenter", () => {
    modelSubPopover.hidden = false;
  });

  modelSubPopover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-model-option]");
    if (!button) {
      return;
    }
    event.stopPropagation();
    const model = button.getAttribute("data-model-option");
    modelSelect.value = model;
    updateModelEffortDisplay();
    renderModelOptions();
    vscode.postMessage({ type: "selectModel", model });
    closePopovers();
  });

  newConversation.addEventListener("click", () => {
    vscode.postMessage({ type: "newConversation" });
    resetConversation();
  });

  history.addEventListener("click", () => {
    vscode.postMessage({ type: "showHistory" });
  });

  addMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover(addPopover);
  });

  permissionMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover(permissionPopover);
  });

  planToggle.addEventListener("click", () => {
    vscode.postMessage({ type: "togglePlanMode", value: !state.planMode });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") {
      return;
    }
    if (
      !target.closest(".menu-popover") &&
      !target.closest(".mode-chip") &&
      !target.closest(".round-tool") &&
      !target.closest(".icon-button") &&
      !target.closest(".model-effort-button")
    ) {
      closePopovers();
    }
  });

  timeline.addEventListener(
    "click",
    (event) => {
      const codeCopyButton = event.target.closest("[data-copy-code]");
      if (codeCopyButton) {
        event.preventDefault();
        event.stopPropagation();
        const wrapper = codeCopyButton.closest(".code-block-wrap");
        const code = wrapper?.querySelector("pre code")?.textContent || "";
        navigator.clipboard
          .writeText(code)
          .then(() => {
            codeCopyButton.classList.add("copied");
            codeCopyButton.title = "已复制";
            setTimeout(() => {
              codeCopyButton.classList.remove("copied");
              codeCopyButton.title = "复制代码";
            }, 1200);
          })
          .catch(() => undefined);
        return;
      }

      const codeInsertButton = event.target.closest("[data-insert-code]");
      if (codeInsertButton) {
        event.preventDefault();
        event.stopPropagation();
        const wrapper = codeInsertButton.closest(".code-block-wrap");
        const code = wrapper?.querySelector("pre code")?.textContent || "";
        vscode.postMessage({ type: "insertText", text: code });
        codeInsertButton.classList.add("inserted");
        codeInsertButton.title = "已插入";
        setTimeout(() => {
          codeInsertButton.classList.remove("inserted");
          codeInsertButton.title = "插入到光标位置";
        }, 900);
        return;
      }

      const fileButton = event.target.closest("[data-step-file-path]");
      if (fileButton) {
        event.preventDefault();
        event.stopPropagation();
        openStepFile(fileButton);
        return;
      }

      const reviewAction = event.target.closest("[data-review-action]");
      if (reviewAction) {
        event.preventDefault();
        event.stopPropagation();
        runReviewAction(reviewAction);
        return;
      }

      const button = event.target.closest("[data-permission-action]");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      respondToPermissionAction(button);
    },
    true,
  );

  timeline.addEventListener(
    "pointerdown",
    (event) => {
      const button = event.target.closest("[data-permission-action]");
      if (!button) {
        return;
      }
      event.stopPropagation();
    },
    true,
  );

  timeline.addEventListener(
    "scroll",
    () => {
      state.shouldAutoScroll = isTimelineAtBottom();
    },
    { passive: true },
  );

  addPopover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-action]");
    if (!button) {
      return;
    }
    const action = button.getAttribute("data-menu-action");
    closePopovers();
    if (action === "attach") {
      vscode.postMessage({ type: "attachFile" });
    } else if (action === "toggle-context") {
      vscode.postMessage({
        type: "toggleIncludeContext",
        value: !state.includeContext,
      });
    } else if (action === "toggle-plan") {
      vscode.postMessage({ type: "togglePlanMode", value: !state.planMode });
    } else if (action === "plugins") {
      vscode.postMessage({ type: "showPlugins" });
    }
  });

  permissionPopover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-permission-mode]");
    if (!button) {
      return;
    }
    closePopovers();
    vscode.postMessage({
      type: "selectPermission",
      mode: button.getAttribute("data-permission-mode"),
    });
  });

  settingsPopover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-action]");
    if (!button) {
      return;
    }
    closePopovers();
    const action = button.getAttribute("data-settings-action");
    if (action === "configure-api") {
      vscode.postMessage({ type: "configureApi" });
    } else if (action === "configure-cli") {
      vscode.postMessage({ type: "configureExecutable" });
    } else if (action === "refresh-models") {
      vscode.postMessage({ type: "refreshModels" });
    } else if (action === "check-updates") {
      vscode.postMessage({ type: "checkUpdates" });
    } else if (action === "output") {
      vscode.postMessage({ type: "showOutput" });
    } else if (action === "plugins") {
      vscode.postMessage({ type: "showPlugins" });
    }
  });

  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", () => {
      if (state.running) {
        return;
      }
      vscode.postMessage({
        type: "quickAction",
        action: button.getAttribute("data-action"),
      });
    });
  }

  prompt.addEventListener("keydown", (event) => {
    if (suggestState.open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSuggestion(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSuggestion(-1);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        applySuggestion(suggestState.items[suggestState.selected]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSuggest();
        return;
      }
      if (event.key === "Enter" && suggestState.items.length > 0) {
        event.preventDefault();
        applySuggestion(suggestState.items[suggestState.selected]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      !state.running ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    if (!["1", "2", "3"].includes(event.key)) {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      typeof active.closest === "function" &&
      active.closest(".permission-card")
    ) {
      return;
    }
    const card = document.querySelector(".permission-card:not(.resolved)");
    if (!card) {
      return;
    }
    const action =
      event.key === "1" ? "allow" : event.key === "2" ? "allow-always" : "deny";
    const button = card.querySelector(`[data-permission-action="${action}"]`);
    if (button) {
      event.preventDefault();
      respondToPermissionAction(button);
    }
  });

  prompt.addEventListener("input", () => {
    updateSuggest();
    updateQueueState();
  });
  prompt.addEventListener("paste", (event) => {
    void handlePaste(event);
  });
  for (const target of [document, document.body, composer, prompt]) {
    target.addEventListener("dragenter", handleDragOver, true);
    target.addEventListener("dragover", handleDragOver, true);
    target.addEventListener("dragleave", handleDragLeave, true);
    target.addEventListener(
      "drop",
      (event) => {
        void handleDrop(event);
      },
      true,
    );
  }
  prompt.addEventListener("click", updateSuggest);
  prompt.addEventListener("blur", () => {
    setTimeout(closeSuggest, 120);
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "context":
        cliLabel.textContent = message.cli;
        contextFile.textContent = message.file;
        contextLanguage.textContent = message.language;
        contextSelection.textContent = `${message.selectedChars} 字符`;
        renderModels(message.models || [], message.model || "default");
        renderEffort(message.effort || "auto");
        renderModes(message);
        state.recentHistory = message.recentHistory || [];
        state.recentHistoryTotal =
          message.recentHistoryTotal || state.recentHistory.length;
        if (!state.hasConversation && !state.running) {
          renderTaskHome();
        }
        return;
      case "run-start":
        startRun(message);
        return;
      case "run-chunk":
        appendChunk(message);
        return;
      case "run-step":
        renderRunStep(message);
        return;
      case "run-thinking":
        appendThinking(message);
        return;
      case "token-usage":
        updateTokenUsage(message);
        return;
      case "run-compact":
        renderCompact(message);
        return;
      case "run-done":
        finishRun(message);
        return;
      case "run-error":
        failRun(message);
        return;
      case "side-question-start":
        startSideQuestion(message);
        return;
      case "side-question-done":
        finishSideQuestion(message);
        return;
      case "side-question-error":
        failSideQuestion(message);
        return;
      case "permission-request":
        renderPermissionRequest(message.request);
        return;
      case "permission-cancelled":
        cancelPermissionRequest(message);
        return;
      case "mention-picked":
        insertPickedMention(message);
        return;
      case "mention-cancelled":
        pendingMentionRange = undefined;
        prompt.focus();
        return;
      case "review-cleared":
        clearReview(message.reviewId);
        return;
      case "history-loaded":
        renderHistoryConversation(message);
        return;
      case "conversation-restored":
        renderHistoryConversation({ ...message, restored: true });
        return;
      case "conversation-new":
        resetConversation();
        return;
    }
  });

  vscode.postMessage({ type: "ready" });

  function startRun(message) {
    state.running = true;
    state.currentRequestId = message.requestId;
    state.currentOutput = "";
    state.currentThinking = "";
    state.hasConversation = true;
    state.conversationTitle = message.prompt || "对话";
    renderHeader();
    document.body.classList.add("is-running");
    document.body.classList.add("has-conversation");
    updateQueueState();

    clearLandingMessage();
    timeline.appendChild(
      createBubble("user", message.prompt, {
        badge: titleForMode(message.mode),
        attachments: message.attachments || [],
        editText: message.editPrompt || message.prompt || "",
      }),
    );
    timeline.appendChild(
      createBubble("assistant", "", {
        id: message.requestId,
        badge: "运行中",
        pending: true,
      }),
    );
    scrollToBottom({ force: true });
  }

  function appendChunk(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.currentOutput += message.chunk;
    const body = document.querySelector(
      `[data-request-id="${message.requestId}"] .bubble-body`,
    );
    if (body) {
      renderMarkdown(
        body,
        state.currentOutput.trimStart() || pendingAssistantText,
      );
    }
    scrollToBottom();
  }

  function appendThinking(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.currentThinking += message.chunk || "";
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble) {
      return;
    }
    const panel = ensureThinkingPanel(bubble);
    panel.open = true;
    const body = panel.querySelector(".thinking-body");
    if (body) {
      renderMarkdown(body, state.currentThinking.trimStart() || "正在思考...");
    }
    const summary = panel.querySelector(".thinking-summary small");
    if (summary) {
      summary.textContent = `${state.currentThinking.length.toLocaleString()} 字符`;
    }
    scrollToBottom();
  }

  function ensureThinkingPanel(bubble) {
    let panel = bubble.querySelector(".thinking-panel");
    if (panel) {
      return panel;
    }

    panel = document.createElement("details");
    panel.className = "thinking-panel";
    panel.open = true;

    const summary = document.createElement("summary");
    summary.className = "thinking-summary";
    summary.innerHTML = "<span>思考过程</span><small>正在生成</small>";

    const body = document.createElement("div");
    body.className = "thinking-body markdown-body";
    body.textContent = "正在思考...";
    panel.append(summary, body);

    const steps = bubble.querySelector(".run-steps");
    const bubbleBody = bubble.querySelector(".bubble-body");
    if (steps) {
      bubble.insertBefore(panel, steps.nextSibling);
    } else if (bubbleBody) {
      bubble.insertBefore(panel, bubbleBody);
    } else {
      bubble.append(panel);
    }
    return panel;
  }

  function renderRunStep(message) {
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble || !message.step) {
      return;
    }

    const panel = ensureRunStepsPanel(bubble);
    panel.open = true;
    const list = panel.querySelector(".run-step-list");
    if (!list) {
      return;
    }

    const step = normalizeStep(message.step);
    let row = list.querySelector(`[data-step-id="${cssEscape(step.id)}"]`);
    if (!row) {
      row = document.createElement("div");
      row.className = "run-step-row";
      row.dataset.stepId = step.id;
      row.innerHTML = [
        '<span class="run-step-dot" aria-hidden="true"></span>',
        '<span class="run-step-content">',
        '<span class="run-step-title"></span>',
        '<span class="run-step-extra"></span>',
        "</span>",
      ].join("");
      list.append(row);
    }

    row.__step = mergeStep(row.__step, step);
    paintStepRow(row, row.__step);
    updateRunStepsSummary(panel, false);
    scrollToBottom();
  }

  function ensureRunStepsPanel(bubble) {
    let panel = bubble.querySelector(".run-steps");
    if (panel) {
      return panel;
    }

    panel = document.createElement("details");
    panel.className = "run-steps";
    panel.open = true;

    const summary = document.createElement("summary");
    summary.className = "run-steps-summary";
    summary.innerHTML = "<span>执行步骤</span><small>等待工具状态</small>";

    const list = document.createElement("div");
    list.className = "run-step-list";
    panel.append(summary, list);

    const body = bubble.querySelector(".bubble-body");
    if (body) {
      bubble.insertBefore(panel, body);
    } else {
      bubble.append(panel);
    }
    return panel;
  }

  function normalizeStep(step) {
    return {
      id: String(
        step.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ),
      toolName: step.toolName || "Tool",
      status: step.status || "running",
      label: step.label || step.toolName || "Tool",
      detail: step.detail || "",
      filePath: step.filePath || "",
      fileLabel: step.fileLabel || basename(step.filePath || ""),
      lineStart: Number.isFinite(Number(step.lineStart))
        ? Number(step.lineStart)
        : undefined,
      lineEnd: Number.isFinite(Number(step.lineEnd))
        ? Number(step.lineEnd)
        : undefined,
      elapsedSeconds: Number.isFinite(Number(step.elapsedSeconds))
        ? Number(step.elapsedSeconds)
        : undefined,
    };
  }

  function mergeStep(previous, next) {
    if (!previous) {
      return next;
    }
    const isGenericCompletion =
      next.label === "执行完成" || next.label === "执行失败";
    const mergedToolName =
      next.toolName === "Tool" && previous.toolName
        ? previous.toolName
        : next.toolName;
    const readLineRange = readLineRangeFromDetail(
      mergedToolName,
      next.detail,
      previous.lineStart,
    );
    return {
      ...previous,
      ...next,
      toolName: mergedToolName,
      label:
        isGenericCompletion && previous.label ? previous.label : next.label,
      detail: next.detail || previous.detail,
      filePath: next.filePath || previous.filePath,
      fileLabel: next.fileLabel || previous.fileLabel,
      lineStart:
        next.lineStart ?? readLineRange?.lineStart ?? previous.lineStart,
      lineEnd: next.lineEnd ?? readLineRange?.lineEnd ?? previous.lineEnd,
    };
  }

  function paintStepRow(row, step) {
    row.classList.remove("started", "running", "completed", "failed", "status");
    row.classList.add(step.status || "running");

    const title = row.querySelector(".run-step-title");
    if (title) {
      title.textContent = step.label || step.toolName || "Tool";
    }

    const extra = row.querySelector(".run-step-extra");
    if (!extra) {
      return;
    }
    extra.innerHTML = "";

    if (step.filePath) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "step-file-chip";
      chip.setAttribute("data-step-file-path", step.filePath);
      chip.setAttribute("data-step-line", String(step.lineStart ?? 1));
      chip.setAttribute("data-step-file-label", step.fileLabel || basename(step.filePath));
      chip.title = step.filePath;
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openStepFile(chip);
      });
      chip.textContent = [
        step.fileLabel || basename(step.filePath),
        lineRangeLabel(step) || readableStepDetail(step),
      ]
        .filter(Boolean)
        .join(" · ");
      extra.append(chip);
      return;
    }

    const detail = step.detail || statusText(step);
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      extra.append(small);
    }
  }

  function openStepFile(fileButton) {
    const line = Number(fileButton.getAttribute("data-step-line") || "1");
    fileButton.classList.add("opening");
    fileButton.title = "正在打开 " + (fileButton.getAttribute("data-step-file-path") || "");
    vscode.postMessage({
      type: "openStepFile",
      path: fileButton.getAttribute("data-step-file-path") || "",
      label: fileButton.getAttribute("data-step-file-label") || "",
      line: Number.isFinite(line) ? line : 1,
    });
    setTimeout(() => fileButton.classList.remove("opening"), 1200);
  }

  function collapseRunSteps(bubble, failed = false) {
    const panel = bubble?.querySelector(".run-steps");
    if (!panel) {
      return;
    }
    panel.open = false;
    panel.classList.toggle("failed", failed);
    for (const row of Array.from(
      panel.querySelectorAll(".run-step-row.running, .run-step-row.started"),
    )) {
      row.classList.remove("running", "started");
      row.classList.add(failed ? "failed" : "completed");
      if (row.__step) {
        row.__step.status = failed ? "failed" : "completed";
      }
    }
    updateRunStepsSummary(panel, true, failed);
  }

  function updateRunStepsSummary(panel, done, failed = false) {
    const summary = panel.querySelector(".run-steps-summary");
    const count = panel.querySelectorAll(".run-step-row").length;
    const running = panel.querySelectorAll(
      ".run-step-row.running, .run-step-row.started",
    ).length;
    if (!summary) {
      return;
    }
    const main = summary.querySelector("span");
    const side = summary.querySelector("small");
    if (main) {
      main.textContent = done
        ? failed
          ? "执行中断"
          : `已执行 ${count} 个步骤`
        : running > 0
          ? `正在执行 ${running} 个步骤`
          : "执行步骤";
    }
    if (side) {
      side.textContent = done
        ? "已折叠"
        : count > 0
          ? `${count} 个步骤`
          : "等待工具状态";
    }
  }

  function renderCompact(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.currentOutput = "";
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble) {
      return;
    }
    bubble.classList.add("compacting");
    const badge = bubble.querySelector(".badge");
    if (badge) {
      badge.textContent = "压缩上下文";
    }
    const body = bubble.querySelector(".bubble-body");
    if (body) {
      body.innerHTML = [
        '<span class="compact-line">上下文超出模型窗口，正在整理必要信息</span>',
        '<span class="compact-meter" aria-hidden="true"><i></i><i></i><i></i></span>',
        '<span class="compact-line muted">保留用户意图、活动文件、选区和光标附近代码后继续。</span>',
      ].join("");
    }
    scrollToBottom();
  }

  function finishRun(message) {
    if (message.requestId !== state.currentRequestId) {
      return;
    }
    state.running = false;
    document.body.classList.remove("is-running");
    updateQueueState();

    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble) {
      return;
    }
    bubble.classList.remove("pending");
    bubble.classList.remove("compacting");
    const badge = bubble.querySelector(".badge");
    if (badge) {
      badge.textContent = "完成";
    }
    const body = bubble.querySelector(".bubble-body");
    const finalText = (message.text || state.currentOutput || "").trim();
    if (body) {
      renderMarkdown(body, finalText || "没有输出。");
    }
    if (message.plan && message.plan.length > 0) {
      addPlanCard(bubble, message.plan);
    }
    if (message.review && message.review.fileCount > 0) {
      addReviewActions(bubble, message.review);
    }
    if (message.usage) {
      renderTokenUsage(bubble, message.usage);
    }
    const thinkingPanel = bubble.querySelector(".thinking-panel");
    if (thinkingPanel) {
      thinkingPanel.open = false;
      const summary = thinkingPanel.querySelector(".thinking-summary small");
      if (summary) {
        summary.textContent = "已折叠";
      }
    }
    collapseRunSteps(bubble);
    state.currentRequestId = undefined;
    state.currentThinking = "";
    runNextQueuedPrompt();
    scrollToBottom();
  }

  function updateTokenUsage(message) {
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble || !message.usage) {
      return;
    }
    renderTokenUsage(bubble, message.usage);
  }

  function renderTokenUsage(bubble, usage) {
    const meta = bubble.querySelector(".bubble-meta");
    if (!meta) {
      return;
    }
    let node = meta.querySelector(".token-usage");
    if (!node) {
      node = document.createElement("span");
      node.className = "token-usage";
      meta.append(node);
    }
    node.textContent = formatUsage(usage);
    node.title = formatUsage(usage, true);
  }

  function formatUsage(usage, verbose = false) {
    const input = usage.inputTokens || 0;
    const output = usage.outputTokens || 0;
    const cache =
      (usage.cacheCreationInputTokens || 0) + (usage.cacheReadInputTokens || 0);
    const total = usage.totalTokens || input + output + cache;
    const parts = [];
    if (input || verbose) {
      parts.push(`输入 ${formatTokens(input)}`);
    }
    if (output || verbose) {
      parts.push(`输出 ${formatTokens(output)}`);
    }
    if (cache) {
      parts.push(`缓存 ${formatTokens(cache)}`);
    }
    if (total && !verbose) {
      parts.unshift(`总计 ${formatTokens(total)}`);
    } else if (total) {
      parts.push(`总计 ${formatTokens(total)}`);
    }
    if (typeof usage.totalCostUsd === "number" && usage.totalCostUsd > 0) {
      parts.push(`$${usage.totalCostUsd.toFixed(4)}`);
    }
    return parts.join(" · ") || "token 用量暂无";
  }

  function failRun(message) {
    state.running = false;
    document.body.classList.remove("is-running");
    updateQueueState();
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (bubble) {
      bubble.classList.remove("pending");
      bubble.classList.remove("compacting");
      bubble.classList.add("error");
      const badge = bubble.querySelector(".badge");
      if (badge) {
        badge.textContent = "错误";
      }
      const body = bubble.querySelector(".bubble-body");
      if (body) {
        body.textContent = message.message;
      }
      const thinkingPanel = bubble.querySelector(".thinking-panel");
      if (thinkingPanel) {
        thinkingPanel.open = false;
        thinkingPanel.classList.add("failed");
        const summary = thinkingPanel.querySelector(".thinking-summary small");
        if (summary) {
          summary.textContent = "已中断";
        }
      }
      collapseRunSteps(bubble, true);
    } else {
      timeline.appendChild(
        createBubble("assistant error", message.message, { badge: "错误" }),
      );
    }
    state.currentRequestId = undefined;
    state.currentThinking = "";
    runNextQueuedPrompt();
    scrollToBottom();
  }

  function startSideQuestion(message) {
    document.body.classList.add("has-conversation");
    timeline.appendChild(
      createBubble("user side-question", message.question || "引导", {
        badge: "引导",
        editText: message.question || "",
      }),
    );
    timeline.appendChild(
      createBubble("assistant side-question", "", {
        id: message.requestId,
        badge: "支线回答",
        pending: true,
      }),
    );
    scrollToBottom();
  }

  function finishSideQuestion(message) {
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (!bubble) {
      return;
    }
    bubble.classList.remove("pending");
    const badge = bubble.querySelector(".badge");
    if (badge) {
      badge.textContent = "支线完成";
    }
    const body = bubble.querySelector(".bubble-body");
    if (body) {
      renderMarkdown(body, (message.text || "").trim() || "没有输出。");
    }
    scrollToBottom();
  }

  function failSideQuestion(message) {
    const bubble = document.querySelector(
      `[data-request-id="${message.requestId}"]`,
    );
    if (bubble) {
      bubble.classList.remove("pending");
      bubble.classList.add("error");
      const badge = bubble.querySelector(".badge");
      if (badge) {
        badge.textContent = "引导失败";
      }
      const body = bubble.querySelector(".bubble-body");
      if (body) {
        body.textContent = message.message || "引导发送失败。";
      }
    } else {
      timeline.appendChild(
        createBubble(
          "assistant error side-question",
          message.message || "引导发送失败。",
          {
            badge: "引导失败",
          },
        ),
      );
    }
    scrollToBottom();
  }

  function createBubble(kind, text, options = {}) {
    const article = document.createElement("article");
    article.className = `bubble ${kind}${options.pending ? " pending" : ""}`;
    if (options.id) {
      article.dataset.requestId = options.id;
    }

    const meta = document.createElement("div");
    meta.className = "bubble-meta";
    const role = document.createElement("span");
    role.textContent = kind.includes("user") ? "你" : "HelionCoder";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = options.badge || "提问";
    meta.append(role, badge);

    const body = document.createElement("div");
    body.className = "bubble-body";
    const visibleText = cleanVisibleMessageText(text || "");
    if (kind.includes("assistant")) {
      renderMarkdown(body, visibleText || pendingAssistantText);
    } else {
      body.textContent =
        visibleText || (options.attachments?.length ? "已添加附件" : "");
    }

    article.append(meta, body);
    renderBubbleAttachments(article, options.attachments || []);
    if (kind.includes("user")) {
      addUserMessageActions(
        article,
        options.editText || text || "",
        options.attachments || [],
      );
    }
    return article;
  }

  function addUserMessageActions(bubble, text, attachments) {
    const actions = document.createElement("div");
    actions.className = "bubble-actions user-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "icon-action";
    copy.innerHTML = copyIcon;
    copy.title = "复制";
    copy.setAttribute("aria-label", "复制");
    copy.addEventListener("click", () => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copy.classList.add("copied");
          copy.title = "已复制";
          setTimeout(() => {
            copy.classList.remove("copied");
            copy.title = "复制";
          }, 900);
        })
        .catch(() => undefined);
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-action";
    edit.innerHTML = editIcon;
    edit.title = "编辑";
    edit.setAttribute("aria-label", "编辑");
    edit.addEventListener("click", () => {
      prompt.value = text === "已添加附件" ? "" : text;
      state.attachments = (attachments || []).map((item) => ({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: item.kind,
        label: item.label,
        token: item.token || "",
        src: item.src || "",
        path: item.path || "",
      }));
      renderAttachments();
      prompt.focus();
      updateSuggest();
      updateQueueState();
      composer.scrollIntoView({ block: "nearest" });
    });

    actions.append(copy, edit);
    bubble.append(actions);
  }

  function renderBubbleAttachments(article, attachments) {
    if (!attachments || attachments.length === 0) {
      return;
    }
    const box = document.createElement("div");
    box.className = "bubble-attachments";
    for (const item of attachments) {
      const card = document.createElement("div");
      card.className = `bubble-attachment ${item.kind}`;
      if (item.kind === "image" && item.src) {
        card.type = "button";
        card.title = "点击放大查看";
        const image = document.createElement("img");
        image.src = item.src;
        image.alt = item.label || "图片";
        const name = document.createElement("span");
        name.textContent = item.label || "图片";
        card.addEventListener("click", () => {
          showImagePreview(item.src, item.label || "图片");
        });
        card.append(image, name);
      } else {
        card.innerHTML = `<span class="file-glyph">${item.kind === "workspace" ? "文件夹" : "文件"}</span><b>${escapeHtml(item.label || "附件")}</b>`;
      }
      box.append(card);
    }
    article.append(box);
  }

  function showImagePreview(src, label) {
    const existing = document.querySelector(".image-preview");
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement("div");
    overlay.className = "image-preview";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "image-preview-panel";

    const header = document.createElement("div");
    header.className = "image-preview-header";
    const title = document.createElement("strong");
    title.textContent = label || "图片";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭预览");
    close.textContent = "关闭";
    header.append(title, close);

    const image = document.createElement("img");
    image.src = src;
    image.alt = label || "图片";
    panel.append(header, image);
    overlay.append(panel);

    const dismiss = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        dismiss();
      }
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay);
  }

  function renderHistoryConversation(message) {
    state.currentRequestId = undefined;
    state.currentOutput = "";
    state.running = false;
    state.queue = [];
    state.hasConversation = true;
    state.conversationTitle = message.title || message.sessionId || "历史会话";
    document.body.classList.remove("is-running");
    document.body.classList.add("has-conversation");
    updateQueueState();
    renderHeader();

    timeline.innerHTML = "";
    const header = document.createElement("article");
    header.className = "history-header";
    header.innerHTML = [
      `<strong>${message.restored ? "当前对话" : "历史会话"}</strong>`,
      `<span>${escapeHtml(message.title || message.sessionId || "HelionCoder session")}</span>`,
    ].join("");
    timeline.append(header);

    if (message.historyItems && message.historyItems.length > 0) {
      const list = document.createElement("div");
      list.className = "recent-task-list history-task-list";
      for (const item of message.historyItems) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recent-task";
        const title = document.createElement("span");
        title.textContent = item.title || "未命名任务";
        const meta = document.createElement("small");
        meta.textContent = `${formatRelativeTime(item.timestamp)} · ${item.messageCount || 0} 条消息`;
        button.append(title, meta);
        button.addEventListener("click", () => {
          if (item.id) {
            vscode.postMessage({ type: "openRecentHistory", id: item.id });
          }
        });
        list.append(button);
      }
      timeline.append(list);
      scrollToBottom({ force: true });
      return;
    }

    for (const item of message.messages || []) {
      const visibleText = cleanVisibleMessageText(item.text || "");
      if (!visibleText) {
        continue;
      }
      timeline.appendChild(
        createBubble(
          item.role === "user" ? "user" : "assistant",
          visibleText,
          {
            badge: item.timestamp
              ? new Date(item.timestamp).toLocaleString()
              : "历史",
            editText: item.role === "user" ? visibleText : undefined,
          },
        ),
      );
    }
    scrollToBottom({ force: true });
  }

  function addPlanCard(bubble, plan) {
    const card = document.createElement("details");
    card.className = "plan-card";
    card.open = true;
    const header = document.createElement("summary");
    header.className = "plan-header";
    header.textContent = `共 ${plan.length} 个任务，等待确认`;
    const list = document.createElement("ol");
    plan.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    });
    card.append(header, list);
    bubble.append(card);
  }

  function addReviewActions(bubble, review) {
    const panel = document.createElement("div");
    panel.className = "review-panel";
    panel.dataset.reviewId = review.id;
    const totalAdded = review.files.reduce(
      (sum, file) => sum + (file.added || 0),
      0,
    );
    const totalRemoved = review.files.reduce(
      (sum, file) => sum + (file.removed || 0),
      0,
    );
    const bar = document.createElement("div");
    bar.className = "review-status-bar";
    bar.innerHTML = [
      `<span>${review.fileCount} 个文件已更改</span>`,
      `<b class="added">+${totalAdded}</b>`,
      `<b class="removed">-${totalRemoved}</b>`,
    ].join("");
    const open = reviewButton("查看更改", () =>
      vscode.postMessage({ type: "openChanges", reviewId: review.id }),
    );
    open.className = "review-open";
    open.dataset.reviewAction = "openChanges";
    open.dataset.reviewId = review.id;
    bar.append(open);

    const files = document.createElement("details");
    files.className = "review-files";
    const filesSummary = document.createElement("summary");
    filesSummary.textContent = "文件列表";
    files.append(filesSummary);
    for (const [index, file] of review.files.entries()) {
      const row = document.createElement("details");
      row.className = "review-file";
      const summary = document.createElement("summary");
      summary.className = "review-file-summary";
      summary.innerHTML = [
        `<i>${escapeHtml(file.kindLabel || "修改")}</i>`,
        `<span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>`,
        `<small>${escapeHtml(file.location || "")}</small>`,
        `<b class="added">+${file.added || 0}</b>`,
        `<b class="removed">-${file.removed || 0}</b>`,
      ].join("");
      const body = document.createElement("div");
      body.className = "review-file-body";
      const text = document.createElement("p");
      text.textContent =
        file.summary || `${file.kindLabel || "修改"} ${file.path}`;
      const fileActions = document.createElement("div");
      fileActions.className = "review-file-actions";
      fileActions.append(
        reviewButton("预览这个文件", () => {
          vscode.postMessage({
            type: "openChange",
            reviewId: review.id,
            index,
          });
        }, {
          action: "openChange",
          reviewId: review.id,
          index,
        }),
      );
      body.append(text, fileActions);
      row.append(summary, body);
      files.append(row);
    }
    const actions = document.createElement("div");
    actions.className = "review-actions";
    actions.append(
      reviewButton("全部接受", () =>
        vscode.postMessage({ type: "acceptChanges", reviewId: review.id }),
      { action: "acceptChanges", reviewId: review.id }),
      reviewButton("预览修改", () =>
        vscode.postMessage({ type: "openChanges", reviewId: review.id }),
      { action: "openChanges", reviewId: review.id }),
      reviewButton("拒绝修改", () =>
        vscode.postMessage({ type: "rejectChanges", reviewId: review.id }),
      { action: "rejectChanges", reviewId: review.id }),
    );
    panel.append(bar, files, actions);
    bubble.append(panel);
  }

  function reviewButton(text, onClick, metadata = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (metadata.action) {
      button.dataset.reviewAction = metadata.action;
    }
    if (metadata.reviewId) {
      button.dataset.reviewId = metadata.reviewId;
    }
    if (metadata.index !== undefined) {
      button.dataset.reviewIndex = String(metadata.index);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add("opening");
      onClick(event);
      setTimeout(() => button.classList.remove("opening"), 1200);
    });
    return button;
  }

  function runReviewAction(button) {
    const type = button.dataset.reviewAction;
    const reviewId = button.dataset.reviewId || "";
    if (!type || !reviewId) {
      return;
    }
    button.classList.add("opening");
    const message = { type, reviewId };
    if (button.dataset.reviewIndex !== undefined) {
      const index = Number(button.dataset.reviewIndex);
      if (Number.isFinite(index)) {
        message.index = index;
      }
    }
    vscode.postMessage(message);
    setTimeout(() => button.classList.remove("opening"), 1200);
  }

  function renderMarkdown(container, text) {
    container.classList.add("markdown-body");
    container.innerHTML = renderMarkdownHtml(text);
    enhanceMarkdown(container);
  }

  function renderMarkdownHtml(text) {
    const renderer = getMarkdownRenderer();
    return renderer ? renderer.render(text) : markdownToHtml(text);
  }

  function getMarkdownRenderer() {
    if (markdownRenderer !== undefined) {
      return markdownRenderer;
    }
    const factory = window.markdownit || window.markdownIt;
    markdownRenderer = factory
      ? factory({
          html: false,
          linkify: true,
          breaks: true,
          typographer: false,
        })
      : undefined;
    return markdownRenderer;
  }

  function enhanceMarkdown(container) {
    enhanceMath(container);
    for (const table of Array.from(container.querySelectorAll("table"))) {
      if (table.parentElement?.classList.contains("table-scroll")) {
        continue;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "table-scroll";
      table.parentNode.insertBefore(wrapper, table);
      wrapper.append(table);
    }
    for (const link of Array.from(container.querySelectorAll("a[href]"))) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    }
    for (const pre of Array.from(container.querySelectorAll("pre"))) {
      if (pre.parentElement?.classList.contains("code-block-wrap")) {
        continue;
      }
      const code = pre.querySelector("code");
      const languageName = codeLanguageName(code);
      applyCodeHighlight(code, languageName);
      const wrapper = document.createElement("details");
      wrapper.className = "code-block-wrap";
      wrapper.open = true;
      const summary = document.createElement("summary");
      summary.className = "code-block-head";
      const language = document.createElement("span");
      language.className = "code-block-language";
      language.textContent = codeLanguageLabel(languageName);
      const actions = document.createElement("span");
      actions.className = "code-block-actions";
      const insertButton = document.createElement("button");
      insertButton.type = "button";
      insertButton.className = "code-block-action code-insert";
      insertButton.dataset.insertCode = "true";
      insertButton.title = "插入到光标位置";
      insertButton.setAttribute("aria-label", "插入到光标位置");
      insertButton.innerHTML = insertIcon;
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "code-block-action code-copy";
      copyButton.dataset.copyCode = "true";
      copyButton.title = "复制代码";
      copyButton.setAttribute("aria-label", "复制代码");
      copyButton.innerHTML = copyIcon;
      actions.append(insertButton, copyButton);
      summary.append(language, actions);
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.append(summary, pre);
    }
  }

  function codeLanguageName(code) {
    const className = code?.className || "";
    const raw = String(className)
      .split(/\s+/)
      .map((item) => item.match(/^(?:language|lang)-(.+)$/)?.[1])
      .find(Boolean);
    return String(raw || "")
      .trim()
      .toLowerCase();
  }

  function codeLanguageLabel(languageName) {
    const normalized = String(languageName || "")
      .trim()
      .toLowerCase();
    const labels = {
      bash: "Shell",
      cjs: "JavaScript",
      css: "CSS",
      html: "HTML",
      js: "JavaScript",
      javascript: "JavaScript",
      json: "JSON",
      jsx: "React JSX",
      markdown: "Markdown",
      md: "Markdown",
      py: "Python",
      python: "Python",
      sh: "Shell",
      shell: "Shell",
      ts: "TypeScript",
      tsx: "React TSX",
      typescript: "TypeScript",
      xml: "XML",
      yaml: "YAML",
      yml: "YAML",
      zsh: "Shell",
    };
    return (
      labels[normalized] || (normalized ? normalized.toUpperCase() : "文本")
    );
  }

  function applyCodeHighlight(code, languageName) {
    if (!code) {
      return;
    }
    const text = code.textContent || "";
    code.innerHTML = highlightCode(text, languageName);
  }

  function highlightCode(text, languageName) {
    const language = String(languageName || "").toLowerCase();
    if (language === "json") {
      return highlightJson(text);
    }
    if (language === "html" || language === "xml") {
      return highlightMarkup(text);
    }
    return highlightProgramLikeCode(text, language);
  }

  function highlightProgramLikeCode(text, language) {
    const keywords = keywordSetForLanguage(language);
    const constants = new Set([
      "true",
      "false",
      "null",
      "none",
      "undefined",
      "nan",
      "inf",
    ]);
    const builtins = new Set(
      [
        "dict",
        "enumerate",
        "float",
        "int",
        "len",
        "list",
        "map",
        "open",
        "print",
        "range",
        "set",
        "str",
        "sum",
        "tuple",
        "Array",
        "Boolean",
        "Date",
        "JSON",
        "Math",
        "Number",
        "Object",
        "Promise",
        "String",
        "console",
        "document",
        "window",
      ].map((item) => item.toLowerCase()),
    );
    const isPython = ["py", "python"].includes(language);
    const isShell = ["bash", "sh", "shell", "zsh"].includes(language);
    const isCss = language === "css";
    const isJsLike = [
      "cjs",
      "js",
      "javascript",
      "jsx",
      "ts",
      "tsx",
      "typescript",
    ].includes(language);
    let index = 0;
    let html = "";

    while (index < text.length) {
      const char = text[index];
      const next = text[index + 1];

      if ((isPython || isShell) && char === "#") {
        const end = readUntilLineEnd(text, index);
        html += syntaxSpan("comment", text.slice(index, end));
        index = end;
        continue;
      }

      if ((isJsLike || isCss) && char === "/" && next === "/") {
        const end = readUntilLineEnd(text, index);
        html += syntaxSpan("comment", text.slice(index, end));
        index = end;
        continue;
      }

      if ((isJsLike || isCss) && char === "/" && next === "*") {
        const end = text.indexOf("*/", index + 2);
        const stop = end === -1 ? text.length : end + 2;
        html += syntaxSpan("comment", text.slice(index, stop));
        index = stop;
        continue;
      }

      if (char === '"' || char === "'" || (isJsLike && char === "`")) {
        const end = readString(text, index, char, isPython);
        html += syntaxSpan("string", text.slice(index, end));
        index = end;
        continue;
      }

      if (/[0-9]/.test(char)) {
        const match = text
          .slice(index)
          .match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
        if (match) {
          html += syntaxSpan("number", match[0]);
          index += match[0].length;
          continue;
        }
      }

      if (/[A-Za-z_$]/.test(char)) {
        const match = text.slice(index).match(/^[A-Za-z_$][\w$]*/);
        if (match) {
          const word = match[0];
          const lower = word.toLowerCase();
          const after = nextNonWhitespace(text, index + word.length);
          if (keywords.has(lower)) {
            html += syntaxSpan("keyword", word);
          } else if (constants.has(lower)) {
            html += syntaxSpan("constant", word);
          } else if (builtins.has(lower)) {
            html += syntaxSpan("builtin", word);
          } else if (after === "(") {
            html += syntaxSpan("function", word);
          } else if (isCss && after === ":") {
            html += syntaxSpan("property", word);
          } else {
            html += escapeHtml(word);
          }
          index += word.length;
          continue;
        }
      }

      if (/[-+*/%=!<>|&^~?:.,;()[\]{}]/.test(char)) {
        html += syntaxSpan("operator", char);
        index += 1;
        continue;
      }

      html += escapeHtml(char);
      index += 1;
    }

    return html;
  }

  function highlightJson(text) {
    let index = 0;
    let html = "";
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        const end = readString(text, index, '"', false);
        const raw = text.slice(index, end);
        const after = nextNonWhitespace(text, end);
        html += syntaxSpan(after === ":" ? "property" : "string", raw);
        index = end;
        continue;
      }
      const primitive = text
        .slice(index)
        .match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (primitive) {
        html += syntaxSpan(
          /[a-z]/i.test(primitive[0][0]) ? "constant" : "number",
          primitive[0],
        );
        index += primitive[0].length;
        continue;
      }
      if (/[:,[\]{}]/.test(char)) {
        html += syntaxSpan("operator", char);
      } else {
        html += escapeHtml(char);
      }
      index += 1;
    }
    return html;
  }

  function highlightMarkup(text) {
    return escapeHtml(text).replace(
      /(&lt;\/?)([A-Za-z][\w:-]*)((?:(?!&lt;).)*?)(\/?&gt;)/g,
      (_match, open, tag, rest, close) =>
        `${syntaxSpan("operator", htmlUnescape(open))}${syntaxSpan("keyword", tag)}${highlightMarkupAttributes(htmlUnescape(rest))}${syntaxSpan("operator", htmlUnescape(close))}`,
    );
  }

  function highlightMarkupAttributes(value) {
    return escapeHtml(value).replace(
      /([\w:-]+)(=)(&quot;.*?&quot;|'.*?')/g,
      (_match, name, equals, quoted) =>
        `${syntaxSpan("property", name)}${syntaxSpan("operator", equals)}${syntaxSpan("string", htmlUnescape(quoted))}`,
    );
  }

  function keywordSetForLanguage(language) {
    const python = [
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "del",
      "elif",
      "else",
      "except",
      "finally",
      "for",
      "from",
      "global",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "try",
      "while",
      "with",
      "yield",
    ];
    const js = [
      "as",
      "async",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "debugger",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "finally",
      "for",
      "from",
      "function",
      "if",
      "import",
      "in",
      "instanceof",
      "let",
      "new",
      "of",
      "return",
      "switch",
      "this",
      "throw",
      "try",
      "typeof",
      "var",
      "void",
      "while",
      "with",
      "yield",
    ];
    const shell = [
      "case",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "then",
      "until",
      "while",
    ];
    const css = ["important", "media", "supports"];
    const selected = ["py", "python"].includes(language)
      ? python
      : ["bash", "sh", "shell", "zsh"].includes(language)
        ? shell
        : language === "css"
          ? css
          : js;
    return new Set(selected.map((item) => item.toLowerCase()));
  }

  function readString(text, start, quote, allowTriple) {
    const triple =
      allowTriple && text.slice(start, start + 3) === quote.repeat(3);
    let index = start + (triple ? 3 : 1);
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (triple && text.slice(index, index + 3) === quote.repeat(3)) {
        return index + 3;
      }
      if (!triple && text[index] === quote) {
        return index + 1;
      }
      index += 1;
    }
    return text.length;
  }

  function readUntilLineEnd(text, start) {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }

  function nextNonWhitespace(text, start) {
    const match = text.slice(start).match(/\S/);
    return match ? match[0] : "";
  }

  function syntaxSpan(kind, value) {
    return `<span class="syntax-${kind}">${escapeHtml(value)}</span>`;
  }

  function htmlUnescape(value) {
    return String(value)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function markdownToHtml(text) {
    const blocks = [];
    const lines = text.split(/\r?\n/);
    let inCode = false;
    let code = [];
    let list = [];
    let listType = "ul";

    function flushList() {
      if (list.length) {
        blocks.push(
          `<${listType}>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`,
        );
        list = [];
      }
    }

    function pushList(type, item) {
      if (list.length && listType !== type) {
        flushList();
      }
      listType = type;
      list.push(item);
    }

    function flushCode() {
      if (code.length) {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.startsWith("```")) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }
      if (isTableRow(line) && isTableDivider(lines[index + 1] || "")) {
        flushList();
        const header = splitTableRow(line);
        index += 2;
        const rows = [];
        while (index < lines.length && isTableRow(lines[index])) {
          rows.push(splitTableRow(lines[index]));
          index += 1;
        }
        index -= 1;
        blocks.push(renderTable(header, rows));
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        pushList("ul", line.replace(/^\s*[-*]\s+/, ""));
        continue;
      }
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (numbered) {
        pushList("ol", numbered[1]);
        continue;
      }
      flushList();
      if (!line.trim()) {
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const quote = line.match(/^>\s?(.+)$/);
      if (heading) {
        const level = heading[1].length + 2;
        blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      } else if (quote) {
        blocks.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      } else {
        blocks.push(`<p>${inlineMarkdown(line)}</p>`);
      }
    }
    flushList();
    flushCode();
    return blocks.join("");
  }

  function isTableRow(line) {
    return line.includes("|") && splitTableRow(line).length > 1;
  }

  function isTableDivider(line) {
    const cells = splitTableRow(line);
    return (
      cells.length > 1 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
    );
  }

  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) {
      value = value.slice(1);
    }
    if (value.endsWith("|")) {
      value = value.slice(0, -1);
    }
    return value.split("|").map((cell) => cell.trim());
  }

  function renderTable(header, rows) {
    const width = header.length;
    const head = header
      .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
      .join("");
    const body = rows
      .map((row) => {
        const normalized = Array.from(
          { length: width },
          (_, index) => row[index] || "",
        );
        return `<tr>${normalized.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`;
      })
      .join("");
    return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function inlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function enhanceMath(container) {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !hasMathDelimiter(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest("code, pre, kbd, samp, textarea, .math-inline, .math-display")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      const fragment = renderMathTextNode(node.nodeValue || "");
      if (fragment) {
        node.parentNode?.replaceChild(fragment, node);
      }
    }
    enhanceLooseMathWords(container);
  }

  function hasMathDelimiter(value) {
    return (
      value.includes("$") ||
      value.includes("\\(") ||
      value.includes("\\[")
    );
  }

  function renderMathTextNode(value) {
    const parts = splitMathSegments(value);
    if (!parts.some((part) => part.math)) {
      return null;
    }
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part.math) {
        fragment.append(document.createTextNode(part.text));
        continue;
      }
      const element = document.createElement(part.display ? "div" : "span");
      element.className = part.display ? "math-display" : "math-inline";
      element.textContent = formatLatexMath(part.text);
      element.title = part.text;
      fragment.append(element);
    }
    return fragment;
  }

  function splitMathSegments(value) {
    const parts = [];
    let index = 0;
    while (index < value.length) {
      const start = findNextMathStart(value, index);
      if (!start) {
        parts.push({ text: value.slice(index), math: false });
        break;
      }
      if (start.index > index) {
        parts.push({ text: value.slice(index, start.index), math: false });
      }
      const close = value.indexOf(start.close, start.index + start.open.length);
      if (close === -1) {
        parts.push({ text: value.slice(start.index), math: false });
        break;
      }
      const contentStart = start.index + start.open.length;
      parts.push({
        text: value.slice(contentStart, close),
        math: true,
        display: start.display,
      });
      index = close + start.close.length;
    }
    return parts.filter((part) => part.text.length > 0);
  }

  function findNextMathStart(value, from) {
    const candidates = [
      { open: "$$", close: "$$", display: true },
      { open: "\\[", close: "\\]", display: true },
      { open: "\\(", close: "\\)", display: false },
      { open: "$", close: "$", display: false },
    ]
      .map((candidate) => ({
        ...candidate,
        index: value.indexOf(candidate.open, from),
      }))
      .filter((candidate) => candidate.index >= 0)
      .filter((candidate) => candidate.open !== "$" || isLikelyInlineMath(value, candidate.index));
    candidates.sort((a, b) => a.index - b.index || b.open.length - a.open.length);
    return candidates[0];
  }

  function isLikelyInlineMath(value, index) {
    if (value[index - 1] === "\\") {
      return false;
    }
    const close = value.indexOf("$", index + 1);
    if (close === -1 || value[close - 1] === "\\") {
      return false;
    }
    const content = value.slice(index + 1, close).trim();
    if (!content || /\s{2,}/.test(content)) {
      return false;
    }
    return /\\|[=^_{}]|[A-Za-z]\s*[+\-*/≈≤≥→]|[+\-*/≈≤≥→]\s*[A-Za-z0-9]/.test(content);
  }

  function formatLatexMath(value) {
    let text = value.trim();
    text = replaceLatexFractions(text);
    text = text
      .replace(/\\left|\\right/g, "")
      .replace(/\\cdot|\\times/g, "×")
      .replace(/\\div/g, "÷")
      .replace(/\\pm/g, "±")
      .replace(/\\approx/g, "≈")
      .replace(/\\neq/g, "≠")
      .replace(/\\leq?/g, "≤")
      .replace(/\\geq?/g, "≥")
      .replace(/\\(?:Rightarrow|Longrightarrow)\b/g, "⇒")
      .replace(/\\(?:Leftarrow|Longleftarrow)\b/g, "⇐")
      .replace(/\\(?:Leftrightarrow|Longleftrightarrow|iff)\b/g, "⇔")
      .replace(/\\(?:rightarrow|to|rarr|longrightarrow|implies|arrow)\b/g, "→")
      .replace(/\\(?:leftarrow|gets|larr|longleftarrow)\b/g, "←")
      .replace(/\\(?:leftrightarrow|longleftrightarrow)\b/g, "↔")
      .replace(/\\infty/g, "∞")
      .replace(/\\sum/g, "∑")
      .replace(/\\prod/g, "∏")
      .replace(/\\int/g, "∫")
      .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
      .replace(/\\(sin|cos|tan|ln|log|exp|arcsin|arccos|arctan)\b/g, "$1")
      .replace(/\\pi/g, "π")
      .replace(/\\theta/g, "θ")
      .replace(/\\alpha/g, "α")
      .replace(/\\beta/g, "β")
      .replace(/\\gamma/g, "γ")
      .replace(/\\Delta/g, "Δ")
      .replace(/\\delta/g, "δ")
      .replace(/\\lambda/g, "λ")
      .replace(/\\mu/g, "μ")
      .replace(/\\sigma/g, "σ")
      .replace(/\\omega/g, "ω")
      .replace(/\^\{([^{}]+)\}/g, (_, body) => toSuperscript(body))
      .replace(/\^([A-Za-z0-9+\-=()])/g, (_, body) => toSuperscript(body))
      .replace(/_\{([^{}]+)\}/g, (_, body) => toSubscript(body))
      .replace(/_([A-Za-z0-9+\-=()])/g, (_, body) => toSubscript(body))
      .replace(/[{}]/g, "")
      .replace(/\\,/g, " ")
      .replace(/\\/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text || value;
  }

  function replaceLatexFractions(value) {
    let text = value;
    for (let i = 0; i < 8; i += 1) {
      const next = text.replace(
        /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
        "($1)/($2)",
      );
      if (next === text) {
        break;
      }
      text = next;
    }
    return text;
  }

  function toSuperscript(value) {
    const map = {
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
      "+": "⁺",
      "-": "⁻",
      "=": "⁼",
      "(": "⁽",
      ")": "⁾",
      n: "ⁿ",
      i: "ⁱ",
    };
    return String(value)
      .split("")
      .map((char) => map[char] || char)
      .join("");
  }

  function toSubscript(value) {
    const map = {
      "0": "₀",
      "1": "₁",
      "2": "₂",
      "3": "₃",
      "4": "₄",
      "5": "₅",
      "6": "₆",
      "7": "₇",
      "8": "₈",
      "9": "₉",
      "+": "₊",
      "-": "₋",
      "=": "₌",
      "(": "₍",
      ")": "₎",
      a: "ₐ",
      e: "ₑ",
      h: "ₕ",
      i: "ᵢ",
      j: "ⱼ",
      k: "ₖ",
      l: "ₗ",
      m: "ₘ",
      n: "ₙ",
      o: "ₒ",
      p: "ₚ",
      r: "ᵣ",
      s: "ₛ",
      t: "ₜ",
      u: "ᵤ",
      v: "ᵥ",
      x: "ₓ",
    };
    return String(value)
      .split("")
      .map((char) => map[char] || char)
      .join("");
  }

  function enhanceLooseMathWords(container) {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !/\barrow\b/.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (!parent || parent.closest("code, pre, kbd, samp, textarea")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      node.nodeValue = node.nodeValue.replace(/\barrow\b/g, "→");
    }
  }

  function cleanVisibleMessageText(value) {
    let text = stripInternalPromptText(String(value || ""));
    text = text.replace(/\$\\arrow\$/g, "$\\rightarrow$");
    return text.trim();
  }

  function stripLeakedConversationPrompt(value) {
    const text = String(value || "").trim();
    if (!text.startsWith("Previous conversation context from this VS Code assistant panel.")) {
      return text;
    }
    const currentRequest = text.match(/\n\nCurrent user request:\s*\n/i);
    if (currentRequest?.index !== undefined) {
      const afterCurrentRequest = text.slice(
        currentRequest.index + currentRequest[0].length,
      );
      const answerStart = afterCurrentRequest.search(
        /\n\n(?:#{1,6}\s|\d+[.)]\s|[-*]\s|\*\*)/,
      );
      if (answerStart >= 0) {
        return afterCurrentRequest.slice(answerStart).trim();
      }
      return afterCurrentRequest.trim();
    }
    return "";
  }

  function stripLeakedEditorContextPrompt(value) {
    const text = String(value || "").trim();
    if (!text.startsWith("You are HelionCoder running inside VS Code")) {
      return text;
    }
    const matches = Array.from(text.matchAll(/\nUser request:\s*\n/gi));
    const marker = matches.at(-1);
    if (!marker?.index) {
      return "";
    }
    return text.slice(marker.index + marker[0].length).trim();
  }

  function stripInternalPromptText(value) {
    let text = String(value || "").trim();
    for (let index = 0; index < 6; index += 1) {
      const next = stripLeakedConversationPrompt(
        stripLeakedEditorContextPrompt(text),
      ).trim();
      if (next === text) {
        break;
      }
      text = next;
    }
    return text;
  }

  function titleForMode(mode) {
    const titles = {
      ask: "提问",
      explain: "解释",
      fix: "修复",
      complete: "补全",
      tests: "测试",
      review: "审查",
      refactor: "重构",
      docs: "文档",
      optimize: "优化",
    };
    return titles[mode] || "提问";
  }

  function isTimelineAtBottom() {
    const distance =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    return distance <= autoScrollBottomThreshold;
  }

  function scrollToBottom({ force = false } = {}) {
    if (!force && !state.shouldAutoScroll) {
      return;
    }
    requestAnimationFrame(() => {
      if (!force && !state.shouldAutoScroll) {
        return;
      }
      timeline.scrollTop = timeline.scrollHeight;
      state.shouldAutoScroll = true;
    });
  }

  function basename(value) {
    return (
      String(value || "")
        .split(/[\\/]/)
        .filter(Boolean)
        .pop() || String(value || "")
    );
  }

  function lineRangeLabel(step) {
    if (step.lineStart === undefined) {
      return "";
    }
    return step.lineEnd === undefined
      ? `${step.lineStart} 行起`
      : `${step.lineStart}~${step.lineEnd} 行`;
  }

  function readableStepDetail(step) {
    if (!/^read$/i.test(step.toolName || "")) {
      return step.detail || "";
    }
    const range = readLineRangeFromDetail(
      step.toolName,
      step.detail,
      step.lineStart,
    );
    if (!range) {
      return step.detail || "";
    }
    return lineRangeLabel({ ...step, ...range });
  }

  function readLineRangeFromDetail(toolName, detail, lineStart) {
    if (!/^read$/i.test(toolName || "") || !detail) {
      return undefined;
    }
    const text = String(detail).trim();
    const match =
      text.match(/(?:^|\b)read\s+(\d+)\s+(?:lines?|行)(?:\b|$)/i) ||
      text.match(/^(\d+)\s*(?:lines?|行)?$/i);
    if (!match) {
      return undefined;
    }
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) {
      return undefined;
    }
    const start = Number.isFinite(Number(lineStart)) ? Number(lineStart) : 1;
    return {
      lineStart: start,
      lineEnd: start + Math.max(0, count - 1),
    };
  }

  function statusText(step) {
    if (step.status === "completed") {
      return "完成";
    }
    if (step.status === "failed") {
      return "失败";
    }
    if (step.elapsedSeconds !== undefined) {
      return `已运行 ${Math.round(step.elapsedSeconds)} 秒`;
    }
    return "";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function truncateTitle(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 18 ? `${text.slice(0, 18)}...` : text || "对话";
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) {
      return "";
    }
    const diff = Math.max(0, Date.now() - Number(timestamp));
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < hour) {
      return `${Math.max(1, Math.round(diff / minute))} 分钟`;
    }
    if (diff < day) {
      return `${Math.round(diff / hour)} 小时`;
    }
    return `${Math.round(diff / day)} 天`;
  }

  function clearLandingMessage() {
    const empty = timeline.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }
  }

  function renderHeader() {
    document.body.classList.toggle(
      "conversation-open",
      state.hasConversation || state.running,
    );
    headerTitle.textContent =
      state.hasConversation || state.running
        ? truncateTitle(state.conversationTitle || "对话")
        : "任务";
  }

  function renderTaskHome() {
    state.hasConversation = false;
    state.currentRequestId = undefined;
    state.currentOutput = "";
    document.body.classList.remove("is-running");
    document.body.classList.remove("has-conversation");
    renderHeader();
    updateQueueState();

    const rows = (state.recentHistory || []).slice(0, 3);
    timeline.innerHTML = "";
    const home = document.createElement("article");
    home.className = "task-home";
    const list = document.createElement("div");
    list.className = "recent-task-list";
    if (rows.length > 0) {
      for (const item of rows) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recent-task";
        button.dataset.historyId = item.id || "";
        const title = document.createElement("span");
        title.textContent = item.title || "未命名任务";
        const time = document.createElement("small");
        time.textContent = formatRelativeTime(item.timestamp);
        button.append(title, time);
        button.addEventListener("click", () => {
          if (item.id) {
            vscode.postMessage({ type: "openRecentHistory", id: item.id });
          }
        });
        list.append(button);
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "recent-empty";
      empty.textContent = "还没有历史任务";
      list.append(empty);
    }
    const all = document.createElement("button");
    all.type = "button";
    all.className = "recent-all";
    all.textContent = `查看全部（${state.recentHistoryTotal || rows.length} 个）`;
    all.addEventListener("click", () =>
      vscode.postMessage({ type: "showHistory" }),
    );
    home.append(list, all);
    timeline.append(home);
  }

  function resetConversation() {
    state.currentRequestId = undefined;
    state.currentOutput = "";
    state.running = false;
    state.queue = [];
    state.attachments = [];
    state.hasConversation = false;
    state.conversationTitle = "任务";
    document.body.classList.remove("is-running");
    document.body.classList.remove("has-conversation");
    renderAttachments();
    renderTaskHome();
    prompt.focus();
  }

  function enqueuePrompt(
    value,
    attachments = [],
    displayPrompt = value,
    editPrompt = value,
    options = {},
  ) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      value,
      attachments,
      displayPrompt,
      editPrompt,
      guide: Boolean(options.guide) || isGuidePrompt(value),
    };
    state.queue.push(item);
    updateQueueState();
    const note = document.createElement("article");
    note.className = "queue-note";
    note.dataset.queueId = item.id;

    const label = document.createElement("span");
    label.className = "queue-note-text";
    label.textContent = `已排队：${displayPrompt || value}`;
    note.append(label);

    const actions = document.createElement("span");
    actions.className = "queue-actions";

    if (!item.guide) {
      const guideButton = document.createElement("button");
      guideButton.type = "button";
      guideButton.className = "queue-guide";
      guideButton.textContent = "引导";
      guideButton.title = "把这一条改为后续引导";
      guideButton.addEventListener("click", () => {
        convertQueuedItemToGuide(item, label, guideButton);
      });
      actions.append(guideButton);
    }

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "queue-edit";
    editButton.textContent = "编辑";
    editButton.title = "编辑这条排队消息";
    editButton.addEventListener("click", () => {
      editQueuedItem(item, note);
    });
    actions.append(editButton);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "queue-cancel";
    cancelButton.textContent = "取消";
    cancelButton.title = "取消这条排队消息";
    cancelButton.addEventListener("click", () => {
      removeQueuedItem(item.id, note);
    });
    actions.append(cancelButton);
    note.append(actions);

    timeline.append(note);
    scrollToBottom();
  }

  function editQueuedItem(item, note) {
    removeQueuedItem(item.id, note);
    prompt.value = item.editPrompt || item.displayPrompt || item.value || "";
    state.attachments = (item.attachments || []).map((attachment) => ({
      ...attachment,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }));
    renderAttachments();
    prompt.focus();
    updateSuggest();
    updateQueueState();
  }

  function removeQueuedItem(id, note) {
    state.queue = state.queue.filter((queued) => queued.id !== id);
    note?.remove();
    updateQueueState();
  }

  function convertQueuedItemToGuide(item, label, button) {
    if (item.guide || isGuidePrompt(item.value)) {
      return;
    }
    const source = (
      item.editPrompt ||
      item.displayPrompt ||
      item.value ||
      ""
    ).trim();
    const guidedDisplay = formatGuideDisplay(
      source || item.displayPrompt || item.value,
    );
    state.queue = state.queue.filter((queued) => queued.id !== item.id);
    label.textContent = `引导中：${guidedDisplay}`;
    button.remove();
    sendSideQuestion(source || item.value, guidedDisplay);
    updateQueueState();
  }

  function isGuidePrompt(value) {
    return (value || "").trim().startsWith(guidePromptPrefix);
  }

  function buildGuidePrompt(value) {
    return `${guidePromptPrefix}\n\n${(value || "").trim()}`.trim();
  }

  function formatGuideDisplay(value) {
    return `引导：${(value || "").trim()}`.trim();
  }

  function runNextQueuedPrompt() {
    updateQueueState();
    const next = state.queue.shift();
    if (!next) {
      updateQueueState();
      return;
    }
    updateQueueState();
    if (typeof next === "string") {
      vscode.postMessage({ type: "ask", prompt: next, mode: "ask" });
      return;
    }
    if (next.guide) {
      sendSideQuestion(
        next.editPrompt || next.displayPrompt || next.value,
        next.displayPrompt,
      );
      return;
    }
    vscode.postMessage({
      type: "ask",
      prompt: next.value,
      displayPrompt: next.displayPrompt,
      editPrompt: next.editPrompt,
      attachments: next.attachments,
      mode: "ask",
    });
  }

  function sendSideQuestion(value, displayPrompt) {
    vscode.postMessage({
      type: "sideQuestion",
      question: value,
      displayPrompt: displayPrompt || formatGuideDisplay(value),
    });
  }

  function updateQueueState() {
    const send = document.querySelector(".send");
    const hasPendingInput = Boolean(
      prompt.value.trim() || state.attachments.length,
    );
    if (send) {
      const stopMode = state.running && !hasPendingInput;
      send.innerHTML = stopMode ? stopIcon : sendIcon;
      send.title = stopMode
        ? "停止当前回复"
        : state.running
          ? "发送后续要求，当前回复完成后执行"
          : "发送";
      send.classList.toggle("is-stop", stopMode);
      send.classList.toggle("is-send", !stopMode);
      send.setAttribute("aria-label", send.title);
    }
    guide.hidden = !state.running || !hasPendingInput;
    guide.disabled = !state.running || !prompt.value.trim();
    stop.hidden = true;
    prompt.placeholder = state.running
      ? "输入后续要求"
      : "询问 Helion，或输入 @ 添加上下文";
  }

  function renderModels(models, selected) {
    const previous = modelSelect.value;
    modelSelect.innerHTML = "";
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent =
        model.id === "default" ? "默认" : model.label || model.id;
      option.title = model.description || model.source || model.id;
      modelSelect.append(option);
    }

    const next = selected || previous || "default";
    if ([...modelSelect.options].some((option) => option.value === next)) {
      modelSelect.value = next;
    } else {
      const option = document.createElement("option");
      option.value = next;
      option.textContent = next;
      modelSelect.prepend(option);
      modelSelect.value = next;
    }
    updateModelEffortDisplay();
    renderModelOptions();
  }

  function renderEffort(effort) {
    const next = effort || "auto";
    if ([...effortSelect.options].some((option) => option.value === next)) {
      effortSelect.value = next;
      updateModelEffortDisplay();
      return;
    }
    effortSelect.value = "auto";
    updateModelEffortDisplay();
  }

  function renderModelOptions() {
    modelOptions.innerHTML = "";
    for (const option of modelSelect.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.modelOption = option.value;
      button.className = option.value === modelSelect.value ? "selected" : "";
      button.innerHTML = `<span></span><span>${escapeHtml(option.textContent || option.value)}</span><strong>✓</strong>`;
      modelOptions.append(button);
    }
  }

  function updateModelEffortDisplay() {
    const modelLabel = selectedModelLabel();
    const effortLabel = effortMeta(effortSelect.value).label;
    modelDisplay.textContent = modelLabel;
    effortDisplay.textContent = effortLabel;
    modelMenuLabel.textContent = modelLabel;
    for (const button of modelEffortPopover.querySelectorAll(
      "[data-effort-option]",
    )) {
      button.classList.toggle(
        "selected",
        button.getAttribute("data-effort-option") === normalizedEffortValue(),
      );
    }
  }

  function selectedModelLabel() {
    const option = modelSelect.selectedOptions[0];
    return option?.textContent?.trim() || modelSelect.value || "默认";
  }

  function normalizedEffortValue() {
    return effortSelect.value === "auto" ? "medium" : effortSelect.value;
  }

  function effortMeta(value) {
    return (
      {
        auto: { label: "中" },
        low: { label: "低" },
        medium: { label: "中" },
        high: { label: "高" },
        max: { label: "超高" },
      }[value || "auto"] || { label: "中" }
    );
  }

  function renderModes(message) {
    state.permissionMode = message.permissionMode || "default";
    state.thinkingMode = message.thinkingMode || "";
    state.includeContext = message.includeContext !== false;
    state.planMode = !!message.planMode || state.permissionMode === "plan";

    const permission = permissionMeta(state.permissionMode);
    permissionLabel.textContent = permission.label;
    permissionMenu.classList.toggle(
      "danger",
      state.permissionMode === "bypassPermissions",
    );

    includeContextSwitch.classList.toggle("on", state.includeContext);
    planSwitch.classList.toggle("on", state.planMode);
    planToggle.classList.toggle("on", state.planMode);

    for (const item of permissionPopover.querySelectorAll(
      "[data-permission-mode]",
    )) {
      item.classList.toggle(
        "selected",
        item.getAttribute("data-permission-mode") === state.permissionMode,
      );
    }
    if (message.contextWindow) {
      const used = formatTokens(message.contextWindow.used);
      const total = formatTokens(message.contextWindow.total);
      const percent = Math.max(
        0,
        Math.min(100, message.contextWindow.percent || 0),
      );
      const circumference = 2 * Math.PI * 8;
      contextWindow.hidden = false;
      contextWindow.style.setProperty("--context-percent", `${percent}`);
      contextRing.style.strokeDasharray = `${circumference}`;
      contextRing.style.strokeDashoffset = `${circumference - (circumference * percent) / 100}`;
      contextWindow.title = `上下文窗口：已用 ${percent}%，剩余 ${100 - percent}%`;
      contextWindowPercent.textContent = `已用 ${percent}%（剩余 ${100 - percent}%）`;
      contextWindowTokens.textContent = `${used} / ${total} tokens`;
    }
  }

  function permissionMeta(mode) {
    return (
      {
        default: { label: "默认" },
        acceptEdits: { label: "审查" },
        bypassPermissions: { label: "完全访问权限" },
        dontAsk: { label: "不再询问" },
        plan: { label: "计划" },
      }[mode] || { label: "默认" }
    );
  }

  function formatTokens(value) {
    if (value >= 1000) {
      return `${Math.round(value / 1000)}k`;
    }
    return `${value}`;
  }

  function togglePopover(popover) {
    const willOpen = popover.hidden;
    closePopovers();
    popover.hidden = !willOpen;
  }

  function closePopovers() {
    addPopover.hidden = true;
    permissionPopover.hidden = true;
    settingsPopover.hidden = true;
    modelEffortPopover.hidden = true;
    modelSubPopover.hidden = true;
  }

  function clearReview(reviewId) {
    const panel = document.querySelector(`[data-review-id="${reviewId}"]`);
    if (panel) {
      panel.remove();
    }
  }

  function renderPermissionRequest(request) {
    if (
      !request ||
      !request.requestId ||
      document.querySelector(
        `[data-permission-request-id="${request.requestId}"]`,
      )
    ) {
      return;
    }
    const command = permissionCommandText(request);
    const card = document.createElement("details");
    card.className = "permission-card";
    card.dataset.permissionRequestId = request.requestId;
    card.open = true;
    state.pendingPermissions.set(request.requestId, request);

    const summary = document.createElement("summary");
    summary.className = "permission-summary";

    const tool = document.createElement("span");
    tool.className = "permission-tool";
    tool.textContent = request.toolName || "Tool";

    const stateText = document.createElement("span");
    stateText.className = "permission-state";
    stateText.textContent = "等待确认";

    summary.append(tool, stateText);

    const body = document.createElement("div");
    body.className = "permission-body";

    const title = document.createElement("strong");
    title.textContent = permissionQuestion(request);

    const code = document.createElement("code");
    code.textContent = command || "待确认操作";

    const allow = permissionButton("1 允许", "allow", true);
    const allowAlways = permissionButton(
      "2 允许，并且不再询问",
      "allow-always",
      false,
    );
    const deny = permissionButton("3 拒绝", "deny", false);

    const steer = document.createElement("input");
    steer.type = "text";
    steer.placeholder = "告诉 Helion 改用什么做法";
    steer.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !steer.value.trim()) {
        return;
      }
      event.preventDefault();
      sendPermissionResponse(
        request,
        permissionResponseForAction(request, "steer", steer.value.trim()),
      );
    });

    body.append(title, code, allow, allowAlways, deny, steer);
    card.append(summary, body);
    timeline.append(card);
    scrollToBottom();
  }

  function permissionButton(label, action, selected) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.permissionAction = action;
    button.classList.toggle("selected", selected);
    return button;
  }

  function respondToPermissionAction(button) {
    const card = button.closest("[data-permission-request-id]");
    if (!card || card.classList.contains("resolved")) {
      return;
    }
    const request = state.pendingPermissions.get(
      card.dataset.permissionRequestId,
    );
    if (!request) {
      markPermissionResolved(card, "这个权限请求已经失效。");
      return;
    }
    const action = button.dataset.permissionAction;
    sendPermissionResponse(
      request,
      permissionResponseForAction(request, action),
    );
  }

  function permissionResponseForAction(request, action, steerText = "") {
    if (action === "allow") {
      return {
        behavior: "allow",
        updatedInput: {},
        toolUseID: request.toolUseId,
        decisionClassification: "user_temporary",
      };
    }
    if (action === "allow-always") {
      return {
        behavior: "allow",
        updatedInput: {},
        updatedPermissions: request.permissionSuggestions || [],
        toolUseID: request.toolUseId,
        decisionClassification: "user_permanent",
      };
    }
    if (action === "steer") {
      return {
        behavior: "deny",
        message: `用户拒绝了这个操作，并要求改用：${steerText}`,
        interrupt: true,
        toolUseID: request.toolUseId,
        decisionClassification: "user_reject",
      };
    }
    return {
      behavior: "deny",
      message: "用户拒绝了这个操作。",
      toolUseID: request.toolUseId,
      decisionClassification: "user_reject",
    };
  }

  function sendPermissionResponse(request, response) {
    const card = document.querySelector(
      `[data-permission-request-id="${request.requestId}"]`,
    );
    markPermissionResolved(
      card,
      response.behavior === "allow"
        ? "已允许，正在继续。"
        : "已拒绝，正在继续。",
    );
    state.pendingPermissions.delete(request.requestId);
    vscode.postMessage({
      type: "permissionResponse",
      requestId: request.requestId,
      response,
    });
  }

  function cancelPermissionRequest(message) {
    const card = document.querySelector(
      `[data-permission-request-id="${message.requestId}"]`,
    );
    if (!card) {
      return;
    }
    state.pendingPermissions.delete(message.requestId);
    markPermissionResolved(card, message.message || "这个权限请求已经失效。");
  }

  function markPermissionResolved(card, message) {
    if (!card) {
      return;
    }
    card.classList.add("resolved");
    if ("open" in card) {
      card.open = false;
    }
    for (const control of card.querySelectorAll("button, input")) {
      control.disabled = true;
    }
    let note = card.querySelector(".permission-state");
    if (!note) {
      note = document.createElement("span");
      note.className = "permission-state";
      card.append(note);
    }
    note.textContent = message;
    card.title = message;
  }

  function permissionCommandText(request) {
    if (request.description) {
      return request.description;
    }
    if (request.blockedPath) {
      return request.blockedPath;
    }
    const input = request.input || {};
    if (typeof input.command === "string") {
      return input.command;
    }
    if (typeof input.file_path === "string") {
      return input.file_path;
    }
    if (typeof input.path === "string") {
      return input.path;
    }
    return JSON.stringify(input);
  }

  function permissionQuestion(request) {
    const tool = request.toolName || "";
    if (/edit|write|modify|MultiEdit|NotebookEdit/i.test(tool)) {
      return "允许这次修改吗？";
    }
    if (/bash|shell|command/i.test(tool)) {
      return "允许运行这个命令吗？";
    }
    return "是否允许执行这个操作？";
  }

  function escapeHtml(value) {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }

  function updateSuggest() {
    const value = prompt.value;
    const cursor = prompt.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/(^|\s)([/?@][^\s]*)$/);
    if (!match) {
      closeSuggest();
      return;
    }

    const token = match[2];
    const trigger = token[0];
    const source =
      trigger === "/"
        ? commandItems
        : trigger === "?"
          ? helpItems
          : mentionItems;
    const query = token.slice(1).toLowerCase();
    const items = source.filter((item) => {
      const haystack =
        `${item.trigger} ${item.title} ${item.hint}`.toLowerCase();
      return haystack.includes(query);
    });

    if (items.length === 0) {
      closeSuggest();
      return;
    }

    suggestState = {
      open: true,
      trigger,
      start: cursor - token.length,
      end: cursor,
      selected: 0,
      items,
    };
    renderSuggest();
  }

  function renderSuggest() {
    suggest.hidden = false;
    suggest.innerHTML = "";
    const header = document.createElement("div");
    header.className = "suggest-header";
    header.textContent =
      suggestState.trigger === "/"
        ? "命令"
        : suggestState.trigger === "?"
          ? "提示模板"
          : "上下文";
    suggest.append(header);

    suggestState.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `suggest-item${index === suggestState.selected ? " selected" : ""}`;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applySuggestion(item);
      });

      const title = document.createElement("span");
      title.className = "suggest-title";
      title.textContent = item.trigger;
      const body = document.createElement("span");
      body.className = "suggest-body";
      body.textContent = item.title;
      const hint = document.createElement("small");
      hint.textContent = item.hint;

      button.append(title, body, hint);
      suggest.append(button);
    });
  }

  function moveSuggestion(delta) {
    if (!suggestState.open || suggestState.items.length === 0) {
      return;
    }
    suggestState.selected =
      (suggestState.selected + delta + suggestState.items.length) %
      suggestState.items.length;
    renderSuggest();
  }

  function applySuggestion(item) {
    if (!item) {
      return;
    }

    if (suggestState.trigger === "/" && item.action) {
      const value = prompt.value;
      const rest =
        `${value.slice(0, suggestState.start)}${value.slice(suggestState.end)}`.trim();
      closeSuggest();
      if (!rest) {
        vscode.postMessage({ type: "quickAction", action: item.action });
        prompt.value = "";
        return;
      }
      replacePromptToken(`${item.title}：`);
      return;
    }

    if (suggestState.trigger === "@" && item.mention) {
      pendingMentionRange = {
        start: suggestState.start,
        end: suggestState.end,
      };
      closeSuggest();
      vscode.postMessage({ type: "pickMention", mention: item.mention });
      return;
    }

    replacePromptToken(item.text || `${item.trigger} `);
  }

  function insertPickedMention(message) {
    const text = typeof message === "string" ? message : message.text || "";
    const attachable =
      message &&
      (message.kind === "workspace" ||
        message.kind === "file" ||
        message.kind === "image");
    if (!text && !attachable) {
      return;
    }

    if (pendingMentionRange) {
      if (attachable) {
        removeRange(pendingMentionRange.start, pendingMentionRange.end);
      } else {
        replaceRange(text, pendingMentionRange.start, pendingMentionRange.end);
      }
      pendingMentionRange = undefined;
      if (attachable) {
        addAttachment(
          message.kind,
          message.label || labelFromToken(text),
          text,
          message.src,
          message.path,
        );
      }
      return;
    }

    if (attachable) {
      addAttachment(
        message.kind,
        message.label || labelFromToken(text),
        text,
        message.src,
        message.path,
      );
      return;
    }

    const cursor = prompt.selectionStart ?? prompt.value.length;
    replaceRange(text, cursor, cursor);
  }

  function addAttachment(kind, label, token, src, filePath) {
    const duplicateKey =
      token ||
      filePath ||
      (src ? `${kind}:${label}:${src.length}:${src.slice(0, 80)}` : label);
    if (
      state.attachments.some(
        (item) => (item.token || item.path || item.label) === duplicateKey,
      )
    ) {
      renderAttachments();
      return;
    }
    state.attachments.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind,
      label,
      token,
      src,
      path: filePath,
    });
    renderAttachments();
    prompt.focus();
    updateQueueState();
  }

  async function handlePaste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length === 0) {
      for (const item of event.clipboardData?.items || []) {
        const file = item.kind === "file" ? item.getAsFile() : undefined;
        if (file) {
          files.push(file);
        }
      }
    }
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await handleFiles(files);
  }

  function handleDragOver(event) {
    if (!hasDraggedAttachments(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    composer.classList.add("dragging");
  }

  function handleDragLeave(event) {
    if (!event.relatedTarget || !document.body.contains(event.relatedTarget)) {
      composer.classList.remove("dragging");
    }
  }

  async function handleDrop(event) {
    if (!hasDraggedAttachments(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    composer.classList.remove("dragging");
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length > 0) {
      await handleFiles(files);
      return;
    }

    const uris = droppedUris(event.dataTransfer);
    if (uris.length > 0) {
      vscode.postMessage({ type: "attachDroppedUris", uris });
    }
  }

  function hasDraggedAttachments(event) {
    const types = [...(event.dataTransfer?.types || [])];
    return (
      types.includes("Files") ||
      types.includes("text/uri-list") ||
      types.includes("text/plain") ||
      types.some((type) => type.toLowerCase().includes("uri-list"))
    );
  }

  function droppedUris(dataTransfer) {
    if (!dataTransfer) {
      return [];
    }

    const raw = [
      dataTransfer.getData("text/uri-list"),
      dataTransfer.getData("text/plain"),
      dataTransfer.getData("application/vnd.code.uri-list"),
      dataTransfer.getData("vscode-uri-list"),
    ].filter(Boolean);

    return raw
      .flatMap((value) => value.split(/\r?\n/))
      .map((value) => value.trim())
      .filter((value) => value && !value.startsWith("#"))
      .filter((value, index, all) => all.indexOf(value) === index);
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const src = await readAsDataUrl(file);
        addAttachment("image", file.name || "粘贴的图片", "", src, "");
        continue;
      }

      if (isTextLikeFile(file)) {
        const text = await readAsText(file);
        addAttachment(
          "file",
          file.name || "粘贴的文本文件",
          pastedTextToken(file.name || "粘贴的文本文件", text),
          "",
          "",
        );
        continue;
      }

      addAttachment(
        "file",
        file.name || "粘贴的文件",
        `附件：${file.name || "粘贴的文件"}（二进制文件，当前只能展示文件名，不能作为文本上下文读取。）`,
        "",
        "",
      );
    }
  }

  function readAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsText(file);
    });
  }

  function isTextLikeFile(file) {
    if (file.type.startsWith("text/")) {
      return true;
    }
    return /\.(txt|md|markdown|json|jsonl|yaml|yml|toml|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sh|zsh|bash|sql|log)$/i.test(
      file.name || "",
    );
  }

  function pastedTextToken(name, text) {
    const normalized =
      text.length > 20000
        ? `${text.slice(0, 10000)}\n\n...中间内容已省略...\n\n${text.slice(-8000)}`
        : text;
    return [`粘贴文件：${name}`, "```", normalized, "```"].join("\n");
  }

  function renderAttachments() {
    attachmentTray.innerHTML = "";
    attachmentTray.hidden = state.attachments.length === 0;
    for (const item of state.attachments) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `attachment-chip ${item.kind}`;
      chip.title = item.token || item.path || item.label;
      if (item.kind === "image" && item.src) {
        chip.innerHTML = `<img src="${escapeHtml(item.src)}" alt=""><b>${escapeHtml(item.label)}</b><i aria-hidden="true">×</i>`;
      } else {
        chip.innerHTML = `<span>${item.kind === "workspace" ? "文件夹" : "文件"}</span><b>${escapeHtml(item.label)}</b><i aria-hidden="true">×</i>`;
      }
      chip.addEventListener("click", () => {
        state.attachments = state.attachments.filter(
          (candidate) => candidate.id !== item.id,
        );
        renderAttachments();
        updateQueueState();
      });
      attachmentTray.append(chip);
    }
    updateQueueState();
  }

  function clearAttachments() {
    state.attachments = [];
    renderAttachments();
  }

  function composePrompt(value) {
    const tokens = state.attachments
      .map(
        (item) =>
          item.token || (item.path ? `附件：${item.label} (${item.path})` : ""),
      )
      .filter(Boolean);
    return [...tokens, value].filter(Boolean).join("\n\n").trim();
  }

  function displayAttachments() {
    return state.attachments.map((item) => ({
      kind: item.kind,
      label: item.label,
      src: item.src,
      path: item.path,
      token: item.token,
    }));
  }

  function labelFromToken(token) {
    const match = token.match(/@(?:file|workspace)\("([^"]+)"\)/);
    if (!match) {
      return token;
    }
    const parts = match[1].split("/");
    return parts[parts.length - 1] || match[1] || token;
  }

  function replacePromptToken(text) {
    replaceRange(text, suggestState.start, suggestState.end);
    closeSuggest();
  }

  function replaceRange(text, start, end) {
    const value = prompt.value;
    const prefix = value.slice(0, start);
    const suffix = value.slice(end);
    const needsSpace = text.endsWith("\n") || text.endsWith(" ") ? "" : " ";
    const next = `${prefix}${text}${needsSpace}${suffix}`;
    const cursor = prefix.length + text.length + needsSpace.length;
    prompt.value = next;
    prompt.focus();
    prompt.setSelectionRange(cursor, cursor);
    updateSuggest();
  }

  function removeRange(start, end) {
    const value = prompt.value;
    const next = `${value.slice(0, start)}${value.slice(end)}`.replace(
      /\s{2,}/g,
      " ",
    );
    prompt.value = next;
    prompt.focus();
    prompt.setSelectionRange(start, start);
    updateSuggest();
  }

  function closeSuggest() {
    suggestState.open = false;
    suggestState.items = [];
    suggest.hidden = true;
    suggest.innerHTML = "";
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`缺少 HelionCoder Webview 元素：${id}`);
    }
    return element;
  }
})();
