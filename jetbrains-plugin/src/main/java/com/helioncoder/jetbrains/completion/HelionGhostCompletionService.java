package com.helioncoder.jetbrains.completion;

import com.helioncoder.jetbrains.HelionCli;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.openapi.actionSystem.IdeActions;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.EditorCustomElementRenderer;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.Inlay;
import com.intellij.openapi.editor.actionSystem.EditorActionHandler;
import com.intellij.openapi.editor.actionSystem.EditorActionManager;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.editor.event.EditorFactoryEvent;
import com.intellij.openapi.editor.event.EditorFactoryListener;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.JBColor;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.geom.Rectangle2D;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;

public final class HelionGhostCompletionService implements Disposable {
    private static final Map<Project, HelionGhostCompletionService> SERVICES = new ConcurrentHashMap<>();
    private static final long DELAY_MS = 900;
    private static volatile boolean tabHandlerInstalled;

    private final Project project;
    private final HelionCli cli = new HelionCli();
    private final Map<Editor, State> states = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();

    private HelionGhostCompletionService(@NotNull Project project) {
        this.project = project;
    }

    public static @NotNull HelionGhostCompletionService getInstance(@NotNull Project project) {
        return SERVICES.computeIfAbsent(project, HelionGhostCompletionService::new);
    }

    public void install() {
        installTabHandler();
        EditorFactory factory = EditorFactory.getInstance();
        for (Editor editor : factory.getAllEditors()) {
            attach(editor);
        }
        factory.addEditorFactoryListener(new EditorFactoryListener() {
            @Override
            public void editorCreated(@NotNull EditorFactoryEvent event) {
                attach(event.getEditor());
            }

            @Override
            public void editorReleased(@NotNull EditorFactoryEvent event) {
                clear(event.getEditor());
                states.remove(event.getEditor());
            }
        }, project);
        Disposer.register(project, this);
    }

    public boolean accept(@NotNull Editor editor) {
        State state = states.get(editor);
        if (state == null || state.text == null || state.text.isBlank()) {
            return false;
        }
        String text = state.text;
        clear(editor);
        WriteCommandAction.runWriteCommandAction(project, "接受 HelionCoder 补全", null, () ->
            editor.getDocument().insertString(editor.getCaretModel().getOffset(), text)
        );
        return true;
    }

    public boolean hasSuggestion(@NotNull Editor editor) {
        State state = states.get(editor);
        return state != null && state.text != null && !state.text.isBlank();
    }

    public void request(@NotNull Editor editor) {
        State state = states.computeIfAbsent(editor, ignored -> new State());
        long requestId = sequence.incrementAndGet();
        state.requestId = requestId;
        clear(editor);
        state.task = ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                Thread.sleep(DELAY_MS);
                if (state.requestId != requestId || project.isDisposed() || editor.isDisposed()) {
                    return;
                }
                int offset = ApplicationManager.getApplication().runReadAction(
                    (com.intellij.openapi.util.Computable<Integer>) () -> editor.getCaretModel().getOffset()
                );
                String text = HelionCompletionEngine.complete(project, editor, cli);
                if (text == null || text.isBlank() || state.requestId != requestId) {
                    return;
                }
                ApplicationManager.getApplication().invokeLater(() -> show(editor, state, requestId, offset, text));
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            } catch (Throwable ignored) {
            }
        });
    }

    private void attach(@NotNull Editor editor) {
        if (editor.getProject() != project || states.containsKey(editor)) {
            return;
        }
        State state = new State();
        states.put(editor, state);
        editor.getDocument().addDocumentListener(new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent event) {
                request(editor);
            }
        }, project);
    }

    private void show(@NotNull Editor editor, @NotNull State state, long requestId, int offset, @NotNull String text) {
        if (state.requestId != requestId || project.isDisposed() || editor.isDisposed()) {
            return;
        }
        int currentOffset = editor.getCaretModel().getOffset();
        if (currentOffset != offset || offset > editor.getDocument().getTextLength()) {
            return;
        }
        clear(editor);
        state.text = text;
        state.inlay = editor.getInlayModel().addInlineElement(
            offset,
            true,
            new GhostRenderer("  " + singleLinePreview(text))
        );
    }

    private void clear(@NotNull Editor editor) {
        State state = states.get(editor);
        if (state == null) {
            return;
        }
        state.text = null;
        Inlay<?> inlay = state.inlay;
        state.inlay = null;
        if (inlay != null && inlay.isValid()) {
            Disposer.dispose(inlay);
        }
    }

    private static synchronized void installTabHandler() {
        if (tabHandlerInstalled) {
            return;
        }
        EditorActionManager actionManager = EditorActionManager.getInstance();
        EditorActionHandler original = actionManager.getActionHandler(IdeActions.ACTION_EDITOR_TAB);
        actionManager.setActionHandler(IdeActions.ACTION_EDITOR_TAB, new EditorActionHandler() {
            @Override
            public void execute(@NotNull Editor editor, @NotNull DataContext dataContext) {
                Project project = editor.getProject();
                HelionGhostCompletionService service = project == null ? null : SERVICES.get(project);
                if (service != null && service.hasSuggestion(editor) && service.accept(editor)) {
                    return;
                }
                original.execute(editor, dataContext);
            }
        });
        tabHandlerInstalled = true;
    }

    private static @NotNull String singleLinePreview(@NotNull String text) {
        String normalized = text.replace("\r\n", "\n").replace('\r', '\n');
        int newline = normalized.indexOf('\n');
        String firstLine = newline >= 0 ? normalized.substring(0, newline) : normalized;
        if (newline >= 0) {
            firstLine += " ...";
        }
        return firstLine.length() <= 160 ? firstLine : firstLine.substring(0, 160) + "...";
    }

    @Override
    public void dispose() {
        for (Editor editor : states.keySet()) {
            clear(editor);
        }
        states.clear();
        SERVICES.remove(project);
    }

    private static final class State {
        private volatile long requestId;
        private volatile Future<?> task;
        private volatile @Nullable String text;
        private volatile @Nullable Inlay<?> inlay;
    }

    private static final class GhostRenderer implements EditorCustomElementRenderer {
        private final String text;

        private GhostRenderer(@NotNull String text) {
            this.text = text;
        }

        @Override
        public int calcWidthInPixels(@NotNull Inlay inlay) {
            FontMetrics metrics = inlay.getEditor().getContentComponent().getFontMetrics(inlay.getEditor().getContentComponent().getFont());
            return metrics.stringWidth(text);
        }

        @Override
        public void paint(
            @NotNull Inlay inlay,
            @NotNull Graphics2D graphics,
            @NotNull Rectangle2D targetRegion,
            @NotNull TextAttributes textAttributes
        ) {
            graphics.setFont(inlay.getEditor().getContentComponent().getFont());
            graphics.setColor(JBColor.GRAY);
            FontMetrics metrics = graphics.getFontMetrics();
            float y = (float) (targetRegion.getY() + metrics.getAscent());
            graphics.drawString(text, (float) targetRegion.getX(), y);
        }
    }
}
