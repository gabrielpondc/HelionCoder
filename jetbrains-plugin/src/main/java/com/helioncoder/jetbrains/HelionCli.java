package com.helioncoder.jetbrains;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public final class HelionCli {
    private static final Gson GSON = new Gson();

    private volatile Process activeProcess;
    private volatile Writer activeStdin;

    public record Result(String stdout, String stderr, int code, String commandLine) {
    }

    public record StreamResult(String stdout, String stderr, int code, String commandLine, String sessionId, JsonObject usage) {
    }

    public interface StreamCallbacks {
        default void onController(@NotNull StreamController controller) {
        }

        default void onText(@NotNull String chunk) {
        }

        default void onThinking(@NotNull String chunk) {
        }

        default void onUsage(@NotNull JsonObject usage) {
        }

        default void onToolStep(@NotNull JsonObject step) {
        }

        default void onPermissionRequest(@NotNull JsonObject request) {
        }

        default void onPermissionCancel(@NotNull String requestId) {
        }

        default void onSideQuestionDone(@NotNull String requestId, @Nullable String response, @Nullable String error) {
        }
    }

    public final class StreamController {
        private StreamController() {
        }

        public @Nullable String sendSideQuestion(@NotNull String question) {
            String requestId = "java-" + System.currentTimeMillis() + "-" + Long.toHexString(Double.doubleToLongBits(Math.random()));
            JsonObject message = new JsonObject();
            message.addProperty("type", "control_request");
            message.addProperty("request_id", requestId);
            JsonObject request = new JsonObject();
            request.addProperty("subtype", "side_question");
            request.addProperty("question", question);
            message.add("request", request);
            return writeControl(message) ? requestId : null;
        }

        public boolean sendPermissionResponse(@NotNull String requestId, @NotNull JsonElement response) {
            JsonObject message = new JsonObject();
            message.addProperty("type", "control_response");
            JsonObject payload = new JsonObject();
            payload.addProperty("subtype", "success");
            payload.addProperty("request_id", requestId);
            payload.add("response", response);
            message.add("response", payload);
            return writeControl(message);
        }
    }

    private record ResolvedCli(String command, List<String> argsPrefix, String label) {
    }

    public @NotNull Result runPrompt(@NotNull Project project, @NotNull String prompt) throws IOException, InterruptedException {
        return runPrompt(project, prompt, null);
    }

    public @NotNull Result runPrompt(
        @NotNull Project project,
        @NotNull String prompt,
        @Nullable Consumer<String> onStdout
    ) throws IOException, InterruptedException {
        ResolvedCli resolved = resolve(project);
        List<String> args = new ArrayList<>();
        args.addAll(resolved.argsPrefix());
        args.addAll(splitArgs(HelionSettings.defaultArgs()));
        addOption(args, "--model", HelionSettings.model());
        addOption(args, "--effort", HelionSettings.effort());
        addOption(args, "--permission-mode", HelionSettings.permissionMode());
        addOption(args, "--thinking", HelionSettings.thinking());
        args.add("-p");
        args.add("--output-format");
        args.add("text");
        args.add(prompt);

        List<String> command = new ArrayList<>();
        command.add(resolved.command());
        command.addAll(args);

        Path cwd = workspacePath(project);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(cwd.toFile());
        Map<String, String> env = builder.environment();
        env.put("CLAUDE_CODE_ENTRYPOINT", "claude-jetbrains");
        env.put("FORCE_COLOR", "0");
        env.put("NO_COLOR", "1");

        Process process = builder.start();
        activeProcess = process;
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        Thread outThread = readAsync(process.inputReader(StandardCharsets.UTF_8), stdout, onStdout);
        Thread errThread = readAsync(process.errorReader(StandardCharsets.UTF_8), stderr);

        boolean completed;
        try {
            completed = process.waitFor(Duration.ofMinutes(30).toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                process.destroyForcibly();
                throw new IOException("HelionCoder 运行超过 30 分钟，已停止。");
            }
        } catch (InterruptedException error) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("HelionCoder 请求已取消。", error);
        } finally {
            activeProcess = null;
        }

        outThread.join(1000);
        errThread.join(1000);

        int code = process.exitValue();
        String commandLine = quoteCommand(command) + "\n工作目录：" + cwd;
        if (code != 0) {
            String details = stderr.toString().trim().isEmpty() ? stdout.toString().trim() : stderr.toString().trim();
            throw new IOException("HelionCoder 运行失败（" + resolved.label() + "）：" + details);
        }

        return new Result(stdout.toString(), stderr.toString(), code, commandLine);
    }

    public @NotNull StreamResult runPromptStream(
        @NotNull Project project,
        @NotNull String prompt,
        @Nullable String sessionId,
        @NotNull StreamCallbacks callbacks
    ) throws IOException, InterruptedException {
        ResolvedCli resolved = resolve(project);
        List<String> args = new ArrayList<>();
        args.addAll(resolved.argsPrefix());
        args.addAll(splitArgs(HelionSettings.defaultArgs()));
        addOption(args, "--model", HelionSettings.model());
        addOption(args, "--effort", HelionSettings.effort());
        addOption(args, "--permission-mode", HelionSettings.permissionMode());
        addOption(args, "--thinking", HelionSettings.thinking());
        args.add("-p");
        args.add("--input-format");
        args.add("stream-json");
        args.add("--output-format");
        args.add("stream-json");
        args.add("--verbose");
        args.add("--include-partial-messages");
        args.add("--permission-prompt-tool");
        args.add("stdio");

        List<String> command = new ArrayList<>();
        command.add(resolved.command());
        command.addAll(args);

        Path cwd = workspacePath(project);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(cwd.toFile());
        Map<String, String> env = builder.environment();
        env.put("CLAUDE_CODE_ENTRYPOINT", "claude-jetbrains");
        env.put("FORCE_COLOR", "0");
        env.put("NO_COLOR", "1");

        Process process = builder.start();
        activeProcess = process;
        activeStdin = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
        callbacks.onController(new StreamController());

        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        StreamState state = new StreamState();

        writeUserPrompt(prompt, sessionId);
        Thread outThread = readStreamJson(process.inputReader(StandardCharsets.UTF_8), stdout, callbacks, state);
        Thread errThread = readAsync(process.errorReader(StandardCharsets.UTF_8), stderr);

        boolean completed;
        try {
            completed = waitForStreamCompletion(process, state);
            if (!completed) {
                process.destroyForcibly();
                throw new IOException("HelionCoder 运行超过 30 分钟，已停止。");
            }
        } catch (InterruptedException error) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("HelionCoder 请求已取消。", error);
        } finally {
            closeActiveStdin();
            activeProcess = null;
            activeStdin = null;
        }

        outThread.join(1000);
        errThread.join(1000);

        int code = process.isAlive() ? 0 : process.exitValue();
        String commandLine = quoteCommand(command) + "\n工作目录：" + cwd;
        if (!state.errorText.isBlank() && stderr.toString().trim().isEmpty()) {
            stderr.append(state.errorText);
        }
        if (code != 0 && (!state.resultReceived || !state.errorText.isBlank())) {
            String details = stderr.toString().trim().isEmpty() ? stdout.toString().trim() : stderr.toString().trim();
            throw new IOException("HelionCoder 运行失败（" + resolved.label() + "）：" + details);
        }

        String finalText = state.finalText.isBlank() ? state.streamText.toString() : state.finalText;
        return new StreamResult(finalText, stderr.toString(), code, commandLine, state.sessionId, state.usage);
    }

    public void cancel() {
        Process process = activeProcess;
        if (process != null && process.isAlive()) {
            process.destroy();
        }
    }

    public @NotNull Result runCommand(
        @NotNull Project project,
        @NotNull List<String> extraArgs,
        @NotNull Duration timeout
    ) throws IOException, InterruptedException {
        ResolvedCli resolved = resolve(project);
        List<String> command = new ArrayList<>();
        command.add(resolved.command());
        command.addAll(resolved.argsPrefix());
        command.addAll(extraArgs);

        Path cwd = workspacePath(project);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(cwd.toFile());
        Map<String, String> env = builder.environment();
        env.put("CLAUDE_CODE_ENTRYPOINT", "claude-jetbrains");
        env.put("FORCE_COLOR", "0");
        env.put("NO_COLOR", "1");

        Process process = builder.start();
        activeProcess = process;
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        Thread outThread = readAsync(process.inputReader(StandardCharsets.UTF_8), stdout);
        Thread errThread = readAsync(process.errorReader(StandardCharsets.UTF_8), stderr);

        boolean completed;
        try {
            completed = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                process.destroyForcibly();
                throw new IOException("HelionCoder 命令运行超时。");
            }
        } catch (InterruptedException error) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("HelionCoder 命令已取消。", error);
        } finally {
            activeProcess = null;
        }

        outThread.join(1000);
        errThread.join(1000);

        int code = process.exitValue();
        String commandLine = quoteCommand(command) + "\n工作目录：" + cwd;
        if (code != 0) {
            String details = stderr.toString().trim().isEmpty() ? stdout.toString().trim() : stderr.toString().trim();
            throw new IOException("HelionCoder 命令运行失败（" + resolved.label() + "）：" + details);
        }
        return new Result(stdout.toString(), stderr.toString(), code, commandLine);
    }

    public @NotNull String terminalCommand(@NotNull Project project, @NotNull List<String> extraArgs) {
        ResolvedCli resolved = resolve(project);
        List<String> command = new ArrayList<>();
        command.add(resolved.command());
        command.addAll(resolved.argsPrefix());
        command.addAll(extraArgs);
        return shellCommand(command);
    }

    private static @NotNull ResolvedCli resolve(@NotNull Project project) {
        String configured = HelionSettings.executablePath();
        if (!configured.isBlank()) {
            return toResolvedCli(project, configured, "已配置的可执行文件");
        }

        String executableName = isWindows() ? "helion-coder.exe" : "helion-coder";
        for (Path root : candidateRoots(project)) {
            Path nativeCandidate = root.resolve("dist").resolve(executableName);
            if (Files.isRegularFile(nativeCandidate)) {
                return toResolvedCli(nativeCandidate.toString(), "项目 dist 可执行文件");
            }

            Path moduleCandidate = root.resolve("dist").resolve("cli.mjs");
            if (Files.isRegularFile(moduleCandidate)) {
                return toResolvedCli(moduleCandidate.toString(), "项目 dist 模块");
            }

            Path packagedNative = root.resolve("bin").resolve(executableName);
            if (Files.isRegularFile(packagedNative)) {
                return toResolvedCli(packagedNative.toString(), "插件 bin 可执行文件");
            }

            Path packagedModule = root.resolve("bin").resolve("cli.mjs");
            if (Files.isRegularFile(packagedModule)) {
                return toResolvedCli(packagedModule.toString(), "插件 bin 模块");
            }
        }

        String fromPath = findOnPath(executableName);
        if (fromPath != null) {
            return toResolvedCli(fromPath, "PATH 中的可执行文件");
        }

        String fromCommonPath = findInCommonLocations(executableName);
        if (fromCommonPath != null) {
            return toResolvedCli(fromCommonPath, "常见安装路径中的可执行文件");
        }

        String fromShell = findWithLoginShell(executableName);
        if (fromShell != null) {
            return toResolvedCli(fromShell, "登录 shell PATH 中的可执行文件");
        }

        if (!isWindows()) {
            return new ResolvedCli(shellPath(), List.of("-lic", "exec helion-coder \"$@\"", "helion-coder"), "登录 shell 中的 helion-coder");
        }

        return new ResolvedCli("helion-coder", List.of(), "PATH 中的 helion-coder");
    }

    private static @NotNull ResolvedCli toResolvedCli(@NotNull String candidate, @NotNull String label) {
        String expanded = expandHome(candidate.trim());
        if (expanded.endsWith(".mjs")) {
            return new ResolvedCli("node", List.of(expanded), label);
        }
        return new ResolvedCli(expanded, List.of(), label);
    }

    private static @NotNull ResolvedCli toResolvedCli(
        @NotNull Project project,
        @NotNull String candidate,
        @NotNull String label
    ) {
        String expanded = expandHome(candidate.trim());
        Path path = Paths.get(expanded);
        if (!path.isAbsolute() && looksLikeRelativePath(expanded)) {
            path = workspacePath(project).resolve(path).normalize();
        }
        return toResolvedCli(path.toString(), label);
    }

    private static boolean looksLikeRelativePath(@NotNull String value) {
        return value.startsWith(".") || value.contains("/") || value.contains("\\");
    }

    private static @NotNull Set<Path> candidateRoots(@NotNull Project project) {
        Set<Path> roots = new LinkedHashSet<>();
        String basePath = project.getBasePath();
        if (basePath != null) {
            Path base = Paths.get(basePath);
            roots.add(base);
            if (base.getParent() != null) {
                roots.add(base.getParent());
            }
        }
        roots.add(Paths.get(PathManager.getPluginsPath(), "HelionCoder"));
        roots.add(Paths.get(PathManager.getPluginsPath(), "helion-coder-jetbrains"));
        return roots;
    }

    private static @NotNull Path workspacePath(@NotNull Project project) {
        String basePath = project.getBasePath();
        return basePath == null ? Paths.get(System.getProperty("user.home")) : Paths.get(basePath);
    }

    private static @Nullable String findOnPath(@NotNull String command) {
        String path = System.getenv("PATH");
        if (path == null || path.isBlank()) {
            return null;
        }
        for (String entry : path.split(File.pathSeparator)) {
            Path candidate = Paths.get(entry).resolve(command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }

    private static @Nullable String findInCommonLocations(@NotNull String command) {
        if (isWindows()) {
            return null;
        }
        for (String directory : List.of("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin")) {
            Path candidate = Paths.get(directory).resolve(command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }

    private static @Nullable String findWithLoginShell(@NotNull String command) {
        if (isWindows()) {
            return null;
        }
        String shell = shellPath();
        List<List<String>> attempts = List.of(
            List.of(shell, "-lc", "command -v " + quoteArg(command)),
            List.of(shell, "-ic", "command -v " + quoteArg(command)),
            List.of(shell, "-lic", "command -v " + quoteArg(command)),
            List.of("/bin/zsh", "-lic", "command -v " + quoteArg(command)),
            List.of("/bin/bash", "-lc", "command -v " + quoteArg(command))
        );
        for (List<String> attempt : attempts) {
            String found = findWithShellAttempt(attempt);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private static @Nullable String findWithShellAttempt(@NotNull List<String> command) {
        try {
            Process process = new ProcessBuilder(command)
                .redirectErrorStream(true)
                .start();
            boolean completed = process.waitFor(5, TimeUnit.SECONDS);
            if (!completed) {
                process.destroyForcibly();
                return null;
            }
            String output = process.inputReader(StandardCharsets.UTF_8).readLine();
            if (process.exitValue() != 0 || output == null || output.isBlank()) {
                return null;
            }
            Path candidate = Paths.get(output.trim());
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        } catch (IOException | InterruptedException error) {
            if (error instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
        }
        return null;
    }

    private static @NotNull String shellPath() {
        String shell = System.getenv("SHELL");
        return shell == null || shell.isBlank() ? "/bin/zsh" : shell;
    }

    private static void addOption(@NotNull List<String> args, @NotNull String name, @NotNull String value) {
        if (!value.isBlank() && !args.contains(name)) {
            args.add(name);
            args.add(value);
        }
    }

    private static @NotNull List<String> splitArgs(@NotNull String value) {
        if (value.isBlank()) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (String part : value.trim().split("\\s+")) {
            if (!part.isBlank()) {
                result.add(part);
            }
        }
        return result;
    }

    private static @NotNull Thread readAsync(@NotNull BufferedReader reader, @NotNull StringBuilder target) {
        return readAsync(reader, target, null);
    }

    private static @NotNull Thread readAsync(
        @NotNull BufferedReader reader,
        @NotNull StringBuilder target,
        @Nullable Consumer<String> onChunk
    ) {
        Thread thread = new Thread(() -> {
            try (reader) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String chunk = stripAnsi(line) + "\n";
                    target.append(chunk);
                    if (onChunk != null) {
                        onChunk.accept(chunk);
                    }
                }
            } catch (IOException ignored) {
            }
        }, "HelionCoder CLI reader");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private @NotNull Thread readStreamJson(
        @NotNull BufferedReader reader,
        @NotNull StringBuilder rawStdout,
        @NotNull StreamCallbacks callbacks,
        @NotNull StreamState state
    ) {
        Thread thread = new Thread(() -> {
            try (reader) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String clean = stripAnsi(line);
                    rawStdout.append(clean).append('\n');
                    parseStreamJsonLine(clean, callbacks, state);
                }
            } catch (IOException ignored) {
            }
        }, "HelionCoder stream-json reader");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private boolean waitForStreamCompletion(@NotNull Process process, @NotNull StreamState state) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(30);
        while (System.nanoTime() < deadline) {
            if (process.waitFor(100, TimeUnit.MILLISECONDS)) {
                return true;
            }
            if (!state.resultReceived) {
                continue;
            }

            closeActiveStdin();
            if (process.waitFor(2, TimeUnit.SECONDS)) {
                return true;
            }
            process.destroy();
            if (process.waitFor(2, TimeUnit.SECONDS)) {
                return true;
            }
            process.destroyForcibly();
            process.waitFor(1, TimeUnit.SECONDS);
            return !process.isAlive();
        }
        return false;
    }

    private void closeActiveStdin() {
        Writer writer = activeStdin;
        if (writer == null) {
            return;
        }
        synchronized (this) {
            try {
                writer.close();
            } catch (IOException ignored) {
            } finally {
                if (activeStdin == writer) {
                    activeStdin = null;
                }
            }
        }
    }

    private void writeUserPrompt(@NotNull String prompt, @Nullable String sessionId) throws IOException {
        JsonObject message = new JsonObject();
        message.addProperty("type", "user");
        message.addProperty("session_id", sessionId == null ? "" : sessionId);
        JsonObject userMessage = new JsonObject();
        userMessage.addProperty("role", "user");
        userMessage.addProperty("content", prompt);
        message.add("message", userMessage);
        message.add("parent_tool_use_id", JsonNull.INSTANCE);
        writeControlOrThrow(message);
    }

    private boolean writeControl(@NotNull JsonObject message) {
        try {
            writeControlOrThrow(message);
            return true;
        } catch (IOException ignored) {
            return false;
        }
    }

    private void writeControlOrThrow(@NotNull JsonObject message) throws IOException {
        Writer writer = activeStdin;
        if (writer == null) {
            throw new IOException("HelionCoder CLI stdin is not available.");
        }
        synchronized (this) {
            writer.write(GSON.toJson(message));
            writer.write('\n');
            writer.flush();
        }
    }

    private static void parseStreamJsonLine(
        @NotNull String line,
        @NotNull StreamCallbacks callbacks,
        @NotNull StreamState state
    ) {
        String trimmed = line.trim();
        if (trimmed.isEmpty()) {
            return;
        }
        JsonObject object;
        try {
            JsonElement element = JsonParser.parseString(trimmed);
            if (!element.isJsonObject()) {
                return;
            }
            object = element.getAsJsonObject();
        } catch (RuntimeException ignored) {
            return;
        }

        String type = string(object, "type");
        if ("stream_event".equals(type)) {
            JsonObject event = objectObject(object, "event");
            JsonObject usage = parseUsage(objectObject(event, "usage"), objectObject(objectObject(event, "message"), "usage"), null);
            if (usage != null) {
                state.usage = usage;
                callbacks.onUsage(usage);
            }
            JsonObject delta = objectObject(event, "delta");
            if ("content_block_start".equals(string(event, "type"))) {
                JsonObject step = toolStepFromToolUseBlock(objectObject(event, "content_block"), "started");
                if (step != null) {
                    callbacks.onToolStep(step);
                }
                return;
            }
            if ("content_block_delta".equals(string(event, "type")) && "text_delta".equals(string(delta, "type"))) {
                String text = coalesce(string(delta, "text"), "");
                state.streamText.append(text);
                callbacks.onText(text);
                return;
            }
            if ("content_block_delta".equals(string(event, "type")) && "thinking_delta".equals(string(delta, "type"))) {
                callbacks.onThinking(coalesce(string(delta, "thinking"), ""));
                return;
            }
            return;
        }

        if ("streamlined_text".equals(type)) {
            String text = coalesce(string(object, "text"), coalesce(string(object, "delta"), ""));
            state.streamText.append(text);
            callbacks.onText(text);
            return;
        }

        if ("assistant".equals(type)) {
            JsonObject message = objectObject(object, "message");
            JsonObject usage = parseUsage(objectObject(message, "usage"), null, null);
            if (usage != null) {
                state.usage = usage;
                callbacks.onUsage(usage);
            }
            JsonArray content = array(message, "content");
            if (content != null) {
                for (JsonElement item : content) {
                    if (!item.isJsonObject()) {
                        continue;
                    }
                    JsonObject block = item.getAsJsonObject();
                    JsonObject step = toolStepFromToolUseBlock(block, "started");
                    if (step != null) {
                        callbacks.onToolStep(step);
                    }
                    if ("thinking".equals(string(block, "type"))) {
                        callbacks.onThinking(coalesce(string(block, "thinking"), ""));
                    }
                }
            }
            return;
        }

        if ("user".equals(type)) {
            JsonObject message = objectObject(object, "message");
            JsonArray content = array(message, "content");
            if (content != null) {
                for (JsonElement item : content) {
                    if (!item.isJsonObject()) {
                        continue;
                    }
                    JsonObject block = item.getAsJsonObject();
                    if (!"tool_result".equals(string(block, "type"))) {
                        continue;
                    }
                    String id = string(block, "tool_use_id");
                    if (id == null) {
                        continue;
                    }
                    JsonObject step = new JsonObject();
                    step.addProperty("id", id);
                    step.addProperty("toolName", "Tool");
                    step.addProperty("status", bool(block, "is_error") ? "failed" : "completed");
                    step.addProperty("label", bool(block, "is_error") ? "执行失败" : "执行完成");
                    String detail = summarizeToolResult(block.get("content"));
                    if (detail != null) {
                        step.addProperty("detail", detail);
                    }
                    callbacks.onToolStep(step);
                }
            }
            return;
        }

        if ("tool_progress".equals(type)) {
            String id = coalesce(string(object, "tool_use_id"), string(object, "toolUseID"));
            if (id == null) {
                return;
            }
            String toolName = coalesce(string(object, "tool_name"), coalesce(string(object, "toolName"), "Tool"));
            JsonObject step = new JsonObject();
            step.addProperty("id", id);
            step.addProperty("toolName", toolName);
            step.addProperty("status", "running");
            step.addProperty("label", toolName);
            Double elapsed = number(object, "elapsed_time_seconds");
            if (elapsed != null) {
                step.addProperty("elapsedSeconds", elapsed);
                step.addProperty("detail", "已运行 " + Math.round(elapsed) + " 秒");
            }
            callbacks.onToolStep(step);
            return;
        }

        if ("streamlined_tool_use_summary".equals(type) || "tool_use_summary".equals(type)) {
            String summary = coalesce(string(object, "tool_summary"), string(object, "summary"));
            if (summary != null) {
                JsonObject step = new JsonObject();
                step.addProperty("id", coalesce(string(object, "uuid"), "summary-" + summary));
                step.addProperty("toolName", "Summary");
                step.addProperty("status", "completed");
                step.addProperty("label", "工具汇总");
                step.addProperty("detail", summary);
                callbacks.onToolStep(step);
            }
            return;
        }

        if ("system".equals(type) && "status".equals(string(object, "subtype")) && "compacting".equals(string(object, "status"))) {
            JsonObject step = new JsonObject();
            step.addProperty("id", coalesce(string(object, "uuid"), "status-compacting"));
            step.addProperty("toolName", "Status");
            step.addProperty("status", "status");
            step.addProperty("label", "压缩上下文");
            step.addProperty("detail", "正在整理上下文窗口后继续");
            callbacks.onToolStep(step);
            return;
        }

        if ("result".equals(type)) {
            state.resultReceived = true;
            state.sessionId = string(object, "session_id");
            JsonObject usage = parseUsage(objectObject(object, "usage"), null, number(object, "total_cost_usd"));
            if (usage != null) {
                state.usage = usage;
                callbacks.onUsage(usage);
            }
            JsonArray errors = array(object, "errors");
            if (errors != null && !errors.isEmpty()) {
                StringBuilder text = new StringBuilder();
                for (JsonElement error : errors) {
                    if (text.length() > 0) {
                        text.append('\n');
                    }
                    text.append(error.isJsonPrimitive() ? error.getAsString() : GSON.toJson(error));
                }
                state.errorText = text.toString();
            }
            if ("success".equals(string(object, "subtype"))) {
                state.finalText = coalesce(string(object, "result"), "");
            }
            return;
        }

        if ("control_response".equals(type)) {
            JsonObject response = objectObject(object, "response");
            String requestId = string(response, "request_id");
            if (requestId == null) {
                return;
            }
            if ("error".equals(string(response, "subtype"))) {
                callbacks.onSideQuestionDone(requestId, null, coalesce(string(response, "error"), "支线问题执行失败。"));
                return;
            }
            JsonObject payload = objectObject(response, "response");
            callbacks.onSideQuestionDone(requestId, string(payload, "response"), null);
            return;
        }

        if ("control_request".equals(type)) {
            String requestId = string(object, "request_id");
            JsonObject request = objectObject(object, "request");
            if (requestId == null || request == null || !"can_use_tool".equals(string(request, "subtype"))) {
                return;
            }
            JsonObject output = new JsonObject();
            output.addProperty("requestId", requestId);
            output.addProperty("toolName", coalesce(string(request, "tool_name"), "Tool"));
            output.add("input", objectObject(request, "input") == null ? new JsonObject() : objectObject(request, "input"));
            output.addProperty("toolUseId", coalesce(string(request, "tool_use_id"), ""));
            addString(output, "description", string(request, "description"));
            addString(output, "blockedPath", string(request, "blocked_path"));
            JsonArray suggestions = array(request, "permission_suggestions");
            if (suggestions != null) {
                output.add("permissionSuggestions", suggestions);
            }
            callbacks.onPermissionRequest(output);
            return;
        }

        if ("control_cancel_request".equals(type)) {
            String requestId = string(object, "request_id");
            if (requestId != null) {
                callbacks.onPermissionCancel(requestId);
            }
        }
    }

    private static @Nullable JsonObject toolStepFromToolUseBlock(@Nullable JsonObject block, @NotNull String status) {
        if (block == null || !"tool_use".equals(string(block, "type"))) {
            return null;
        }
        String id = string(block, "id");
        if (id == null) {
            return null;
        }
        String toolName = coalesce(string(block, "name"), "Tool");
        JsonObject input = objectObject(block, "input");
        JsonObject metadata = toolMetadata(toolName, input == null ? new JsonObject() : input);
        JsonObject step = new JsonObject();
        step.addProperty("id", id);
        step.addProperty("toolName", toolName);
        step.addProperty("status", status);
        step.addProperty("label", coalesce(string(metadata, "label"), toolName));
        addString(step, "detail", string(metadata, "detail"));
        addString(step, "filePath", string(metadata, "filePath"));
        addNumber(step, "lineStart", number(metadata, "lineStart"));
        addNumber(step, "lineEnd", number(metadata, "lineEnd"));
        step.add("input", input == null ? new JsonObject() : input);
        return step;
    }

    private static @NotNull JsonObject toolMetadata(@NotNull String toolName, @NotNull JsonObject input) {
        JsonObject metadata = new JsonObject();
        String filePath = firstString(input, "file_path", "filePath", "path");
        String absoluteFilePath = filePath == null ? null : normalizeToolFilePath(filePath);
        Double offset = firstNumber(input, "offset", "start_line", "startLine");
        Double limit = firstNumber(input, "limit", "line_count", "lineCount");
        Double lineEnd = offset != null && limit != null ? offset + Math.max(0, limit - 1) : null;

        if ("read".equalsIgnoreCase(toolName) && absoluteFilePath != null) {
            metadata.addProperty("label", "Read");
            metadata.addProperty("filePath", absoluteFilePath);
            addNumber(metadata, "lineStart", offset);
            addNumber(metadata, "lineEnd", lineEnd);
            if (offset != null) {
                metadata.addProperty("detail", lineEnd == null ? Math.round(offset) + " 行起" : Math.round(offset) + "~" + Math.round(lineEnd) + " 行");
            }
            return metadata;
        }

        if (toolName.matches("(?i)^(edit|write|multiedit|notebookedit)$") && absoluteFilePath != null) {
            metadata.addProperty("label", toolDisplayName(toolName));
            metadata.addProperty("filePath", absoluteFilePath);
            addNumber(metadata, "lineStart", offset);
            addNumber(metadata, "lineEnd", lineEnd);
            return metadata;
        }

        metadata.addProperty("label", toolDisplayName(toolName));
        String detail = firstString(input, "pattern", "query", "command", "description");
        addString(metadata, "detail", detail == null ? null : truncateMiddle(detail, 96));
        if (absoluteFilePath != null) {
            metadata.addProperty("filePath", absoluteFilePath);
        }
        addNumber(metadata, "lineStart", offset);
        addNumber(metadata, "lineEnd", lineEnd);
        return metadata;
    }

    private static @NotNull String toolDisplayName(@NotNull String toolName) {
        return switch (toolName.toLowerCase(Locale.ROOT)) {
            case "read" -> "Read";
            case "edit" -> "Edit";
            case "multiedit" -> "MultiEdit";
            case "write" -> "Write";
            case "notebookedit" -> "NotebookEdit";
            case "grep", "glob", "search" -> "Search";
            case "bash" -> "Bash";
            case "powershell" -> "PowerShell";
            default -> toolName;
        };
    }

    private static @NotNull String normalizeToolFilePath(@NotNull String filePath) {
        String expanded = expandHome(filePath);
        return Paths.get(expanded).isAbsolute() ? Paths.get(expanded).normalize().toString() : Paths.get(expanded).toAbsolutePath().normalize().toString();
    }

    private static @Nullable JsonObject parseUsage(@Nullable JsonObject primary, @Nullable JsonObject fallback, @Nullable Double totalCostUsd) {
        JsonObject source = primary == null ? fallback : primary;
        if (source == null && totalCostUsd == null) {
            return null;
        }
        JsonObject usage = new JsonObject();
        addNumber(usage, "inputTokens", firstNumber(source, "input_tokens", "inputTokens"));
        addNumber(usage, "outputTokens", firstNumber(source, "output_tokens", "outputTokens"));
        addNumber(usage, "cacheCreationInputTokens", firstNumber(source, "cache_creation_input_tokens", "cacheCreationInputTokens"));
        addNumber(usage, "cacheReadInputTokens", firstNumber(source, "cache_read_input_tokens", "cacheReadInputTokens"));
        addNumber(usage, "totalTokens", firstNumber(source, "total_tokens", "totalTokens"));
        addNumber(usage, "totalCostUsd", totalCostUsd == null ? firstNumber(source, "total_cost_usd", "totalCostUsd") : totalCostUsd);
        return usage;
    }

    private static @Nullable String summarizeToolResult(@Nullable JsonElement content) {
        if (content == null || content.isJsonNull()) {
            return null;
        }
        String text = content.isJsonPrimitive() ? content.getAsString() : GSON.toJson(content);
        for (String line : text.split("\\R")) {
            if (!line.trim().isEmpty()) {
                return truncateMiddle(line.trim(), 120);
            }
        }
        return null;
    }

    private static @NotNull String truncateMiddle(@NotNull String value, int max) {
        if (value.length() <= max) {
            return value;
        }
        int side = Math.max(1, (max - 1) / 2);
        return value.substring(0, side) + "…" + value.substring(value.length() - side);
    }

    private static @Nullable String firstString(@Nullable JsonObject object, String... keys) {
        if (object == null) {
            return null;
        }
        for (String key : keys) {
            String value = string(object, key);
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static @Nullable Double firstNumber(@Nullable JsonObject object, String... keys) {
        if (object == null) {
            return null;
        }
        for (String key : keys) {
            Double value = number(object, key);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static @Nullable JsonObject objectObject(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || !object.get(key).isJsonObject()) {
            return null;
        }
        return object.getAsJsonObject(key);
    }

    private static @Nullable JsonArray array(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || !object.get(key).isJsonArray()) {
            return null;
        }
        return object.getAsJsonArray(key);
    }

    private static @Nullable String string(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull() || !object.get(key).isJsonPrimitive()) {
            return null;
        }
        try {
            return object.get(key).getAsString();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static @Nullable Double number(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull() || !object.get(key).isJsonPrimitive()) {
            return null;
        }
        try {
            return object.get(key).getAsDouble();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static boolean bool(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
            return false;
        }
        try {
            return object.get(key).getAsBoolean();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static void addString(@NotNull JsonObject object, @NotNull String key, @Nullable String value) {
        if (value != null) {
            object.addProperty(key, value);
        }
    }

    private static void addNumber(@NotNull JsonObject object, @NotNull String key, @Nullable Double value) {
        if (value != null) {
            if (Math.rint(value) == value) {
                object.addProperty(key, value.longValue());
            } else {
                object.addProperty(key, value);
            }
        }
    }

    private static <T> @Nullable T coalesce(@Nullable T value, @Nullable T fallback) {
        return value == null ? fallback : value;
    }

    private static final class StreamState {
        private final StringBuilder streamText = new StringBuilder();
        private volatile boolean resultReceived;
        private String finalText = "";
        private String errorText = "";
        private String sessionId;
        private JsonObject usage;
    }

    private static @NotNull String quoteCommand(@NotNull List<String> command) {
        return "$ " + shellCommand(command);
    }

    private static @NotNull String shellCommand(@NotNull List<String> command) {
        return String.join(" ", command.stream().map(HelionCli::quoteArg).toList());
    }

    private static @NotNull String quoteArg(@NotNull String arg) {
        if (arg.matches("[A-Za-z0-9_./:=+-]+")) {
            return arg;
        }
        return "'" + arg.replace("'", "'\\''") + "'";
    }

    private static @NotNull String stripAnsi(@NotNull String value) {
        return value.replaceAll("\\u001B\\[[;\\d]*[ -/]*[@-~]", "");
    }

    private static @NotNull String expandHome(@NotNull String value) {
        if (value.equals("~")) {
            return System.getProperty("user.home");
        }
        if (value.startsWith("~/") || value.startsWith("~\\")) {
            return System.getProperty("user.home") + value.substring(1);
        }
        return value;
    }

    private static boolean isWindows() {
        return System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win");
    }
}
