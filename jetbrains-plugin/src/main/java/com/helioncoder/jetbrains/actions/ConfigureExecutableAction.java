package com.helioncoder.jetbrains.actions;

import com.helioncoder.jetbrains.HelionSettings;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

public final class ConfigureExecutableAction extends AnAction {
    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        String value = Messages.showInputDialog(
            project,
            "dist/helion-coder 或 dist/cli.mjs 的绝对路径。留空自动检测。",
            "HelionCoder CLI 可执行文件",
            null,
            HelionSettings.executablePath(),
            null
        );
        if (value == null) {
            return;
        }
        HelionSettings.setExecutablePath(value);
        Messages.showInfoMessage(project, "HelionCoder 可执行文件设置已更新。", "HelionCoder");
    }
}

