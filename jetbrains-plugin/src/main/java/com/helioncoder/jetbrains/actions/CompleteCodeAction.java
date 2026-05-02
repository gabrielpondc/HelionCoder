package com.helioncoder.jetbrains.actions;

import com.helioncoder.jetbrains.HelionCli;
import com.helioncoder.jetbrains.completion.HelionCompletionEngine;
import com.helioncoder.jetbrains.completion.HelionGhostCompletionService;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

public final class CompleteCodeAction extends AnAction {
    private final HelionCli cli = new HelionCli();

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        if (project == null || editor == null) {
            return;
        }

        HelionGhostCompletionService service = HelionGhostCompletionService.getInstance(project);
        if (service.accept(editor)) {
            notifyUser(project, "HelionCoder 补全已插入。", NotificationType.INFORMATION);
            return;
        }

        HelionCompletionEngine.CompletionSnapshot snapshot = HelionCompletionEngine.snapshot(project, editor);
        if (snapshot == null) {
            Messages.showWarningDialog(project, "请先打开一个本地文件，再运行 HelionCoder 补全。", "HelionCoder");
            return;
        }

        notifyUser(project, "正在请求 HelionCoder 补全...", NotificationType.INFORMATION);
        ProgressManager.getInstance().run(new Task.Backgroundable(project, "HelionCoder 正在补全", false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                indicator.setIndeterminate(true);
                indicator.setText("正在调用 HelionCoder CLI 生成补全…");
                try {
                    String insertText = HelionCompletionEngine.complete(project, editor, cli);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (insertText == null || insertText.isBlank()) {
                            notifyUser(project, "HelionCoder 没有生成补全建议。", NotificationType.INFORMATION);
                            return;
                        }
                        WriteCommandAction.runWriteCommandAction(project, "HelionCoder 补全", null, () ->
                            editor.getDocument().insertString(editor.getCaretModel().getOffset(), insertText)
                        );
                        notifyUser(project, "HelionCoder 补全已插入。", NotificationType.INFORMATION);
                    });
                } catch (Exception error) {
                    ApplicationManager.getApplication().invokeLater(() -> {
                        notifyUser(project, "HelionCoder 补全失败：" + message(error), NotificationType.ERROR);
                        Messages.showErrorDialog(project, message(error), "HelionCoder 补全失败");
                    });
                }
            }
        });
    }

    private static void notifyUser(@NotNull Project project, @NotNull String content, @NotNull NotificationType type) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("HelionCoder")
            .createNotification(content, type)
            .notify(project);
    }

    private static @NotNull String message(@NotNull Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.toString() : message;
    }

}
