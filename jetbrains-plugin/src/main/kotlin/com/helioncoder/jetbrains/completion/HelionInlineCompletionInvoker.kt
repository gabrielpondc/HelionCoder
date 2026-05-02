package com.helioncoder.jetbrains.completion

import com.intellij.codeInsight.inline.completion.InlineCompletion
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.UserDataHolderBase

object HelionInlineCompletionInvoker {
    private val providerId: InlineCompletionProviderID = InlineCompletionProviderID("HelionCoder")

    @JvmStatic
    fun invoke(editor: Editor): Boolean {
        val handler = InlineCompletion.getHandlerOrNull(editor) ?: return false
        handler.invokeEvent(InlineCompletionEvent.ManualCall(editor, providerId, UserDataHolderBase()))
        return true
    }
}
