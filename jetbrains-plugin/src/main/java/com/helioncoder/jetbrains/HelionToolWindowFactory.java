package com.helioncoder.jetbrains;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.diff.DiffDialogHints;
import com.intellij.diff.DiffManager;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.chains.SimpleDiffRequestChain;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Computable;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefJSQuery;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Future;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class HelionToolWindowFactory implements ToolWindowFactory {
    private static final Gson GSON = new Gson();
    private static final String LATEST_RELEASE_URL = "https://api.github.com/repos/gabrielpondc/HelionCoder/releases/latest";

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        HelionPanel panel = new HelionPanel(project);
        var content = toolWindow.getContentManager().getFactory().createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);
    }


    private static final class HelionPanel extends JPanel {
        private static final Pattern TYPE_PATTERN = Pattern.compile("\"type\"\\s*:\\s*\"([^\"]+)\"");
        private static final Pattern PROMPT_PATTERN = Pattern.compile("\"prompt\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern DISPLAY_PROMPT_PATTERN = Pattern.compile("\"displayPrompt\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern EDIT_PROMPT_PATTERN = Pattern.compile("\"editPrompt\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern MODEL_PATTERN = Pattern.compile("\"model\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern EFFORT_PATTERN = Pattern.compile("\"effort\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern MODE_PATTERN = Pattern.compile("\"mode\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern ACTION_PATTERN = Pattern.compile("\"action\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern QUESTION_PATTERN = Pattern.compile("\"question\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern REQUEST_ID_PATTERN = Pattern.compile("\"requestId\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern TEXT_PATTERN = Pattern.compile("\"text\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern PATH_PATTERN = Pattern.compile("\"path\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern LABEL_PATTERN = Pattern.compile("\"label\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern MENTION_PATTERN = Pattern.compile("\"mention\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern VALUE_PATTERN = Pattern.compile("\"value\"\\s*:\\s*(true|false)");
        private static final Pattern LINE_PATTERN = Pattern.compile("\"line\"\\s*:\\s*(\\d+)");
        private static final Pattern QUOTED_PATTERN = Pattern.compile("\"((?:\\\\.|[^\"\\\\])*)\"");
        private static final Pattern VERSION_PATTERN = Pattern.compile("v?(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?)");

        private final Project project;
        private final JBCefBrowser browser = new JBCefBrowser();
        private final JBCefJSQuery jsQuery = JBCefJSQuery.create(browser);
        private final HelionCli cli = new HelionCli();
        private final HelionModelResolver modelResolver;
        private HelionCli.StreamController activeController;
        private Future<?> currentTask;
        private String currentRequestId;
        private String currentSessionId;
        private volatile boolean autoModelRefreshStarted;
        private final StringBuilder outputLog = new StringBuilder();
        private final Map<String, List<ReviewChange>> reviews = new HashMap<>();
        private final Map<String, ConversationRecord> conversations = new LinkedHashMap<>();
        private String activeConversationId = UUID.randomUUID().toString();

        private HelionPanel(@NotNull Project project) {
            super(new BorderLayout(8, 8));
            this.project = project;
            this.modelResolver = new HelionModelResolver(project);
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
                case "ready" -> {
                    postContext();
                    refreshModelsOnFirstReady();
                }
                case "ask" -> runAssistantPrompt(
                    coalesce(extract(PROMPT_PATTERN, rawMessage), ""),
                    coalesce(extract(MODE_PATTERN, rawMessage), "ask"),
                    coalesce(extract(DISPLAY_PROMPT_PATTERN, rawMessage), ""),
                    coalesce(extract(EDIT_PROMPT_PATTERN, rawMessage), ""),
                    attachmentsJson(rawMessage)
                );
                case "quickAction" -> runAssistantPrompt(
                    quickActionPrompt(coalesce(extract(ACTION_PATTERN, rawMessage), "")),
                    coalesce(extract(ACTION_PATTERN, rawMessage), "ask"),
                    "",
                    "",
                    "[]"
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
                case "selectThinking" -> {
                    String mode = coalesce(extract(MODE_PATTERN, rawMessage), "");
                    HelionSettings.setThinking(mode);
                    postContext();
                }
                case "selectPermission" -> {
                    String mode = coalesce(extract(MODE_PATTERN, rawMessage), "default");
                    HelionSettings.setPermissionMode(mode);
                    postContext();
                }
                case "toggleIncludeContext" -> {
                    HelionSettings.setIncludeEditorContext(extractBoolean(rawMessage, true));
                    postContext();
                }
                case "togglePlanMode" -> {
                    boolean enabled = extractBoolean(rawMessage, false);
                    HelionSettings.setPermissionMode(enabled ? "plan" : "default");
                    postContext();
                }
                case "configureExecutable" -> configureExecutable();
                case "insertText" -> insertText(coalesce(extract(TEXT_PATTERN, rawMessage), ""));
                case "openStepFile" -> openFileAt(
                    coalesce(jsonString(rawMessage, "path"), coalesce(extract(PATH_PATTERN, rawMessage), "")),
                    coalesce(jsonString(rawMessage, "label"), coalesce(extract(LABEL_PATTERN, rawMessage), "")),
                    jsonInt(rawMessage, "line", extractInt(LINE_PATTERN, rawMessage, 1))
                );
                case "pickMention" -> pickMention(coalesce(extract(MENTION_PATTERN, rawMessage), "file"));
                case "attachFile" -> attachFile();
                case "attachDroppedUris" -> attachDroppedUris(rawMessage);
                case "newConversation" -> startNewConversation();
                case "showHistory" -> showHistory();
                case "openRecentHistory" -> openHistory(coalesce(jsonString(rawMessage, "id"), ""));
                case "acceptChanges" -> acceptReview(coalesce(jsonString(rawMessage, "reviewId"), ""));
                case "rejectChanges" -> rejectReview(coalesce(jsonString(rawMessage, "reviewId"), ""));
                case "openChanges" -> openReview(coalesce(jsonString(rawMessage, "reviewId"), ""), -1);
                case "openChange" -> openReview(
                    coalesce(jsonString(rawMessage, "reviewId"), ""),
                    jsonInt(rawMessage, "index", -1)
                );
                case "permissionResponse" -> respondToPermission(rawMessage);
                case "sideQuestion" -> sendSideQuestion(coalesce(extract(QUESTION_PATTERN, rawMessage), ""));
                case "refreshModels" -> refreshModels();
                case "checkUpdates" -> updateCli();
                case "showOutput" -> showOutput();
                case "showPlugins" -> showPlugins();
                case "configureApi" -> configureApi();
                case "stop" -> stopCurrentRun();
                default -> {
                }
            }
        }

        private void runAssistantPrompt(
            @NotNull String prompt,
            @NotNull String mode,
            @NotNull String displayPrompt,
            @NotNull String editPrompt,
            @NotNull String attachments
        ) {
            String trimmed = prompt.trim();
            if (trimmed.isEmpty()) {
                return;
            }

            String requestId = UUID.randomUUID().toString();
            currentRequestId = requestId;
            String visiblePrompt = displayPrompt.isBlank() ? trimmed : displayPrompt.trim();
            String editablePrompt = editPrompt.isBlank() ? visiblePrompt : editPrompt.trim();
            appendHistory("user", visiblePrompt);
            appendOutput("开始请求：" + trimmed);
            postToWebview("{\"type\":\"run-start\",\"requestId\":" + json(requestId)
                + ",\"prompt\":" + json(visiblePrompt)
                + ",\"editPrompt\":" + json(editablePrompt)
                + ",\"attachments\":" + attachments
                + ",\"mode\":" + json(mode) + "}");

            currentTask = ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    Map<String, String> beforeSnapshot = snapshotWorkspaceFiles();
                    var editor = HelionSettings.includeEditorContext()
                        ? FileEditorManager.getInstance(project).getSelectedTextEditor()
                        : null;
                    String promptWithImages = withImageAttachmentRefs(trimmed, attachments);
                    String finalPrompt = EditorContext.buildPrompt(project, editor, promptWithImages, "助手面板提问");
                    HelionCli.StreamResult result = cli.runPromptStream(project, finalPrompt, currentSessionId, new HelionCli.StreamCallbacks() {
                        @Override
                        public void onController(@NotNull HelionCli.StreamController controller) {
                            activeController = controller;
                        }

                        @Override
                        public void onText(@NotNull String chunk) {
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"run-chunk\",\"requestId\":" + json(requestId) + ",\"stream\":\"stdout\",\"chunk\":" + json(chunk) + "}")
                            );
                        }

                        @Override
                        public void onThinking(@NotNull String chunk) {
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"run-thinking\",\"requestId\":" + json(requestId) + ",\"chunk\":" + json(chunk) + "}")
                            );
                        }

                        @Override
                        public void onUsage(@NotNull JsonObject usage) {
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"token-usage\",\"requestId\":" + json(requestId) + ",\"usage\":" + GSON.toJson(usage) + "}")
                            );
                        }

                        @Override
                        public void onToolStep(@NotNull JsonObject step) {
                            JsonObject normalizedStep = normalizeToolStep(step);
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"run-step\",\"requestId\":" + json(requestId) + ",\"step\":" + GSON.toJson(normalizedStep) + "}")
                            );
                        }

                        @Override
                        public void onPermissionRequest(@NotNull JsonObject request) {
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"permission-request\",\"request\":" + GSON.toJson(request) + "}")
                            );
                        }

                        @Override
                        public void onPermissionCancel(@NotNull String permissionRequestId) {
                            ApplicationManager.getApplication().invokeLater(() ->
                                postToWebview("{\"type\":\"permission-cancelled\",\"requestId\":" + json(permissionRequestId) + ",\"message\":\"这个权限请求已经由其他决策处理。\"}")
                            );
                        }

                        @Override
                        public void onSideQuestionDone(@NotNull String sideRequestId, @Nullable String response, @Nullable String error) {
                            ApplicationManager.getApplication().invokeLater(() -> {
                                if (error == null) {
                                    postToWebview("{\"type\":\"side-question-done\",\"requestId\":" + json(sideRequestId) + ",\"text\":" + json(response == null ? "" : response) + "}");
                                } else {
                                    postToWebview("{\"type\":\"side-question-error\",\"requestId\":" + json(sideRequestId) + ",\"message\":" + json(error) + "}");
                                }
                            });
                        }
                    });
                    currentSessionId = result.sessionId() == null ? currentSessionId : result.sessionId();
                    String text = result.stdout().trim();
                    List<ReviewChange> review = createReview(beforeSnapshot);
                    appendOutput(result.commandLine());
                    if (!text.isBlank()) {
                        appendOutput(text);
                    }
                    appendHistory("assistant", text.isBlank() ? "没有输出。" : text);
                    if (!result.stderr().isBlank()) {
                        appendOutput("stderr:\n" + result.stderr().trim());
                    }
                    ApplicationManager.getApplication().invokeLater(() -> {
                        postToWebview("{\"type\":\"run-done\",\"requestId\":" + json(requestId)
                            + ",\"text\":" + json(text)
                            + reviewJson(review)
                            + "}");
                        postContext();
                    });
                } catch (Exception error) {
                    String message = error.getMessage() == null ? error.toString() : error.getMessage();
                    appendOutput("错误：" + message);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        postToWebview("{\"type\":\"run-error\",\"requestId\":" + json(requestId) + ",\"message\":" + json(message) + "}");
                        Messages.showErrorDialog(project, message, "HelionCoder");
                    });
                } finally {
                    if (requestId.equals(currentRequestId)) {
                        currentRequestId = null;
                        currentTask = null;
                        activeController = null;
                    }
                }
            });
        }

        private void stopCurrentRun() {
            cli.cancel();
            Future<?> task = currentTask;
            if (task != null) {
                task.cancel(true);
            }
            if (currentRequestId != null) {
                postToWebview("{\"type\":\"run-error\",\"requestId\":" + json(currentRequestId) + ",\"message\":\"HelionCoder 请求已取消。\"}");
                currentRequestId = null;
                currentTask = null;
                activeController = null;
            }
        }

        private void startNewConversation() {
            activeConversationId = UUID.randomUUID().toString();
            currentSessionId = null;
            postToWebview("{\"type\":\"conversation-new\"}");
            postContext();
        }

        private void appendHistory(@NotNull String role, @NotNull String text) {
            if (text.isBlank()) {
                return;
            }
            ConversationRecord record = conversations.computeIfAbsent(activeConversationId, id ->
                new ConversationRecord(id, titleFrom(text), System.currentTimeMillis(), new ArrayList<>())
            );
            record.messages().add(new ConversationMessage(role, text, System.currentTimeMillis()));
            record.touch(System.currentTimeMillis());
        }

        private void showHistory() {
            postToWebview("{\"type\":\"history-loaded\",\"title\":\"历史对话\",\"historyItems\":"
                + historyItemsJson(Integer.MAX_VALUE)
                + ",\"messages\":[]}");
        }

        private void openHistory(@NotNull String id) {
            ConversationRecord record = conversations.get(id);
            if (record == null) {
                postNotice("找不到这条历史对话。");
                return;
            }
            activeConversationId = id;
            postToWebview("{\"type\":\"conversation-restored\",\"sessionId\":" + json(id)
                + ",\"title\":" + json(record.title())
                + ",\"messages\":" + historyMessagesJson(record.messages())
                + "}");
            postContext();
        }

        private void sendSideQuestion(@NotNull String question) {
            HelionCli.StreamController controller = activeController;
            if (controller == null || question.trim().isEmpty()) {
                postToWebview("{\"type\":\"side-question-error\",\"requestId\":" + json(UUID.randomUUID().toString()) + ",\"question\":" + json(question) + ",\"message\":\"当前没有可接收引导的运行中任务。\"}");
                return;
            }
            String requestId = controller.sendSideQuestion(question.trim());
            if (requestId == null) {
                postToWebview("{\"type\":\"side-question-error\",\"requestId\":" + json(UUID.randomUUID().toString()) + ",\"question\":" + json(question) + ",\"message\":\"发送后续引导失败。\"}");
                return;
            }
            postToWebview("{\"type\":\"side-question-start\",\"requestId\":" + json(requestId) + ",\"question\":" + json(question) + "}");
        }

        private void respondToPermission(@NotNull String rawMessage) {
            HelionCli.StreamController controller = activeController;
            String requestId = coalesce(extract(REQUEST_ID_PATTERN, rawMessage), "");
            JsonElement response = extractJsonProperty(rawMessage, "response");
            if (controller == null || requestId.isBlank() || response == null) {
                postToWebview("{\"type\":\"permission-cancelled\",\"requestId\":" + json(requestId.isBlank() ? "manual" : requestId) + ",\"message\":\"这个权限请求已经失效。\"}");
                return;
            }
            if (!controller.sendPermissionResponse(requestId, response)) {
                postToWebview("{\"type\":\"permission-cancelled\",\"requestId\":" + json(requestId) + ",\"message\":\"这个权限请求已经失效。\"}");
            }
        }

        private void configureExecutable() {
            ApplicationManager.getApplication().invokeLater(() -> {
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
                    appendOutput("CLI 可执行文件设置已更新：" + (value.isBlank() ? "自动检测" : value));
                    postContext();
                    postNotice("HelionCoder 可执行文件设置已更新。");
                }
            });
        }

        private void insertText(@NotNull String text) {
            if (text.isEmpty()) {
                return;
            }
            var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            if (editor == null) {
                postNotice("没有活动编辑器，无法插入代码。");
                return;
            }
            WriteCommandAction.runWriteCommandAction(project, () ->
                editor.getDocument().insertString(editor.getCaretModel().getOffset(), text)
            );
        }

        private void openFileAt(@NotNull String rawPath, @NotNull String rawLabel, int line) {
            String path = rawPath.trim();
            String label = rawLabel.trim();
            if (path.isEmpty() && label.isEmpty()) {
                return;
            }
            ApplicationManager.getApplication().invokeLater(() -> {
                Path resolved = path.isEmpty() ? null : resolveProjectPath(path);
                VirtualFile file = resolved == null ? null : LocalFileSystem.getInstance().refreshAndFindFileByNioFile(resolved);
                if (file == null && !path.isEmpty()) {
                    file = findProjectFile(path);
                }
                if (file == null && !label.isEmpty() && !label.equals(path)) {
                    file = findProjectFile(label);
                }
                if (file == null) {
                    postNotice("找不到文件：" + (resolved == null ? label : resolved));
                    return;
                }
                FileEditorManager.getInstance(project).openTextEditor(
                    new OpenFileDescriptor(project, file, Math.max(0, line - 1), 0),
                    true
                );
            });
        }

        private void pickMention(@NotNull String mention) {
            if ("selection".equals(mention)) {
                String selected = ApplicationManager.getApplication().runReadAction((Computable<String>) () -> {
                    var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
                    return editor == null ? null : editor.getSelectionModel().getSelectedText();
                });
                if (selected == null || selected.isBlank()) {
                    postToWebview("{\"type\":\"mention-cancelled\"}");
                } else {
                    postToWebview("{\"type\":\"mention-picked\",\"text\":\"@selection\"}");
                }
                return;
            }

            if ("terminal".equals(mention)) {
                postToWebview("{\"type\":\"mention-picked\",\"text\":\"请分析下面的 @terminal 输出，并给出根因和修复步骤：\\n\"}");
                openTerminal(null, "HelionCoder");
                return;
            }

            if ("workspace".equals(mention)) {
                chooseWorkspace();
                return;
            }

            attachFile();
        }

        private void chooseWorkspace() {
            ApplicationManager.getApplication().invokeLater(() -> {
                FileChooserDescriptor descriptor = new FileChooserDescriptor(false, true, false, false, false, false)
                    .withTitle("选择要添加到 HelionCoder 上下文的工作区或文件夹");
                VirtualFile folder = FileChooser.chooseFile(descriptor, project, project.getBaseDir());
                if (folder == null) {
                    postToWebview("{\"type\":\"mention-cancelled\"}");
                    return;
                }
                postAttachment(folder);
            });
        }

        private void configureApi() {
            openTerminal(cli.terminalCommand(project, List.of("api-config")), "HelionCoder API 配置");
        }

        private void showPlugins() {
            openTerminal(cli.terminalCommand(project, List.of("plugins")), "HelionCoder 插件");
        }

        private void updateCli() {
            appendOutput("开始检查 HelionCoder CLI 更新。");
            postNotice("正在检查 HelionCoder CLI 更新...");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    String current = currentCliVersion();
                    String latest = latestReleaseVersion();
                    appendOutput("CLI 版本检查：当前 " + current + "，最新 " + latest);
                    int comparison = compareVersions(latest, current);
                    if (comparison <= 0) {
                        ApplicationManager.getApplication().invokeLater(() ->
                            postNotice("HelionCoder CLI 已是最新版本：" + current)
                        );
                        return;
                    }

                    ApplicationManager.getApplication().invokeLater(() -> {
                        int answer = Messages.showYesNoDialog(
                            project,
                            "HelionCoder CLI 有新版本：" + latest + "，当前版本：" + current + "。是否现在打开终端执行更新？",
                            "HelionCoder CLI 更新",
                            "更新",
                            "稍后",
                            null
                        );
                        if (answer == Messages.YES) {
                            String command = installCommand();
                            appendOutput("打开终端更新 HelionCoder CLI：\n" + command);
                            openTerminal(command, "HelionCoder CLI 更新");
                            postNotice("已打开终端执行 HelionCoder CLI 更新命令。");
                        } else {
                            appendOutput("用户跳过 CLI 更新。");
                            postNotice("已跳过 CLI 更新。");
                        }
                    });
                } catch (Exception error) {
                    String message = error.getMessage() == null ? error.toString() : error.getMessage();
                    appendOutput("检查更新失败：" + message);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (isMissingCliError(message)) {
                            promptInstallMissingCli();
                        } else {
                            postNotice("检查更新失败：" + message);
                        }
                    });
                }
            });
        }

        private void promptInstallMissingCli() {
            int answer = Messages.showYesNoDialog(
                project,
                "当前没有检测到本地 helion-coder CLI，无法比较版本。是否现在打开终端安装最新 CLI？\n\n也可以点「CLI 路径」配置 dist/helion-coder 或 dist/cli.mjs 的绝对路径。",
                "HelionCoder CLI 未安装",
                "安装 CLI",
                "稍后配置",
                null
            );
            if (answer == Messages.YES) {
                String command = installCommand();
                appendOutput("未检测到 CLI，打开终端安装：\n" + command);
                openTerminal(command, "HelionCoder CLI 安装");
                postNotice("已打开终端执行 HelionCoder CLI 安装命令。");
            } else {
                appendOutput("未检测到 CLI，用户选择稍后配置。");
                postNotice("未检测到本地 helion-coder CLI。请通过「CLI 路径」配置，或稍后安装 CLI。");
            }
        }

        private void showOutput() {
            String text;
            synchronized (outputLog) {
                text = outputLog.isEmpty() ? "还没有 HelionCoder 输出日志。" : outputLog.toString().trim();
            }
            String requestId = UUID.randomUUID().toString();
            postToWebview("{\"type\":\"run-start\",\"requestId\":" + json(requestId) + ",\"prompt\":\"打开输出\",\"mode\":\"status\"}");
            postToWebview("{\"type\":\"run-done\",\"requestId\":" + json(requestId) + ",\"text\":" + json("```text\n" + text + "\n```") + "}");
        }

        private @NotNull String currentCliVersion() throws IOException, InterruptedException {
            HelionCli.Result result = cli.runCommand(project, List.of("--version"), Duration.ofSeconds(10));
            String raw = (result.stdout() + "\n" + result.stderr()).trim();
            String version = normalizeVersion(raw);
            if (version == null) {
                throw new IOException("无法从 CLI 输出识别本地版本：" + raw);
            }
            return version;
        }

        private @NotNull String latestReleaseVersion() throws IOException, InterruptedException {
            HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(LATEST_RELEASE_URL))
                .timeout(Duration.ofSeconds(15))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "helion-coder-jetbrains")
                .GET()
                .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() >= 400) {
                throw new IOException("GitHub 返回 HTTP " + response.statusCode() + "：" + response.body());
            }
            JsonObject release = JsonParser.parseString(response.body()).getAsJsonObject();
            String raw = null;
            if (release.has("tag_name") && !release.get("tag_name").isJsonNull()) {
                raw = release.get("tag_name").getAsString();
            } else if (release.has("name") && !release.get("name").isJsonNull()) {
                raw = release.get("name").getAsString();
            }
            String version = normalizeVersion(raw == null ? "" : raw);
            if (version == null) {
                throw new IOException("GitHub Release 没有可识别的版本号。");
            }
            return version;
        }

        private static @NotNull String installCommand() {
            return System.getProperty("os.name", "").toLowerCase().contains("win")
                ? "powershell -NoProfile -ExecutionPolicy Bypass -Command \"iwr https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.ps1 -UseB | iex\""
                : "curl -fsSL https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.sh | sh";
        }

        private static boolean isMissingCliError(@NotNull String message) {
            return message.contains("Cannot run program")
                || message.contains("No such file or directory")
                || message.contains("CreateProcess error=2");
        }

        private static @Nullable String normalizeVersion(@NotNull String value) {
            Matcher matcher = VERSION_PATTERN.matcher(value.trim());
            return matcher.find() ? matcher.group(1) : null;
        }

        private static int compareVersions(@NotNull String left, @NotNull String right) {
            int[] a = versionParts(left);
            int[] b = versionParts(right);
            for (int i = 0; i < 3; i += 1) {
                if (a[i] != b[i]) {
                    return Integer.compare(a[i], b[i]);
                }
            }
            return 0;
        }

        private static int[] versionParts(@NotNull String version) {
            String normalized = normalizeVersion(version);
            String[] parts = (normalized == null ? "0.0.0" : normalized).split("[+-]")[0].split("\\.");
            return new int[]{
                parseVersionPart(parts, 0),
                parseVersionPart(parts, 1),
                parseVersionPart(parts, 2)
            };
        }

        private static int parseVersionPart(String[] parts, int index) {
            if (index >= parts.length) {
                return 0;
            }
            try {
                return Integer.parseInt(parts[index]);
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }

        private void openTerminal(@Nullable String command, @NotNull String tabName) {
            ApplicationManager.getApplication().invokeLater(() -> {
                try {
                    ToolWindow terminal = ToolWindowManager.getInstance(project).getToolWindow("Terminal");
                    if (terminal != null) {
                        terminal.show();
                    }

                    Class<?> managerClass = Class.forName("org.jetbrains.plugins.terminal.TerminalToolWindowManager");
                    Object manager = managerClass.getMethod("getInstance", Project.class).invoke(null, project);
                    Object widget = managerClass
                        .getMethod("createLocalShellWidget", String.class, String.class)
                        .invoke(manager, workspaceDirectory(), tabName);

                    if (command != null && !command.isBlank()) {
                        widget.getClass().getMethod("executeCommand", String.class).invoke(widget, command);
                    }
                } catch (ClassNotFoundException error) {
                    postNotice("当前 IDE 没有启用 Terminal 插件，无法自动打开终端。");
                } catch (NoSuchMethodException | IllegalAccessException | InvocationTargetException error) {
                    Throwable cause = error instanceof InvocationTargetException invocation && invocation.getCause() != null
                        ? invocation.getCause()
                        : error;
                    postNotice("打开 JetBrains Terminal 失败：" + cause.getMessage());
                }
            });
        }

        private @NotNull String workspaceDirectory() {
            String basePath = project.getBasePath();
            return basePath == null ? System.getProperty("user.home") : basePath;
        }

        private void attachFile() {
            ApplicationManager.getApplication().invokeLater(() -> {
                FileChooserDescriptor descriptor = new FileChooserDescriptor(true, false, false, false, false, true)
                    .withTitle("选择要添加到 HelionCoder 上下文的文件");
                VirtualFile[] files = FileChooser.chooseFiles(descriptor, project, project.getBaseDir());
                if (files.length == 0) {
                    postToWebview("{\"type\":\"mention-cancelled\"}");
                    return;
                }
                for (VirtualFile file : files) {
                    postAttachment(file);
                }
            });
        }

        private void attachDroppedUris(@NotNull String rawMessage) {
            Matcher matcher = QUOTED_PATTERN.matcher(rawMessage);
            boolean attached = false;
            while (matcher.find()) {
                String value = unescapeJson(matcher.group(1));
                if (!value.startsWith("file:")) {
                    continue;
                }
                try {
                    Path path = Paths.get(new URI(value));
                    VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path);
                    if (file == null) {
                        continue;
                    }
                    postAttachment(file);
                    attached = true;
                } catch (IllegalArgumentException | URISyntaxException ignored) {
                }
            }
            if (!attached) {
                postToWebview("{\"type\":\"mention-cancelled\"}");
            }
        }

        private void postAttachment(@NotNull VirtualFile file) {
            if (file.isDirectory()) {
                String token = "@workspace(\"" + escapeMentionPath(relativeProjectPath(file.getPath())) + "\")";
                postToWebview("{\"type\":\"mention-picked\",\"kind\":\"workspace\",\"label\":" + json(file.getName())
                    + ",\"text\":" + json(token)
                    + ",\"token\":" + json(token)
                    + ",\"path\":" + json(file.getPath()) + "}");
                return;
            }

            boolean image = isImageFile(file.getName());
            String token = image ? "" : "@file(\"" + escapeMentionPath(relativeProjectPath(file.getPath())) + "\")";
            String src = image ? imageSrc(file) : "";
            postToWebview("{\"type\":\"mention-picked\",\"kind\":" + json(image ? "image" : "file")
                + ",\"label\":" + json(file.getName())
                + ",\"text\":" + json(token)
                + ",\"token\":" + json(token)
                + ",\"path\":" + json(file.getPath())
                + (src.isBlank() ? "" : ",\"src\":" + json(src))
                + "}");
        }

        private void postContext() {
            String payload = ApplicationManager.getApplication().runReadAction((Computable<String>) () -> {
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
                String models = modelsJson(modelResolver.listModels(false));
                return "{"
                    + "\"type\":\"context\","
                    + "\"cli\":\"本地 CLI\","
                    + "\"file\":" + json(file) + ","
                    + "\"language\":" + json(language) + ","
                    + "\"selectedChars\":" + selectedChars + ","
                    + "\"models\":" + models + ","
                    + "\"model\":" + json(model) + ","
                    + "\"effort\":" + json(effort) + ","
                    + "\"permissionMode\":" + json(HelionSettings.permissionMode()) + ","
                    + "\"thinkingMode\":" + json(HelionSettings.thinking()) + ","
                    + "\"includeContext\":" + (HelionSettings.includeEditorContext() ? "true" : "false") + ","
                    + "\"planMode\":" + ("plan".equals(HelionSettings.permissionMode()) ? "true" : "false") + ","
                    + "\"recentHistory\":" + historyItemsJson(3) + ","
                    + "\"recentHistoryTotal\":" + conversations.size()
                    + "}";
            });
            postToWebview(payload);
        }

        private void refreshModels() {
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                modelResolver.invalidate();
                List<HelionModelResolver.ModelCandidate> models = modelResolver.listModels(true);
                String selected = HelionSettings.model();
                if (!selected.isBlank() && isOnlyCurrentSelection(models, selected)) {
                    HelionSettings.setModel("");
                    modelResolver.invalidate();
                    models = modelResolver.listModels(true);
                    appendOutput("当前 JetBrains 选择的模型已不在最新配置/API 列表中，已切回 CLI 默认模型。");
                    notifyUser("模型列表已刷新，旧选择不在最新列表中，已切回 CLI 默认模型。", NotificationType.INFORMATION);
                }
                appendOutput("已刷新模型列表：" + models.size() + " 个");
                ApplicationManager.getApplication().invokeLater(this::postContext);
            });
        }

        private static boolean isOnlyCurrentSelection(
            @NotNull List<HelionModelResolver.ModelCandidate> models,
            @NotNull String selected
        ) {
            for (HelionModelResolver.ModelCandidate model : models) {
                if (model.id().equalsIgnoreCase(selected) && !"当前选择".equals(model.source())) {
                    return false;
                }
            }
            return true;
        }

        private void refreshModelsOnFirstReady() {
            if (autoModelRefreshStarted) {
                return;
            }
            autoModelRefreshStarted = true;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                modelResolver.invalidate();
                modelResolver.listModels(true);
                ApplicationManager.getApplication().invokeLater(this::postContext);
            });
        }

        private static @NotNull String modelsJson(@NotNull List<HelionModelResolver.ModelCandidate> models) {
            StringBuilder output = new StringBuilder("[");
            for (HelionModelResolver.ModelCandidate model : models) {
                if (output.length() > 1) {
                    output.append(',');
                }
                output.append('{')
                    .append("\"id\":").append(json(model.id()))
                    .append(",\"label\":").append(json(model.label()))
                    .append(",\"source\":").append(json(model.source()));
                if (model.description() != null) {
                    output.append(",\"description\":").append(json(model.description()));
                }
                output.append('}');





            }
            return output.append(']').toString();
       
        }

        private void postNotice(@NotNull String message) {
            appendOutput(message);
            String requestId = UUID.randomUUID().toString();
            postToWebview("{\"type\":\"run-start\",\"requestId\":" + json(requestId) + ",\"prompt\":\"系统消息\",\"mode\":\"status\"}");
            postToWebview("{\"type\":\"run-done\",\"requestId\":" + json(requestId) + ",\"text\":" + json(message) + "}");
        }

        private void notifyUser(@NotNull String message, @NotNull NotificationType type) {
            appendOutput(message);
            NotificationGroupManager.getInstance()
                .getNotificationGroup("HelionCoder")
                .createNotification(message, type)
                .notify(project);
        }

        private void appendOutput(@NotNull String message) {
            if (message.isBlank()) {
                return;
            }
            synchronized (outputLog) {
                outputLog.append("[").append(java.time.LocalTime.now().withNano(0)).append("] ");
                outputLog.append(message.trim()).append("\n\n");
                int overflow = outputLog.length() - 80_000;
                if (overflow > 0) {
                    outputLog.delete(0, overflow);
                }
            }
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
                        <button type="button" class="header-back" id="backToTasks" title="返回任务">__ICON_ARROW_LEFT__</button>
                        <strong id="headerTitle">任务</strong>
                      </div>
                      <span id="cliLabel" class="sr-only">本地 CLI</span>
                      <div class="top-actions">
                        <button class="icon-button" id="history" title="历史对话">__ICON_HISTORY__</button>
                        <button class="icon-button" id="settingsMenu" title="设置">__ICON_SETTINGS__</button>
                        <button class="icon-button" id="newConversation" title="新建对话">__ICON_EDIT__</button>
                      </div>
                    </header>

                    <section class="timeline" id="timeline" aria-live="polite">
                      <article class="empty-state">
                        <div class="welcome">
                          <span>HelionCoder</span>
                          <strong>让 Helion 理解、修改、审查或规划你的工作区。</strong>
                        </div>
                        <div class="release-card">
                          <span>__ICON_CIRCLE_INFO__</span>
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
                              <span>__ICON_CHEVRON__</span>
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
                          <button type="submit" class="send" title="发送">__ICON_SEND__</button>
                        </div>
                        <div class="composer-row settings-row">
                          <button type="button" class="round-tool" id="addMenu" title="添加上下文">__ICON_PLUS__</button>
                          <button type="button" class="context-ring" id="contextWindow" title="上下文窗口">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-bg" cx="12" cy="12" r="8"></circle><circle class="ring-fg" id="contextRing" cx="12" cy="12" r="8"></circle></svg>
                            <span class="sr-only" id="contextWindowPercent">0% used</span>
                            <span class="sr-only" id="contextWindowTokens">0 / 0 tokens used</span>
                          </button>
                          <button type="button" class="mode-chip" id="permissionMenu" title="权限模式">
                            <span id="permissionIcon">__ICON_SHIELD__</span>
                            <span id="permissionLabel">默认</span>
                            <span>__ICON_CHEVRON__</span>
                          </button>
                          <button type="button" class="ghost steer-action" id="guide" title="作为后续引导发送" hidden>__ICON_CORNER_DOWN_RIGHT__ 引导</button>
                          <button type="button" class="ghost run-action" id="stop" hidden>停止</button>
                        </div>
                      </div>
                    </form>

                    <div class="menu-popover" id="addPopover" hidden>
                      <button type="button" data-menu-action="attach">__ICON_PAPERCLIP__ <span>添加图片和文件</span></button>
                      <button type="button" data-menu-action="toggle-context">__ICON_SPARK__ <span>包含编辑器上下文</span><i id="includeContextSwitch"></i></button>
                      <button type="button" data-menu-action="toggle-plan" id="planToggle">__ICON_LIST__ <span>计划模式</span><i id="planSwitch"></i></button>
                      <button type="button" data-menu-action="plugins">__ICON_GRID__ <span>插件</span><strong>__ICON_CHEVRON_RIGHT__</strong></button>
                    </div>
                    <div class="menu-popover compact-menu" id="permissionPopover" hidden>
                      <button type="button" data-permission-mode="default">__ICON_HAND__ <span>默认权限</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-permission-mode="acceptEdits">__ICON_REVIEW__ <span>自动审查</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-permission-mode="bypassPermissions">__ICON_ALERT__ <span>完全访问权限</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-permission-mode="plan">__ICON_LIST__ <span>计划模式</span><strong>__ICON_CHECK__</strong></button>
                    </div>
                    <div class="menu-popover model-effort-popover" id="modelEffortPopover" hidden>
                      <div class="menu-title">智能</div>
                      <button type="button" data-effort-option="low"><span></span><span>低</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-effort-option="medium"><span></span><span>中</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-effort-option="high"><span></span><span>高</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" data-effort-option="max"><span></span><span>超高</span><strong>__ICON_CHECK__</strong></button>
                      <button type="button" class="has-submenu model-switch-row" id="openModelSubmenu"><span></span><span id="modelMenuLabel">默认</span><strong>__ICON_CHEVRON_RIGHT__</strong></button>
                    </div>
                    <div class="menu-popover model-sub-popover" id="modelSubPopover" hidden>
                      <div class="menu-title">切换模型</div>
                      <div class="model-options" id="modelOptions"></div>
                    </div>
                    <div class="menu-popover settings-popover" id="settingsPopover" hidden>
                      <button type="button" data-settings-action="configure-api">__ICON_USER__ <span>API 设置</span></button>
                      <button type="button" data-settings-action="configure-cli">__ICON_SETTINGS__ <span>CLI 路径</span></button>
                      <button type="button" data-settings-action="refresh-models">__ICON_REFRESH__ <span>刷新模型</span></button>
                      <button type="button" data-settings-action="check-updates">__ICON_DOWNLOAD__ <span>检查更新</span></button>
                      <button type="button" data-settings-action="output">__ICON_TERMINAL__ <span>打开输出</span></button>
                      <button type="button" data-settings-action="plugins">__ICON_GRID__ <span>插件</span></button>
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
                .replace("__HELION_ASSISTANT__", assistant)
                .replace("__ICON_ARROW_LEFT__", iconSvg("arrowLeft"))
                .replace("__ICON_HISTORY__", iconSvg("history"))
                .replace("__ICON_SETTINGS__", iconSvg("settings"))
                .replace("__ICON_EDIT__", iconSvg("edit"))
                .replace("__ICON_CIRCLE_INFO__", iconSvg("circleInfo"))
                .replace("__ICON_CHEVRON__", iconSvg("chevron"))
                .replace("__ICON_SEND__", iconSvg("send"))
                .replace("__ICON_PLUS__", iconSvg("plus"))
                .replace("__ICON_SHIELD__", iconSvg("shield"))
                .replace("__ICON_CORNER_DOWN_RIGHT__", iconSvg("cornerDownRight"))
                .replace("__ICON_PAPERCLIP__", iconSvg("paperclip"))
                .replace("__ICON_SPARK__", iconSvg("spark"))
                .replace("__ICON_LIST__", iconSvg("list"))
                .replace("__ICON_GRID__", iconSvg("grid"))
                .replace("__ICON_CHEVRON_RIGHT__", iconSvg("chevronRight"))
                .replace("__ICON_HAND__", iconSvg("hand"))
                .replace("__ICON_REVIEW__", iconSvg("review"))
                .replace("__ICON_ALERT__", iconSvg("alert"))
                .replace("__ICON_CHECK__", iconSvg("check"))
                .replace("__ICON_USER__", iconSvg("user"))
                .replace("__ICON_REFRESH__", iconSvg("refresh"))
                .replace("__ICON_DOWNLOAD__", iconSvg("download"))
                .replace("__ICON_TERMINAL__", iconSvg("terminal"));
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

        private @NotNull Path resolveProjectPath(@NotNull String path) {
            Path candidate = Paths.get(path);
            if (candidate.isAbsolute()) {
                return candidate;
            }
            String basePath = project.getBasePath();
            return basePath == null ? candidate.toAbsolutePath() : Paths.get(basePath).resolve(candidate).normalize();
        }

        private @Nullable VirtualFile findProjectFile(@NotNull String path) {
            String basePath = project.getBasePath();
            if (basePath == null) {
                return null;
            }
            Path base = Paths.get(basePath).normalize();
            Path candidate = Paths.get(path);
            List<Path> attempts = new ArrayList<>();
            if (!candidate.isAbsolute()) {
                attempts.add(base.resolve(candidate).normalize());
            }
            attempts.add(base.resolve(candidate.getFileName() == null ? path : candidate.getFileName().toString()).normalize());
            for (Path attempt : attempts) {
                VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(attempt);
                if (file != null) {
                    return file;
                }
            }
            String fileName = candidate.getFileName() == null ? path : candidate.getFileName().toString();
            try (var stream = Files.walk(base, 8)) {
                return stream
                    .filter(Files::isRegularFile)
                    .filter(found -> found.getFileName() != null && fileName.equals(found.getFileName().toString()))
                    .findFirst()
                    .map(found -> LocalFileSystem.getInstance().refreshAndFindFileByNioFile(found))
                    .orElse(null);
            } catch (IOException ignored) {
                return null;
            }
        }

        private @NotNull JsonObject normalizeToolStep(@NotNull JsonObject step) {
            JsonObject copy = step.deepCopy();
            JsonElement filePath = copy.get("filePath");
            if (filePath == null || !filePath.isJsonPrimitive() || !filePath.getAsJsonPrimitive().isString()) {
                return copy;
            }
            String normalized = normalizeStepFilePath(filePath.getAsString());
            if (!normalized.isBlank()) {
                copy.addProperty("filePath", normalized);
                copy.addProperty("fileLabel", Path.of(normalized).getFileName() == null ? normalized : Path.of(normalized).getFileName().toString());
            }
            return copy;
        }

        private @NotNull String normalizeStepFilePath(@NotNull String path) {
            String trimmed = path.trim();
            if (trimmed.isEmpty()) {
                return trimmed;
            }
            Path resolved = resolveProjectPath(trimmed);
            if (Files.exists(resolved)) {
                return resolved.toString();
            }
            VirtualFile found = findProjectFile(trimmed);
            return found == null ? trimmed : found.getPath();
        }

        private @NotNull String relativeProjectPath(@NotNull String path) {
            String basePath = project.getBasePath();
            if (basePath == null) {
                return path;
            }
            try {
                return Paths.get(basePath).relativize(Paths.get(path)).toString();
            } catch (IllegalArgumentException ignored) {
                return path;
            }
        }

        private @NotNull Map<String, String> snapshotWorkspaceFiles() {
            String basePath = project.getBasePath();
            if (basePath == null) {
                return Map.of();
            }
            Path root = Paths.get(basePath);
            Map<String, String> snapshot = new HashMap<>();
            try (var stream = Files.walk(root)) {
                stream
                    .filter(Files::isRegularFile)
                    .filter(path -> shouldSnapshot(path, root))
                    .limit(800)
                    .forEach(path -> {
                        try {
                            snapshot.put(path.toString(), Files.readString(path, StandardCharsets.UTF_8));
                        } catch (IOException ignored) {
                        }
                    });
            } catch (IOException ignored) {
            }
            return snapshot;
        }

        private @NotNull List<ReviewChange> createReview(@NotNull Map<String, String> before) {
            Map<String, String> after = snapshotWorkspaceFiles();
            List<ReviewChange> changes = new ArrayList<>();
            for (Map.Entry<String, String> entry : after.entrySet()) {
                String oldText = before.get(entry.getKey());
                if (oldText == null) {
                    changes.add(reviewChange(entry.getKey(), "created", "", entry.getValue()));
                } else if (!oldText.equals(entry.getValue())) {
                    changes.add(reviewChange(entry.getKey(), "modified", oldText, entry.getValue()));
                }
            }
            for (Map.Entry<String, String> entry : before.entrySet()) {
                if (!after.containsKey(entry.getKey())) {
                    changes.add(reviewChange(entry.getKey(), "deleted", entry.getValue(), ""));
                }
            }
            return changes;
        }

        private @NotNull ReviewChange reviewChange(
            @NotNull String filePath,
            @NotNull String kind,
            @NotNull String before,
            @NotNull String after
        ) {
            int[] counts = diffCounts(before, after);
            return new ReviewChange(filePath, relativeProjectPath(filePath), kind, before, after, counts[0], counts[1]);
        }

        private static int @NotNull [] diffCounts(@NotNull String before, @NotNull String after) {
            HashSet<String> beforeLines = new HashSet<>(List.of(before.split("\\R", -1)));
            HashSet<String> afterLines = new HashSet<>(List.of(after.split("\\R", -1)));
            int added = 0;
            int removed = 0;
            for (String line : afterLines) {
                if (!beforeLines.contains(line)) {
                    added += 1;
                }
            }
            for (String line : beforeLines) {
                if (!afterLines.contains(line)) {
                    removed += 1;
                }
            }
            return new int[]{added, removed};
        }

        private static boolean shouldSnapshot(@NotNull Path path, @NotNull Path root) {
            String relative = root.relativize(path).toString();
            for (String part : relative.split("[/\\\\]")) {
                if (part.equals(".git")
                    || part.equals("node_modules")
                    || part.equals("build")
                    || part.equals("dist")
                    || part.equals(".idea")
                    || part.equals(".gradle")
                    || part.equals("target")) {
                    return false;
                }
            }
            try {
                if (Files.size(path) > 1_000_000) {
                    return false;
                }
            } catch (IOException ignored) {
                return false;
            }
            String name = path.getFileName().toString().toLowerCase();
            return !isImageFile(name)
                && !name.endsWith(".zip")
                && !name.endsWith(".jar")
                && !name.endsWith(".class")
                && !name.endsWith(".png")
                && !name.endsWith(".jpg")
                && !name.endsWith(".jpeg")
                && !name.endsWith(".gif")
                && !name.endsWith(".webp");
        }

        private @NotNull String reviewJson(@NotNull List<ReviewChange> changes) {
            if (changes.isEmpty()) {
                return "";
            }
            String id = Long.toString(System.currentTimeMillis());
            reviews.put(id, changes);
            StringBuilder files = new StringBuilder("[");
            for (ReviewChange change : changes) {
                if (files.length() > 1) {
                    files.append(',');
                }
                files.append('{')
                    .append("\"path\":").append(json(change.path()))
                    .append(",\"kind\":").append(json(change.kind()))
                    .append(",\"kindLabel\":").append(json(kindLabel(change.kind())))
                    .append(",\"added\":").append(change.added())
                    .append(",\"removed\":").append(change.removed())
                    .append(",\"summary\":").append(json(kindLabel(change.kind()) + " " + change.path()))
                    .append('}');
            }
            files.append(']');
            return ",\"review\":{\"id\":" + json(id) + ",\"files\":" + files + ",\"fileCount\":" + changes.size() + "}";
        }

        private static @NotNull String kindLabel(@NotNull String kind) {
            return switch (kind) {
                case "created" -> "新增";
                case "deleted" -> "删除";
                default -> "修改";
            };
        }

        private @NotNull String historyItemsJson(int limit) {
            List<ConversationRecord> records = new ArrayList<>(conversations.values());
            records.sort((left, right) -> Long.compare(right.updatedAt(), left.updatedAt()));
            StringBuilder output = new StringBuilder("[");
            int count = 0;
            for (ConversationRecord record : records) {
                if (record.messages().isEmpty()) {
                    continue;
                }
                if (limit >= 0 && count >= limit) {
                    break;
                }
                if (output.length() > 1) {
                    output.append(',');
                }
                output.append('{')
                    .append("\"id\":").append(json(record.id()))
                    .append(",\"title\":").append(json(record.title()))
                    .append(",\"timestamp\":").append(record.updatedAt())
                    .append(",\"messageCount\":").append(record.messages().size())
                    .append('}');
                count += 1;
            }
            return output.append(']').toString();
        }

        private static @NotNull String historyMessagesJson(@NotNull List<ConversationMessage> messages) {
            StringBuilder output = new StringBuilder("[");
            for (ConversationMessage message : messages) {
                if (output.length() > 1) {
                    output.append(',');
                }
                output.append('{')
                    .append("\"role\":").append(json(message.role()))
                    .append(",\"text\":").append(json(message.text()))
                    .append(",\"timestamp\":").append(message.timestamp())
                    .append('}');
            }
            return output.append(']').toString();
        }

        private static @NotNull String titleFrom(@NotNull String text) {
            String normalized = text.replaceAll("\\s+", " ").trim();
            if (normalized.isEmpty()) {
                return "未命名任务";
            }
            return normalized.length() <= 48 ? normalized : normalized.substring(0, 48) + "...";
        }

        private void openReview(@NotNull String reviewId, int index) {
            ApplicationManager.getApplication().invokeLater(() -> {
                List<ReviewChange> changes = reviews.get(reviewId);
                if (changes == null || changes.isEmpty()) {
                    notifyUser("这组变更已经不可用，请重新运行一次任务。", NotificationType.WARNING);
                    return;
                }
                if (index >= changes.size()) {
                    notifyUser("找不到这个文件的变更。", NotificationType.WARNING);
                    return;
                }
                List<ReviewChange> selected = index >= 0 ? List.of(changes.get(index)) : changes;
                List<DiffRequest> requests = new ArrayList<>();
                for (ReviewChange change : selected) {
                    requests.add(diffRequest(change));
                }
                if (requests.isEmpty()) {
                    notifyUser("没有可预览的文本变更。", NotificationType.WARNING);
                    return;
                }
                if (requests.size() == 1) {
                    DiffManager.getInstance().showDiff(project, requests.get(0), DiffDialogHints.DEFAULT);
                } else {
                    DiffManager.getInstance().showDiff(project, new SimpleDiffRequestChain(requests), DiffDialogHints.DEFAULT);
                }
            });
        }

        private @NotNull DiffRequest diffRequest(@NotNull ReviewChange change) {
            DiffContentFactory factory = DiffContentFactory.getInstance();
            DiffContent before = factory.create(project, change.before());
            DiffContent after = factory.create(project, change.after());
            return new SimpleDiffRequest(
                "HelionCoder: " + change.path(),
                before,
                after,
                "运行前",
                "当前"
            );
        }

        private void acceptReview(@NotNull String reviewId) {
            if (reviews.remove(reviewId) == null) {
                notifyUser("这组变更已经不可用。", NotificationType.WARNING);
                return;
            }
            postToWebview("{\"type\":\"review-cleared\",\"reviewId\":" + json(reviewId) + "}");
            notifyUser("已接受这组变更。", NotificationType.INFORMATION);
        }

        private void rejectReview(@NotNull String reviewId) {
            List<ReviewChange> changes = reviews.remove(reviewId);
            if (changes == null || changes.isEmpty()) {
                notifyUser("这组变更已经不可用。", NotificationType.WARNING);
                return;
            }
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                List<String> failed = new ArrayList<>();
                for (ReviewChange change : changes) {
                    try {
                        restoreChange(change);
                    } catch (IOException error) {
                        failed.add(change.path());
                    }
                }
                LocalFileSystem.getInstance().refresh(false);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (failed.isEmpty()) {
                        postToWebview("{\"type\":\"review-cleared\",\"reviewId\":" + json(reviewId) + "}");
                        notifyUser("已拒绝并恢复这组变更。", NotificationType.INFORMATION);
                    } else {
                        notifyUser("部分文件恢复失败：" + String.join(", ", failed), NotificationType.ERROR);
                    }
                });
            });
        }

        private void restoreChange(@NotNull ReviewChange change) throws IOException {
            Path path = Paths.get(change.absolutePath());
            if ("created".equals(change.kind())) {
                Files.deleteIfExists(path);
                return;
            }
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(path, change.before(), StandardCharsets.UTF_8);
        }

        private record ReviewChange(
            @NotNull String absolutePath,
            @NotNull String path,
            @NotNull String kind,
            @NotNull String before,
            @NotNull String after,
            int added,
            int removed
        ) {
        }

        private record ConversationMessage(@NotNull String role, @NotNull String text, long timestamp) {
        }

        private static final class ConversationRecord {
            private final String id;
            private final String title;
            private final long createdAt;
            private final List<ConversationMessage> messages;
            private long updatedAt;

            private ConversationRecord(
                @NotNull String id,
                @NotNull String title,
                long createdAt,
                @NotNull List<ConversationMessage> messages
            ) {
                this.id = id;
                this.title = title;
                this.createdAt = createdAt;
                this.updatedAt = createdAt;
                this.messages = messages;
            }

            private @NotNull String id() {
                return id;
            }

            private @NotNull String title() {
                return title;
            }

            private long updatedAt() {
                return updatedAt;
            }

            private @NotNull List<ConversationMessage> messages() {
                return messages;
            }

            private void touch(long timestamp) {
                updatedAt = timestamp;
            }
        }

        private @NotNull String withImageAttachmentRefs(@NotNull String prompt, @NotNull String attachmentsJson) {
            JsonElement element;
            try {
                element = JsonParser.parseString(attachmentsJson);
            } catch (RuntimeException ignored) {
                return prompt;
            }
            if (!element.isJsonArray()) {
                return prompt;
            }

            List<String> refs = new ArrayList<>();
            for (JsonElement item : element.getAsJsonArray()) {
                if (!item.isJsonObject()) {
                    continue;
                }
                JsonObject object = item.getAsJsonObject();
                String kind = jsonString(object, "kind");
                String path = jsonString(object, "path");
                if ("image".equals(kind) && path != null && !path.isBlank()) {
                    refs.add("@\"" + escapeMentionPath(path) + "\"");
                }
            }
            if (refs.isEmpty()) {
                return prompt;
            }
            return String.join("\n", refs) + "\n\n" + prompt;
        }

        private static @NotNull String attachmentsJson(@NotNull String rawMessage) {
            JsonElement element = extractJsonProperty(rawMessage, "attachments");
            return element != null && element.isJsonArray() ? GSON.toJson(element) : "[]";
        }

        private static @NotNull String escapeMentionPath(@NotNull String path) {
            return path.replace("\\", "\\\\").replace("\"", "\\\"");
        }

        private static boolean isImageFile(@NotNull String name) {
            String lower = name.toLowerCase();
            return lower.endsWith(".png")
                || lower.endsWith(".jpg")
                || lower.endsWith(".jpeg")
                || lower.endsWith(".gif")
                || lower.endsWith(".webp")
                || lower.endsWith(".bmp")
                || lower.endsWith(".svg");
        }

        private static @NotNull String imageSrc(@NotNull VirtualFile file) {
            try {
                Path path = Paths.get(file.getPath());
                byte[] bytes = Files.readAllBytes(path);
                return "data:" + imageMimeType(file.getName()) + ";base64," + Base64.getEncoder().encodeToString(bytes);
            } catch (IOException | RuntimeException ignored) {
                return "";
            }
        }

        private static @NotNull String imageMimeType(@NotNull String name) {
            String lower = name.toLowerCase();
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
                return "image/jpeg";
            }
            if (lower.endsWith(".gif")) {
                return "image/gif";
            }
            if (lower.endsWith(".webp")) {
                return "image/webp";
            }
            if (lower.endsWith(".bmp")) {
                return "image/bmp";
            }
            if (lower.endsWith(".svg")) {
                return "image/svg+xml";
            }
            return "image/png";
        }

        private static @Nullable String jsonString(@NotNull JsonObject object, @NotNull String key) {
            if (!object.has(key) || !object.get(key).isJsonPrimitive()) {
                return null;
            }
            try {
                return object.get(key).getAsString();
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        private static @NotNull String iconSvg(@NotNull String name) {
            String paths = switch (name) {
                case "plus" -> "<path d=\"M12 5v14M5 12h14\"/>";
                case "edit" -> "<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z\"/>";
                case "arrowLeft" -> "<path d=\"m15 18-6-6 6-6\"/><path d=\"M21 12H9\"/>";
                case "user" -> "<path d=\"M20 21a8 8 0 0 0-16 0\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>";
                case "history" -> "<path d=\"M3 12a9 9 0 1 0 3-6.7\"/><path d=\"M3 4v5h5\"/>";
                case "refresh" -> "<path d=\"M20 6v5h-5\"/><path d=\"M4 18v-5h5\"/><path d=\"M18 9a6 6 0 0 0-10-3L4 9\"/><path d=\"M6 15a6 6 0 0 0 10 3l4-3\"/>";
                case "download" -> "<path d=\"M12 3v12\"/><path d=\"m7 10 5 5 5-5\"/><path d=\"M5 21h14\"/>";
                case "terminal" -> "<path d=\"m4 7 5 5-5 5\"/><path d=\"M11 17h9\"/>";
                case "settings" -> "<path d=\"M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3-.2-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.2.1-2-3 .1-.1A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.5-1H3v-4h.5A1.7 1.7 0 0 0 5 9a1.7 1.7 0 0 0-.3-1.9L4.6 7l2-3 .2.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h5v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.2-.1 2 3-.1.1A1.7 1.7 0 0 0 19 9a1.7 1.7 0 0 0 1.5 1h.5v4h-.5A1.7 1.7 0 0 0 19.4 15Z\"/>";
                case "shield" -> "<path d=\"M12 3 5 6v5c0 4 3 7 7 10 4-3 7-6 7-10V6l-7-3Z\"/>";
                case "chevron" -> "<path d=\"m8 10 4 4 4-4\"/>";
                case "chevronRight" -> "<path d=\"m9 6 6 6-6 6\"/>";
                case "paperclip" -> "<path d=\"m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.3 3.3 0 0 1 4.7 4.7L10 18.3a1.7 1.7 0 0 1-2.3-2.3L16 7.7\"/>";
                case "spark" -> "<path d=\"M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3\"/>";
                case "list" -> "<path d=\"M8 6h13M8 12h13M8 18h13\"/><path d=\"M3 6h.01M3 12h.01M3 18h.01\"/>";
                case "grid" -> "<path d=\"M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z\"/>";
                case "hand" -> "<path d=\"M7 11V6a2 2 0 0 1 4 0v4\"/><path d=\"M11 10V5a2 2 0 0 1 4 0v6\"/><path d=\"M15 11V7a2 2 0 0 1 4 0v6c0 5-3 8-7 8h-1a7 7 0 0 1-6-4l-2-5a2 2 0 0 1 4-1l1 2\"/>";
                case "review" -> "<path d=\"M4 6h16M4 12h10M4 18h7\"/><path d=\"m15 17 2 2 4-5\"/>";
                case "alert" -> "<path d=\"M12 9v4M12 17h.01\"/><path d=\"M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z\"/>";
                case "check" -> "<path d=\"m5 12 5 5L20 7\"/>";
                case "cornerDownRight" -> "<path d=\"M15 10l5 5-5 5\"/><path d=\"M4 4v7a4 4 0 0 0 4 4h12\"/>";
                case "circleInfo" -> "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8h.01\"/>";
                case "send" -> "<path d=\"M12 19V5\"/><path d=\"m5 12 7-7 7 7\"/>";
                default -> "<circle cx=\"12\" cy=\"12\" r=\"4\"/>";
            };
            return "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">" + paths + "</svg>";
        }

        private static @Nullable String extract(@NotNull Pattern pattern, @NotNull String value) {
            Matcher matcher = pattern.matcher(value);
            return matcher.find() ? unescapeJson(matcher.group(1)) : null;
        }

        private static @Nullable JsonElement extractJsonProperty(@NotNull String rawJson, @NotNull String property) {
            try {
                JsonElement element = JsonParser.parseString(rawJson);
                if (!element.isJsonObject()) {
                    return null;
                }
                JsonObject object = element.getAsJsonObject();
                return object.has(property) ? object.get(property) : null;
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        private static @Nullable String jsonString(@NotNull String rawJson, @NotNull String property) {
            JsonElement element = extractJsonProperty(rawJson, property);
            if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
                return null;
            }
            return element.getAsString();
        }

        private static int jsonInt(@NotNull String rawJson, @NotNull String property, int fallback) {
            JsonElement element = extractJsonProperty(rawJson, property);
            if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isNumber()) {
                return fallback;
            }
            try {
                return element.getAsInt();
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }

        private static boolean extractBoolean(@NotNull String value, boolean fallback) {
            Matcher matcher = VALUE_PATTERN.matcher(value);
            return matcher.find() ? Boolean.parseBoolean(matcher.group(1)) : fallback;
        }

        private static int extractInt(@NotNull Pattern pattern, @NotNull String value, int fallback) {
            Matcher matcher = pattern.matcher(value);
            if (!matcher.find()) {
                return fallback;
            }
            try {
                return Integer.parseInt(matcher.group(1));
            } catch (NumberFormatException ignored) {
                return fallback;
            }
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
