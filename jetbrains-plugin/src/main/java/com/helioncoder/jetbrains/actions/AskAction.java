package com.helioncoder.jetbrains.actions;

import com.helioncoder.jetbrains.EditorContext;
import com.helioncoder.jetbrains.HelionCli;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

public final class AskAction extends AnAction {
    private final HelionCli cli = new HelionCli();

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) {
            return;
        }

        String prompt = Messages.showInputDialog(project, "向本地 HelionCoder CLI 发送提示词。", "询问 HelionCoder", null);
        if (prompt == null || prompt.trim().isEmpty()) {
            return;
        }

        Editor editor = event.getData(CommonDataKeys.EDITOR);
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                String finalPrompt = EditorContext.buildPrompt(project, editor, prompt.trim(), "命令提问");
                HelionCli.Result result = cli.runPrompt(project, finalPrompt);
                ApplicationManager.getApplication().invokeLater(() ->
                    Messages.showInfoMessage(project, result.stdout().trim(), "HelionCoder 回复"));
            } catch (Exception error) {
                ApplicationManager.getApplication().invokeLater(() ->
                    Messages.showErrorDialog(project, error.getMessage() == null ? error.toString() : error.getMessage(), "HelionCoder"));
            }
        });
    }
}

