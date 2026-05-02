package com.helioncoder.jetbrains;

import com.intellij.ide.util.PropertiesComponent;
import org.jetbrains.annotations.NotNull;

public final class HelionSettings {
    private static final String PREFIX = "helionCoder.";
    private static final String DEFAULT_ARGS = "--bare";
    private static final String DEFAULT_PERMISSION_MODE = "default";

    private HelionSettings() {
    }

    public static @NotNull String executablePath() {
        return get("executablePath", "");
    }

    public static void setExecutablePath(@NotNull String value) {
        set("executablePath", value.trim());
    }

    public static @NotNull String defaultArgs() {
        return get("defaultArgs", DEFAULT_ARGS);
    }

    public static void setDefaultArgs(@NotNull String value) {
        set("defaultArgs", value.trim().isEmpty() ? DEFAULT_ARGS : value.trim());
    }

    public static @NotNull String model() {
        return get("model", "");
    }

    public static void setModel(@NotNull String value) {
        set("model", value.trim());
    }

    public static @NotNull String effort() {
        return get("effort", "");
    }

    public static void setEffort(@NotNull String value) {
        set("effort", value.trim());
    }

    public static @NotNull String permissionMode() {
        return get("permissionMode", DEFAULT_PERMISSION_MODE);
    }

    public static void setPermissionMode(@NotNull String value) {
        set("permissionMode", value.trim().isEmpty() ? DEFAULT_PERMISSION_MODE : value.trim());
    }

    public static @NotNull String thinking() {
        return get("thinking", "");
    }

    public static void setThinking(@NotNull String value) {
        set("thinking", value.trim());
    }

    public static boolean includeEditorContext() {
        return Boolean.parseBoolean(get("includeEditorContext", "true"));
    }

    public static void setIncludeEditorContext(boolean value) {
        set("includeEditorContext", Boolean.toString(value));
    }

    private static @NotNull String get(@NotNull String key, @NotNull String defaultValue) {
        return PropertiesComponent.getInstance().getValue(PREFIX + key, defaultValue);
    }

    private static void set(@NotNull String key, @NotNull String value) {
        PropertiesComponent.getInstance().setValue(PREFIX + key, value);
    }
}
