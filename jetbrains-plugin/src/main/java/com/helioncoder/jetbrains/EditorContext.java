package com.helioncoder.jetbrains;

import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Computable;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

public final class EditorContext {
    private EditorContext() {
    }

    public static @NotNull String buildPrompt(
        @NotNull Project project,
        @Nullable Editor editor,
        @NotNull String userPrompt,
        @NotNull String purpose
    ) {
        return buildPrompt(project, editor, userPrompt, purpose, null);
    }

    public static @NotNull String buildPrompt(
        @NotNull Project project,
        @Nullable Editor editor,
        @NotNull String userPrompt,
        @NotNull String purpose,
        @Nullable String compilerContext
    ) {
        return ApplicationManager.getApplication().runReadAction((Computable<String>) () ->
            buildPromptUnsafe(project, editor, userPrompt, purpose, compilerContext)
        );
    }

    private static @NotNull String buildPromptUnsafe(
        @NotNull Project project,
        @Nullable Editor editor,
        @NotNull String userPrompt,
        @NotNull String purpose,
        @Nullable String compilerContext
    ) {
        Snapshot snapshot = snapshot(project, editor);
        String compilerBlock = compilerContext == null || compilerContext.isBlank()
            ? ""
            : "\nCompiler/build context:\n" + compilerContext + "\n";

        if (snapshot == null) {
            return joinNonBlank(List.of(
                "You are HelionCoder running inside a JetBrains IDE.",
                workspaceEditInstruction(),
                compilerBlock,
                "User request:",
                userPrompt
            ));
        }

        String selectionBlock = snapshot.selection().isBlank()
            ? ""
            : "\nSelected text:\n```" + snapshot.language() + "\n" + snapshot.selection() + "\n```\n";

        return joinNonBlank(List.of(
            "You are HelionCoder running inside a JetBrains IDE. Task purpose: " + purpose + ".",
            workspaceEditInstruction(),
            "Active file: " + snapshot.relativePath(),
            "Language: " + snapshot.language(),
            "Cursor line: " + snapshot.cursorLine(),
            "Current line: " + snapshot.currentLine(),
            selectionBlock,
            "Nearby code before cursor:",
            "```" + snapshot.language(),
            snapshot.prefix(),
            "```",
            "Nearby code after cursor:",
            "```" + snapshot.language(),
            snapshot.suffix(),
            "```",
            compilerBlock,
            "User request:",
            userPrompt
        ));
    }

    public static @Nullable String selectedText(@Nullable Editor editor) {
        return ApplicationManager.getApplication().runReadAction((Computable<String>) () -> {
            if (editor == null) {
                return null;
            }
            String selected = editor.getSelectionModel().getSelectedText();
            return selected == null || selected.isBlank() ? null : selected;
        });
    }

    private static @Nullable Snapshot snapshot(@NotNull Project project, @Nullable Editor editor) {
        if (editor == null) {
            return null;
        }
        VirtualFile file = editor.getVirtualFile();
        if (file == null || !file.isInLocalFileSystem()) {
            return null;
        }

        Document document = editor.getDocument();
        String text = document.getText();
        int offset = Math.max(0, Math.min(editor.getCaretModel().getOffset(), text.length()));
        int line = document.getLineNumber(offset);
        String currentLine = text.substring(document.getLineStartOffset(line), document.getLineEndOffset(line));
        String selection = editor.getSelectionModel().getSelectedText();

        return new Snapshot(
            relativePath(project, file),
            file.getExtension() == null ? "" : file.getExtension(),
            selection == null ? "" : selection,
            line + 1,
            currentLine,
            trimStart(text.substring(0, offset), 6000),
            trimEnd(text.substring(offset), 2500)
        );
    }

    private static @NotNull String workspaceEditInstruction() {
        return "When the user asks you to implement, modify, fix, refactor, document, configure, or otherwise change code, edit the actual workspace files directly. After editing files, summarize what changed and how to verify it.";
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

    private static @NotNull String joinNonBlank(@NotNull List<String> parts) {
        List<String> kept = new ArrayList<>();
        for (String part : parts) {
            if (part != null && !part.isBlank()) {
                kept.add(part);
            }
        }
        return String.join("\n", kept);
    }

    private record Snapshot(
        String relativePath,
        String language,
        String selection,
        int cursorLine,
        String currentLine,
        String prefix,
        String suffix
    ) {
    }
}
