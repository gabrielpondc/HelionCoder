package com.helioncoder.jetbrains.completion;

import com.helioncoder.jetbrains.HelionCli;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Computable;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.nio.file.Path;
import java.nio.file.Paths;

public final class HelionCompletionEngine {
    private HelionCompletionEngine() {
    }

    public static @Nullable String complete(
        @NotNull Project project,
        @NotNull Editor editor,
        @NotNull HelionCli cli
    ) throws Exception {
        CompletionSnapshot snapshot = snapshot(project, editor);
        if (snapshot == null) {
            return null;
        }
        HelionCli.Result result = cli.runPrompt(project, completionPrompt(snapshot));
        return sanitizeCompletion(result.stdout(), snapshot);
    }

    public static @Nullable CompletionSnapshot snapshot(@NotNull Project project, @NotNull Editor editor) {
        return ApplicationManager.getApplication().runReadAction((Computable<CompletionSnapshot>) () -> {
            VirtualFile file = editor.getVirtualFile();
            if (file == null || !file.isInLocalFileSystem()) {
                return null;
            }
            Document document = editor.getDocument();
            String text = document.getText();
            int offset = Math.max(0, Math.min(editor.getCaretModel().getOffset(), text.length()));
            int line = document.getLineNumber(offset);
            int character = offset - document.getLineStartOffset(line);
            String currentLine = text.substring(document.getLineStartOffset(line), document.getLineEndOffset(line));
            String linePrefix = currentLine.substring(0, Math.min(character, currentLine.length()));
            return new CompletionSnapshot(
                relativePath(project, file),
                file.getExtension() == null ? "" : file.getExtension(),
                line + 1,
                character + 1,
                currentLine,
                linePrefix,
                trimStart(text.substring(0, offset), 5000),
                trimEnd(text.substring(offset), 2000)
            );
        });
    }

    public static @NotNull String completionPrompt(@NotNull CompletionSnapshot snapshot) {
        return String.join("\n",
            "Task: /complete inline code completion.",
            "You are HelionCoder running as a JetBrains editor completion engine.",
            "Return only the exact code text to insert at <CURSOR>.",
            "Do not include markdown fences, prose, explanations, quotes, or placeholders.",
            "Do not repeat any code that already appears before <CURSOR>.",
            "Do not repeat any code that already appears after <CURSOR>.",
            "Preserve the correct indentation for the inserted text.",
            "If no useful completion is possible, return an empty response.",
            "File: " + snapshot.relativePath(),
            "Language: " + snapshot.language(),
            "Cursor: line " + snapshot.cursorLine() + ", character " + snapshot.cursorCharacter(),
            "Current line: " + snapshot.currentLine(),
            "Current line before cursor: " + snapshot.linePrefix(),
            "",
            "Nearby code with cursor marker:",
            "```" + snapshot.language(),
            snapshot.prefix(),
            "<CURSOR>",
            snapshot.suffix(),
            "```"
        );
    }

    public static @Nullable String sanitizeCompletion(@NotNull String value, @NotNull CompletionSnapshot snapshot) {
        String result = value.replace("\r\n", "\n").replaceFirst("^\\uFEFF", "");
        java.util.regex.Matcher fenced = java.util.regex.Pattern
            .compile("^\\s*```(?:[\\w-]+)?\\n([\\s\\S]*?)\\n```\\s*$")
            .matcher(result);
        if (fenced.matches()) {
            result = fenced.group(1);
        }
        result = result
            .replaceFirst("(?i)^\\s*Here is (the )?(completion|code):\\s*", "")
            .replaceFirst("(?i)^\\s*Completion:\\s*", "")
            .replaceFirst("(?i)^\\s*Insert:\\s*", "")
            .replaceFirst("(?i)^\\s*<CURSOR>", "")
            .replaceAll("^\\n+", "")
            .replaceAll("\\n+$", "");
        result = removePrefixOverlap(snapshot.prefix(), result);
        result = removeSuffixOverlap(result, snapshot.suffix());
        if (result.trim().matches("(?i)^(no completion|none|n/a)$")) {
            return null;
        }
        return result.isBlank() ? null : result.substring(0, Math.min(result.length(), 4000));
    }

    private static @NotNull String removePrefixOverlap(@NotNull String prefix, @NotNull String completion) {
        int max = Math.min(Math.min(prefix.length(), completion.length()), 2000);
        for (int length = max; length > 0; length -= 1) {
            if (prefix.endsWith(completion.substring(0, length))) {
                return completion.substring(length);
            }
        }
        return completion;
    }

    private static @NotNull String removeSuffixOverlap(@NotNull String completion, @NotNull String suffix) {
        int max = Math.min(Math.min(suffix.length(), completion.length()), 2000);
        for (int length = max; length > 0; length -= 1) {
            if (suffix.startsWith(completion.substring(completion.length() - length))) {
                return completion.substring(0, completion.length() - length);
            }
        }
        return completion;
    }

    private static @NotNull String relativePath(@NotNull Project project, @NotNull VirtualFile file) {
        String basePath = project.getBasePath();
        if (basePath == null) {
            return file.getName();
        }
        try {
            Path base = Paths.get(basePath);
            Path path = Paths.get(file.getPath());
            return base.relativize(path).toString();
        } catch (IllegalArgumentException ignored) {
            return file.getPath();
        }
    }

    private static @NotNull String trimStart(@NotNull String value, int maxChars) {
        return value.length() <= maxChars ? value : value.substring(value.length() - maxChars);
    }

    private static @NotNull String trimEnd(@NotNull String value, int maxChars) {
        return value.length() <= maxChars ? value : value.substring(0, maxChars);
    }

    public record CompletionSnapshot(
        String relativePath,
        String language,
        int cursorLine,
        int cursorCharacter,
        String currentLine,
        String linePrefix,
        String prefix,
        String suffix
    ) {
    }
}
