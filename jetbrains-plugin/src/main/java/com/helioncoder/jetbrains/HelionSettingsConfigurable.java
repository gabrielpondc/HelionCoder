package com.helioncoder.jetbrains;

import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.ui.ComboBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.FormBuilder;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.JPanel;

public final class HelionSettingsConfigurable implements Configurable {
    private JBTextField executablePath;
    private JBTextField defaultArgs;
    private JBTextField model;
    private ComboBox<String> effort;
    private ComboBox<String> permissionMode;
    private ComboBox<String> thinking;

    @Override
    public @Nls(capitalization = Nls.Capitalization.Title) String getDisplayName() {
        return "HelionCoder";
    }

    @Override
    public @Nullable JComponent createComponent() {
        executablePath = new JBTextField();
        defaultArgs = new JBTextField();
        model = new JBTextField();
        effort = new ComboBox<>(new String[]{"", "low", "medium", "high", "max"});
        permissionMode = new ComboBox<>(new String[]{"default", "acceptEdits", "bypassPermissions", "dontAsk", "plan"});
        thinking = new ComboBox<>(new String[]{"", "enabled", "adaptive", "disabled"});

        JPanel panel = FormBuilder.createFormBuilder()
            .addLabeledComponent(new JBLabel("CLI 可执行文件"), executablePath)
            .addLabeledComponent(new JBLabel("默认参数"), defaultArgs)
            .addLabeledComponent(new JBLabel("模型"), model)
            .addLabeledComponent(new JBLabel("推理强度"), effort)
            .addLabeledComponent(new JBLabel("权限模式"), permissionMode)
            .addLabeledComponent(new JBLabel("思考模式"), thinking)
            .addComponentFillVertically(new JPanel(), 0)
            .getPanel();
        reset();
        return panel;
    }

    @Override
    public boolean isModified() {
        return !text(executablePath).equals(HelionSettings.executablePath())
            || !text(defaultArgs).equals(HelionSettings.defaultArgs())
            || !text(model).equals(HelionSettings.model())
            || !selected(effort).equals(HelionSettings.effort())
            || !selected(permissionMode).equals(HelionSettings.permissionMode())
            || !selected(thinking).equals(HelionSettings.thinking());
    }

    @Override
    public void apply() {
        HelionSettings.setExecutablePath(text(executablePath));
        HelionSettings.setDefaultArgs(text(defaultArgs));
        HelionSettings.setModel(text(model));
        HelionSettings.setEffort(selected(effort));
        HelionSettings.setPermissionMode(selected(permissionMode));
        HelionSettings.setThinking(selected(thinking));
    }

    @Override
    public void reset() {
        executablePath.setText(HelionSettings.executablePath());
        defaultArgs.setText(HelionSettings.defaultArgs());
        model.setText(HelionSettings.model());
        effort.setSelectedItem(HelionSettings.effort());
        permissionMode.setSelectedItem(HelionSettings.permissionMode());
        thinking.setSelectedItem(HelionSettings.thinking());
    }

    private static String text(JBTextField field) {
        return field.getText().trim();
    }

    private static String selected(ComboBox<String> comboBox) {
        Object value = comboBox.getSelectedItem();
        return value == null ? "" : value.toString();
    }
}

