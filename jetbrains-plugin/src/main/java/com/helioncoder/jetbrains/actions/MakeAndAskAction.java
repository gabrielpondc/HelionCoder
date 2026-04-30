package com.helioncoder.jetbrains.actions;

import com.helioncoder.jetbrains.CompilerContext;
import com.helioncoder.jetbrains.EditorContext;
import com.helioncoder.jetbrains.HelionCli;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.compiler.CompilerManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

public final class MakeAndAskAction extends AnAction {
    private final HelionCli cli = new HelionCli();

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) {
            return;
        }
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        String userPrompt = Messages.showInputDialog(
            project,
            "会先触发一次项目编译，再把错误/警告和当前编辑器上下文发送给 HelionCoder。",
            "编译项目并询问 HelionCoder",
            null,
            "根据编译错误定位原因并修复相关代码。",
            null
        );
        if (userPrompt == null || userPrompt.trim().isEmpty()) {
            return;
        }

        CompilerManager.getInstance(project).make((aborted, errors, warnings, compileContext) -> {
            String compilerContext = CompilerContext.format(compileContext, aborted, errors, warnings);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    String finalPrompt = EditorContext.buildPrompt(
                        project,
                        editor,
                        userPrompt.trim(),
                        "编译项目并根据编译器结果处理问题",
                        compilerContext
                    );
                    HelionCli.Result result = cli.runPrompt(project, finalPrompt);
                    ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showInfoMessage(project, result.stdout().trim(), "HelionCoder 回复"));
                } catch (Exception error) {
                    ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showErrorDialog(project, error.getMessage() == null ? error.toString() : error.getMessage(), "HelionCoder"));
                }
            });
        });
    }
}

