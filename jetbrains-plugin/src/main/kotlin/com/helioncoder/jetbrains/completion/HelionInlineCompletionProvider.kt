package com.helioncoder.jetbrains.completion

import com.helioncoder.jetbrains.HelionCli
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderPresentation
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionVariant
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Computable
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.withContext
import javax.swing.JComponent
import javax.swing.JLabel
import java.nio.file.Paths

class HelionInlineCompletionProvider : InlineCompletionProvider {
    private val cli = HelionCli()

    override val id: InlineCompletionProviderID = InlineCompletionProviderID("HelionCoder")

    override val providerPresentation: InlineCompletionProviderPresentation =
        object : InlineCompletionProviderPresentation {
            override fun getTooltip(project: Project?): JComponent {
                return JLabel("HelionCoder 补全")
            }
        }

    override fun isEnabled(event: InlineCompletionEvent): Boolean {
        return event is InlineCompletionEvent.DirectCall ||
            event is InlineCompletionEvent.ManualCall ||
            event is InlineCompletionEvent.DocumentChange
    }

    override fun restartOn(event: InlineCompletionEvent): Boolean = false

    override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSuggestion {
        val project = request.editor.project ?: return emptySuggestion()
        val snapshot = snapshot(project.basePath, request.editor) ?: return emptySuggestion()
        val text = withContext(Dispatchers.IO) {
            try {
                val result = cli.runPrompt(project, completionPrompt(snapshot))
                sanitizeCompletion(result.stdout(), snapshot).orEmpty()
            } catch (_: Throwable) {
                ""
            }
        }
        if (text.isBlank()) {
            return emptySuggestion()
        }
        return singleSuggestion(text)
    }

    private fun snapshot(basePath: String?, editor: Editor): CompletionSnapshot? {
        return ApplicationManager.getApplication().runReadAction(Computable {
            val file = editor.virtualFile ?: return@Computable null
            if (!file.isInLocalFileSystem) {
                return@Computable null
            }
            val document = editor.document
            val value = document.text
            val offset = editor.caretModel.offset.coerceIn(0, value.length)
            val line = document.getLineNumber(offset)
            val character = offset - document.getLineStartOffset(line)
            val currentLine = value.substring(document.getLineStartOffset(line), document.getLineEndOffset(line))
            CompletionSnapshot(
                relativePath(basePath, file),
                file.extension.orEmpty(),
                line + 1,
                character + 1,
                currentLine,
                currentLine.substring(0, character.coerceAtMost(currentLine.length)),
                value.substring(0, offset).takeLast(5000),
                value.substring(offset).take(2000),
            )
        })
    }

    private fun completionPrompt(snapshot: CompletionSnapshot): String {
        return listOf(
            "Task: /complete inline code completion.",
            "You are HelionCoder running as a JetBrains inline completion engine.",
            "Return only the exact code text to insert at <CURSOR>.",
            "Do not include markdown fences, prose, explanations, quotes, or placeholders.",
            "Do not repeat any code that already appears before <CURSOR>.",
            "Do not repeat any code that already appears after <CURSOR>.",
            "Preserve the correct indentation for the inserted text.",
            "If no useful completion is possible, return an empty response.",
            "File: ${snapshot.relativePath}",
            "Language: ${snapshot.language}",
            "Cursor: line ${snapshot.cursorLine}, character ${snapshot.cursorCharacter}",
            "Current line: ${snapshot.currentLine}",
            "Current line before cursor: ${snapshot.linePrefix}",
            "",
            "Nearby code with cursor marker:",
            "```" + snapshot.language,
            snapshot.prefix,
            "<CURSOR>",
            snapshot.suffix,
            "```",
        ).joinToString("\n")
    }

    private fun sanitizeCompletion(value: String, snapshot: CompletionSnapshot): String? {
        var result = value.replace("\r\n", "\n").replace(Regex("^\\uFEFF"), "")
        val fenced = Regex("^\\s*```(?:[\\w-]+)?\\n([\\s\\S]*?)\\n```\\s*$").matchEntire(result)
        if (fenced != null) {
            result = fenced.groupValues[1]
        }
        result = result
            .replace(Regex("^\\s*Here is (the )?(completion|code):\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^\\s*Completion:\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^\\s*Insert:\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^\\s*<CURSOR>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^\\n+"), "")
            .replace(Regex("\\n+$"), "")
        result = removePrefixOverlap(snapshot.prefix, result)
        result = removeSuffixOverlap(result, snapshot.suffix)
        if (Regex("^(no completion|none|n/a)$", RegexOption.IGNORE_CASE).matches(result.trim())) {
            return null
        }
        return result.take(4000).takeIf { it.isNotBlank() }
    }

    private fun removePrefixOverlap(prefix: String, completion: String): String {
        val max = minOf(prefix.length, completion.length, 2000)
        for (length in max downTo 1) {
            if (prefix.endsWith(completion.substring(0, length))) {
                return completion.substring(length)
            }
        }
        return completion
    }

    private fun removeSuffixOverlap(completion: String, suffix: String): String {
        val max = minOf(suffix.length, completion.length, 2000)
        for (length in max downTo 1) {
            if (suffix.startsWith(completion.substring(completion.length - length))) {
                return completion.substring(0, completion.length - length)
            }
        }
        return completion
    }

    private fun singleSuggestion(text: String): InlineCompletionSuggestion {
        val variant = InlineCompletionVariant.build(
            UserDataHolderBase(),
            flowOf(InlineCompletionGrayTextElement(text)),
        )
        return object : InlineCompletionSuggestion {
            override suspend fun getVariants(): List<InlineCompletionVariant> = listOf(variant)
        }
    }

    private fun emptySuggestion(): InlineCompletionSuggestion {
        return object : InlineCompletionSuggestion {
            override suspend fun getVariants(): List<InlineCompletionVariant> = emptyList()
        }
    }

    private fun relativePath(basePath: String?, file: VirtualFile): String {
        if (basePath == null) {
            return file.name
        }
        return try {
            Paths.get(basePath).relativize(Paths.get(file.path)).toString()
        } catch (_: IllegalArgumentException) {
            file.path
        }
    }

    private data class CompletionSnapshot(
        val relativePath: String,
        val language: String,
        val cursorLine: Int,
        val cursorCharacter: Int,
        val currentLine: String,
        val linePrefix: String,
        val prefix: String,
        val suffix: String,
    )
}
