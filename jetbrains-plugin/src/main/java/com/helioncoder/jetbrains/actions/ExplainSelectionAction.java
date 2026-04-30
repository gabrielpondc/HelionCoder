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

public final class ExplainSelectionAction extends AnAction {
    private final HelionCli cli = new HelionCli();

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        if (project == null || editor == null) {
            return;
        }

        if (EditorContext.selectedText(editor) == null) {
            Messages.showWarningDialog(project, "请先选择代码，再运行“解释选区”。", "HelionCoder");
            return;
        }

        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                String finalPrompt = EditorContext.buildPrompt(
                    project,
                    editor,
                    "解释选中的代码。请包含行为、重要依赖和潜在风险。",
                    "解释选区"
                );
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

