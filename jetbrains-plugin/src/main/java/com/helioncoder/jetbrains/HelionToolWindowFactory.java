package com.helioncoder.jetbrains;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefJSQuery;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class HelionToolWindowFactory implements ToolWindowFactory {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        HelionPanel panel = new HelionPanel(project);
        var content = toolWindow.getContentManager().getFactory().createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);
    }

    private static final class HelionPanel extends JPanel {
        private static final Pattern TYPE_PATTERN = Pattern.compile("\"type\"\\s*:\\s*\"([^\"]+)\"");
        private static final Pattern PROMPT_PATTERN = Pattern.compile("\"prompt\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern MODEL_PATTERN = Pattern.compile("\"model\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern EFFORT_PATTERN = Pattern.compile("\"effort\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern MODE_PATTERN = Pattern.compile("\"mode\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern ACTION_PATTERN = Pattern.compile("\"action\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");

        private final Project project;
        private final JBCefBrowser browser = new JBCefBrowser();
        private final JBCefJSQuery jsQuery = JBCefJSQuery.create(browser);
        private final HelionCli cli = new HelionCli();

        private HelionPanel(@NotNull Project project) {
            super(new BorderLayout(8, 8));
            this.project = project;
            add(browser.getComponent(), BorderLayout.CENTER);
            jsQuery.addHandler(message -> {
                handleMessage(message);
                return null;
            });
            browser.loadHTML(html(jsQuery.inject("JSON.stringify(window.__helionMessage || {})")));
        }

        private void handleMessage(@NotNull String rawMessage) {
            String type = extract(TYPE_PATTERN, rawMessage);
            if (type == null) {
                return;
            }

            switch (type) {
                case "ready" -> postContext();
                case "ask" -> runAssistantPrompt(
                    coalesce(extract(PROMPT_PATTERN, rawMessage), ""),
                    coalesce(extract(MODE_PATTERN, rawMessage), "ask")
                );
                case "quickAction" -> runAssistantPrompt(
                    quickActionPrompt(coalesce(extract(ACTION_PATTERN, rawMessage), "")),
                    coalesce(extract(ACTION_PATTERN, rawMessage), "ask")
                );
                case "selectModel" -> {
                    String model = coalesce(extract(MODEL_PATTERN, rawMessage), "");
                    HelionSettings.setModel("default".equals(model) ? "" : model);
                    postContext();
                }
                case "selectEffort" -> {
                    String effort = coalesce(extract(EFFORT_PATTERN, rawMessage), "");
                    HelionSettings.setEffort("auto".equals(effort) ? "" : effort);
                    postContext();
                }
                case "selectPermission" -> {
                    String mode = coalesce(extract(MODE_PATTERN, rawMessage), "default");
                    HelionSettings.setPermissionMode(mode);
                    postContext();
                }
                case "configureExecutable" -> configureExecutable();
                case "refreshModels", "checkUpdates", "showOutput", "showHistory", "showPlugins", "configureApi" ->
                    postNotice("这个入口已保留，JetBrains 版后续会接入完整实现。");
                case "stop" -> postNotice("当前 Java 版后台任务暂不支持从 WebView 中断。");
                default -> {
                }
            }
        }

        private void runAssistantPrompt(@NotNull String prompt, @NotNull String mode) {
            String trimmed = prompt.trim();
            if (trimmed.isEmpty()) {
                return;
            }

            String requestId = UUID.randomUUID().toString();
            postToWebview("{\"type\":\"run-start\",\"requestId\":" + json(requestId) + ",\"prompt\":" + json(trimmed) + ",\"mode\":" + json(mode) + "}");

            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
                    String finalPrompt = EditorContext.buildPrompt(project, editor, trimmed, "助手面板提问");
                    HelionCli.Result result = cli.runPrompt(project, finalPrompt);
                    String text = result.stdout().trim();
                    ApplicationManager.getApplication().invokeLater(() -> {
                        postToWebview("{\"type\":\"run-chunk\",\"requestId\":" + json(requestId) + ",\"chunk\":" + json(text) + "}");
                        postToWebview("{\"type\":\"run-done\",\"requestId\":" + json(requestId) + ",\"text\":" + json(text) + "}");
                        postContext();
                    });
                } catch (Exception error) {
                    ApplicationManager.getApplication().invokeLater(() -> {
                        String message = error.getMessage() == null ? error.toString() : error.getMessage();
                        postToWebview("{\"type\":\"run-error\",\"requestId\":" + json(requestId) + ",\"message\":" + json(message) + "}");
                        Messages.showErrorDialog(project, message, "HelionCoder");
                    });
                }
            });
        }

        private void configureExecutable() {
            String value = Messages.showInputDialog(
                project,
                "dist/helion-coder 或 dist/cli.mjs 的绝对路径。留空自动检测。",
                "HelionCoder CLI 可执行文件",
                null,
                HelionSettings.executablePath(),
                null
            );
            if (value != null) {
                HelionSettings.setExecutablePath(value);
                postContext();
            }
        }

        private void postContext() {
            var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            String file = "没有活动编辑器";
            String language = "-";
            int selectedChars = 0;
            if (editor != null && editor.getVirtualFile() != null) {
                file = editor.getVirtualFile().getName();
                language = editor.getVirtualFile().getExtension() == null ? "-" : editor.getVirtualFile().getExtension();
                String selected = editor.getSelectionModel().getSelectedText();
                selectedChars = selected == null ? 0 : selected.length();
            }

            String model = HelionSettings.model().isBlank() ? "default" : HelionSettings.model();
            String effort = HelionSettings.effort().isBlank() ? "auto" : HelionSettings.effort();
            String payload = "{"
                + "\"type\":\"context\","
                + "\"cli\":\"本地 CLI\","
                + "\"file\":" + json(file) + ","
                + "\"language\":" + json(language) + ","
                + "\"selectedChars\":" + selectedChars + ","
                + "\"models\":[\"default\"" + (model.equals("default") ? "" : "," + json(model)) + "],"
                + "\"model\":" + json(model) + ","
                + "\"effort\":" + json(effort) + ","
                + "\"permissionMode\":" + json(HelionSettings.permissionMode()) + ","
                + "\"thinkingMode\":" + json(HelionSettings.thinking()) + ","
                + "\"includeContext\":true,"
                + "\"planMode\":" + ("plan".equals(HelionSettings.permissionMode()) ? "true" : "false")
                + "}";
            postToWebview(payload);
        }

        private void postNotice(@NotNull String message) {
            postToWebview("{\"type\":\"run-error\",\"requestId\":\"notice\",\"message\":" + json(message) + "}");
        }

        private void postToWebview(@NotNull String json) {
            browser.getCefBrowser().executeJavaScript(
                "window.dispatchEvent(new MessageEvent('message', { data: " + json + " }));",
                browser.getCefBrowser().getURL(),
                0
            );
        }

        private static @NotNull String html(@NotNull String bridgePostScript) {
            String css = readResource("/webview/assistant.css");
            String markdown = readResource("/webview/vendor/markdown-it.min.js");
            String assistant = readResource("/webview/assistant.js");
            String bridge = """
                window.acquireVsCodeApi = function() {
                  return {
                    postMessage: function(message) {
                      window.__helionMessage = message;
                      __HELION_BRIDGE_POST__;
                    },
                    getState: function() { return {}; },
                    setState: function() {}
                  };
                };
                """.replace("__HELION_BRIDGE_POST__", bridgePostScript);

            return """
                <!doctype html>
                <html lang="zh-CN">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>__HELION_CSS__</style>
                  <title>HelionCoder</title>
                </head>
                <body>
                  <main class="shell">
                    <header class="topbar">
                      <div class="header-title">
                        <button type="button" class="header-back" id="backToTasks" title="返回任务">‹</button>
                        <strong id="headerTitle">任务</strong>
                      </div>
                      <span id="cliLabel" class="sr-only">本地 CLI</span>
                      <div class="top-actions">
                        <button class="icon-button" id="history" title="历史对话">H</button>
                        <button class="icon-button" id="settingsMenu" title="设置">S</button>
                        <button class="icon-button" id="newConversation" title="新建对话">N</button>
                      </div>
                    </header>

                    <section class="timeline" id="timeline" aria-live="polite">
                      <article class="empty-state">
                        <div class="welcome">
                          <span>HelionCoder</span>
                          <strong>让 Helion 理解、修改、审查或规划你的工作区。</strong>
                        </div>
                        <div class="release-card">
                          <span>i</span>
                          <div>
                            <strong>工作区助手</strong>
                            <p>输入 / 选择功能，输入 @ 添加上下文，输入 ? 使用提示模板。</p>
                          </div>
                        </div>
                      </article>
                    </section>

                    <form class="composer" id="composer">
                      <div class="prompt-suggestions" aria-label="可尝试的提示词">
                        <span>可以试试</span>
                        <button type="button" data-prompt="这个仓库是做什么的？帮我理解整体架构。">这个仓库是做什么的？帮我理解整体架构。</button>
                        <button type="button" data-prompt="帮我实现一个用于 [目标] 的应用，界面需要支持用户完成 [任务]。">帮我实现一个用于 [目标] 的应用，界面需要支持用户完成 [任务]...</button>
                      </div>
                      <div class="attachment-tray" id="attachmentTray" hidden></div>
                      <div class="prompt-context-row">
                        <button type="button" class="context-item" title="当前上下文">
                          <span id="contextFile">没有活动编辑器</span>
                          <small id="contextLanguage">-</small>
                          <small id="contextSelection">0 字符</small>
                        </button>
                      </div>
                      <textarea id="prompt" rows="2" placeholder="询问 Helion，或输入 @ 添加上下文"></textarea>
                      <div class="suggest" id="suggest" hidden></div>
                      <div class="composer-actions">
                        <div class="composer-row primary-row">
                          <div class="model-effort-group" title="模型和推理强度">
                            <button type="button" class="model-effort-button" id="modelEffortMenu" title="模型和推理强度">
                              <span id="modelDisplay">默认</span>
                              <span id="effortDisplay">中</span>
                              <span>⌄</span>
                            </button>
                            <label class="inline-select model-select native-model-select" title="模型" hidden>
                              <select id="modelSelect" aria-label="HelionCoder 模型"><option value="default">默认</option></select>
                            </label>
                            <label class="inline-select compact effort-select native-effort-select" title="推理强度" hidden>
                              <select id="effortSelect" aria-label="HelionCoder 推理强度">
                                <option value="auto">智能</option>
                                <option value="low">低</option>
                                <option value="medium">中</option>
                                <option value="high">高</option>
                                <option value="max">超高</option>
                              </select>
                            </label>
                          </div>
                          <button type="submit" class="send" title="发送">↑</button>
                        </div>
                        <div class="composer-row settings-row">
                          <button type="button" class="round-tool" id="addMenu" title="添加上下文">+</button>
                          <button type="button" class="context-ring" id="contextWindow" title="上下文窗口">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-bg" cx="12" cy="12" r="8"></circle><circle class="ring-fg" id="contextRing" cx="12" cy="12" r="8"></circle></svg>
                            <span class="sr-only" id="contextWindowPercent">0% used</span>
                            <span class="sr-only" id="contextWindowTokens">0 / 0 tokens used</span>
                          </button>
                          <button type="button" class="mode-chip" id="permissionMenu" title="权限模式">
                            <span id="permissionIcon">□</span>
                            <span id="permissionLabel">默认</span>
                            <span>⌄</span>
                          </button>
                          <button type="button" class="ghost steer-action" id="guide" title="作为后续引导发送" hidden>引导</button>
                          <button type="button" class="ghost run-action" id="stop" hidden>停止</button>
                        </div>
                      </div>
                    </form>

                    <div class="menu-popover" id="addPopover" hidden>
                      <button type="button" data-menu-action="attach">添加图片和文件</button>
                      <button type="button" data-menu-action="toggle-context">包含编辑器上下文<i id="includeContextSwitch"></i></button>
                      <button type="button" data-menu-action="toggle-plan" id="planToggle">计划模式<i id="planSwitch"></i></button>
                      <button type="button" data-menu-action="plugins">插件<strong>›</strong></button>
                    </div>
                    <div class="menu-popover compact-menu" id="permissionPopover" hidden>
                      <button type="button" data-permission-mode="default"><span>默认权限</span><strong>✓</strong></button>
                      <button type="button" data-permission-mode="acceptEdits"><span>自动审查</span><strong>✓</strong></button>
                      <button type="button" data-permission-mode="bypassPermissions"><span>完全访问权限</span><strong>✓</strong></button>
                      <button type="button" data-permission-mode="plan"><span>计划模式</span><strong>✓</strong></button>
                    </div>
                    <div class="menu-popover model-effort-popover" id="modelEffortPopover" hidden>
                      <div class="menu-title">智能</div>
                      <button type="button" data-effort-option="low"><span></span><span>低</span><strong>✓</strong></button>
                      <button type="button" data-effort-option="medium"><span></span><span>中</span><strong>✓</strong></button>
                      <button type="button" data-effort-option="high"><span></span><span>高</span><strong>✓</strong></button>
                      <button type="button" data-effort-option="max"><span></span><span>超高</span><strong>✓</strong></button>
                      <button type="button" class="has-submenu model-switch-row" id="openModelSubmenu"><span></span><span id="modelMenuLabel">默认</span><strong>›</strong></button>
                    </div>
                    <div class="menu-popover model-sub-popover" id="modelSubPopover" hidden>
                      <div class="menu-title">切换模型</div>
                      <div class="model-options" id="modelOptions"></div>
                    </div>
                    <div class="menu-popover settings-popover" id="settingsPopover" hidden>
                      <button type="button" data-settings-action="configure-api"><span>API 设置</span></button>
                      <button type="button" data-settings-action="configure-cli"><span>CLI 路径</span></button>
                      <button type="button" data-settings-action="refresh-models"><span>刷新模型</span></button>
                      <button type="button" data-settings-action="check-updates"><span>检查更新</span></button>
                      <button type="button" data-settings-action="output"><span>打开输出</span></button>
                      <button type="button" data-settings-action="plugins"><span>插件</span></button>
                    </div>
                  </main>
                  <script>__HELION_BRIDGE__</script>
                  <script>__HELION_MARKDOWN__</script>
                  <script>__HELION_ASSISTANT__</script>
                </body>
                </html>
                """
                .replace("__HELION_CSS__", css)
                .replace("__HELION_BRIDGE__", bridge)
                .replace("__HELION_MARKDOWN__", markdown)
                .replace("__HELION_ASSISTANT__", assistant);
        }

        private static @NotNull String quickActionPrompt(@NotNull String action) {
            return switch (action) {
                case "fix" -> "检查当前上下文并给出最小修复。";
                case "review" -> "请按代码审查格式回答：先列出问题和风险，再给出最小修改建议。";
                case "explain" -> "解释当前代码的意图、行为、副作用和风险。";
                case "tests" -> "为当前代码生成聚焦测试，并说明如何运行。";
                case "refactor" -> "请重构当前代码，降低复杂度并保持行为不变。";
                case "docs" -> "为当前代码补充必要文档或注释。";
                case "complete" -> "根据当前光标上下文续写下一步代码。";
                default -> "请根据当前项目上下文继续处理这个任务。";
            };
        }

        private static @Nullable String extract(@NotNull Pattern pattern, @NotNull String value) {
            Matcher matcher = pattern.matcher(value);
            return matcher.find() ? unescapeJson(matcher.group(1)) : null;
        }

        private static @NotNull String coalesce(@Nullable String value, @NotNull String fallback) {
            return value == null ? fallback : value;
        }

        private static @NotNull String unescapeJson(@NotNull String value) {
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < value.length(); i += 1) {
                char current = value.charAt(i);
                if (current != '\\' || i + 1 >= value.length()) {
                    builder.append(current);
                    continue;
                }
                char next = value.charAt(++i);
                switch (next) {
                    case 'n' -> builder.append('\n');
                    case 'r' -> builder.append('\r');
                    case 't' -> builder.append('\t');
                    case '"' -> builder.append('"');
                    case '\\' -> builder.append('\\');
                    default -> builder.append(next);
                }
            }
            return builder.toString();
        }

        private static @NotNull String json(@NotNull String value) {
            StringBuilder builder = new StringBuilder("\"");
            for (int i = 0; i < value.length(); i += 1) {
                char c = value.charAt(i);
                switch (c) {
                    case '\\' -> builder.append("\\\\");
                    case '"' -> builder.append("\\\"");
                    case '\n' -> builder.append("\\n");
                    case '\r' -> builder.append("\\r");
                    case '\t' -> builder.append("\\t");
                    default -> builder.append(c);
                }
            }
            return builder.append('"').toString();
        }

        private static @NotNull String readResource(@NotNull String path) {
            try (InputStream input = HelionToolWindowFactory.class.getResourceAsStream(path)) {
                if (input == null) {
                    return "";
                }
                return new String(input.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException ignored) {
                return "";
            }
        }
    }
}

