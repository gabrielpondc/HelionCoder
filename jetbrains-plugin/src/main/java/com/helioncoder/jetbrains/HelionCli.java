package com.helioncoder.jetbrains;

import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
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

public final class HelionCli {
    public record Result(String stdout, String stderr, int code, String commandLine) {
    }

    private record ResolvedCli(String command, List<String> argsPrefix, String label) {
    }

    public @NotNull Result runPrompt(@NotNull Project project, @NotNull String prompt) throws IOException, InterruptedException {
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
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        Thread outThread = readAsync(process.inputReader(StandardCharsets.UTF_8), stdout);
        Thread errThread = readAsync(process.errorReader(StandardCharsets.UTF_8), stderr);

        boolean completed = process.waitFor(Duration.ofMinutes(30).toMillis(), TimeUnit.MILLISECONDS);
        if (!completed) {
            process.destroyForcibly();
            throw new IOException("HelionCoder 运行超过 30 分钟，已停止。");
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

    private static @NotNull ResolvedCli resolve(@NotNull Project project) {
        String configured = HelionSettings.executablePath();
        if (!configured.isBlank()) {
            return toResolvedCli(configured, "已配置的可执行文件");
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

        return new ResolvedCli("helion-coder", List.of(), "PATH 中的 helion-coder");
    }

    private static @NotNull ResolvedCli toResolvedCli(@NotNull String candidate, @NotNull String label) {
        String expanded = expandHome(candidate.trim());
        if (expanded.endsWith(".mjs")) {
            return new ResolvedCli("node", List.of(expanded), label);
        }
        return new ResolvedCli(expanded, List.of(), label);
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
        Thread thread = new Thread(() -> {
            try (reader) {
                String line;
                while ((line = reader.readLine()) != null) {
                    target.append(stripAnsi(line)).append('\n');
                }
            } catch (IOException ignored) {
            }
        }, "HelionCoder CLI reader");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private static @NotNull String quoteCommand(@NotNull List<String> command) {
        return "$ " + String.join(" ", command.stream().map(HelionCli::quoteArg).toList());
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

