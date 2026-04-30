package com.helioncoder.jetbrains;

import com.intellij.openapi.compiler.CompileContext;
import com.intellij.openapi.compiler.CompilerMessage;
import com.intellij.openapi.compiler.CompilerMessageCategory;
import org.jetbrains.annotations.NotNull;

public final class CompilerContext {
    private CompilerContext() {
    }

    public static @NotNull String format(@NotNull CompileContext context, boolean aborted, int errors, int warnings) {
        StringBuilder builder = new StringBuilder();
        builder.append("Build aborted: ").append(aborted).append('\n');
        builder.append("Errors: ").append(errors).append('\n');
        builder.append("Warnings: ").append(warnings).append('\n');
        appendMessages(builder, "Error messages", context.getMessages(CompilerMessageCategory.ERROR), 50);
        appendMessages(builder, "Warning messages", context.getMessages(CompilerMessageCategory.WARNING), 20);
        return builder.toString().trim();
    }

    private static void appendMessages(
        @NotNull StringBuilder builder,
        @NotNull String title,
        CompilerMessage @NotNull [] messages,
        int limit
    ) {
        builder.append(title).append(":\n");
        if (messages.length == 0) {
            builder.append("- none\n");
            return;
        }
        int count = Math.min(messages.length, limit);
        for (int i = 0; i < count; i += 1) {
            CompilerMessage message = messages[i];
            String file = message.getVirtualFile() == null ? "unknown file" : message.getVirtualFile().getPath();
            String line = message.getLine() > 0 ? ":" + message.getLine() : "";
            String column = message.getColumn() > 0 ? ":" + message.getColumn() : "";
            builder.append("- ").append(file).append(line).append(column).append(' ')
                .append(message.getMessage()).append('\n');
        }
    }
}

