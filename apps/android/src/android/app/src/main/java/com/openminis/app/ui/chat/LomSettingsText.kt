package com.openminis.app.ui.chat

/** Keep the desktop's per-turn policy in model history, not in the user's visible bubble/title. */
fun visibleLomUserText(text: String): String = text.replaceFirst(
    Regex("^\\[LOM_SETTINGS_V1\\]\\n【Lom 用户设置】[^\\n]*\\n\\[/LOM_SETTINGS_V1\\]\\n\\n"), ""
)
