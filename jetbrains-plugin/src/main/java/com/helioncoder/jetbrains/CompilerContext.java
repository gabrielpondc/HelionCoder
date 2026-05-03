package com.helioncoder.jetbrains;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.Method;

public final class CompilerContext {
    private CompilerContext() {
    }

    public static @NotNull String format(@Nullable Object context, boolean aborted, int errors, int warnings) {
        StringBuilder builder = new StringBuilder();
        builder.append("Build aborted: ").append(aborted).append('\n');
        builder.append("Errors: ").append(errors).append('\n');
        builder.append("Warnings: ").append(warnings).append('\n');
        appendMessages(builder, "Error messages", context, "ERROR", 50);
        appendMessages(builder, "Warning messages", context, "WARNING", 20);
        return builder.toString().trim();
    }

    private static void appendMessages(
        @NotNull StringBuilder builder,
        @NotNull String title,
        @Nullable Object context,
        @NotNull String categoryName,
        int limit
    ) {
        builder.append(title).append(":\n");
        Object[] messages = getMessages(context, categoryName);
        if (messages.length == 0) {
            builder.append("- none\n");
            return;
        }
        int count = Math.min(messages.length, limit);
        for (int i = 0; i < count; i += 1) {
            Object message = messages[i];
            String file = getVirtualFilePath(message);
            builder.append("- ").append(file).append(' ')
                .append(getCompilerMessageText(message)).append('\n');
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static Object @NotNull [] getMessages(@Nullable Object context, @NotNull String categoryName) {
        if (context == null) {
            return new Object[0];
        }
        try {
            ClassLoader loader = context.getClass().getClassLoader();
            Class<?> categoryClass = Class.forName("com.intellij.openapi.compiler.CompilerMessageCategory", false, loader);
            Object category = Enum.valueOf(categoryClass.asSubclass(Enum.class), categoryName);
            Method getMessages = context.getClass().getMethod("getMessages", categoryClass);
            Object result = getMessages.invoke(context, category);
            return result instanceof Object[] ? (Object[]) result : new Object[0];
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return new Object[0];
        }
    }

    private static @NotNull String getCompilerMessageText(@NotNull Object message) {
        try {
            Method getMessage = message.getClass().getMethod("getMessage");
            Object text = getMessage.invoke(message);
            return text == null ? "" : text.toString();
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return "";
        }
    }

    private static @NotNull String getVirtualFilePath(@NotNull Object message) {
        try {
            Method getVirtualFile = message.getClass().getMethod("getVirtualFile");
            Object virtualFile = getVirtualFile.invoke(message);
            if (virtualFile == null) {
                return "unknown file";
            }
            Method getPath = virtualFile.getClass().getMethod("getPath");
            Object path = getPath.invoke(virtualFile);
            return path == null ? "unknown file" : path.toString();
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return "unknown file";
        }
    }
}
