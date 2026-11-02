package com.openminis.app.ui

import com.openminis.app.ui.chat.visibleLomUserText
import org.junit.Assert.assertEquals
import org.junit.Test

class LomSettingsTextTest {
    @Test fun hidesOnlyTheLeadingPolicyEnvelope() {
        val body = "帮我打开相册\n保留这一行"
        val prefix = "[LOM_SETTINGS_V1]\n【Lom 用户设置】发布前确认\n[/LOM_SETTINGS_V1]\n\n"
        assertEquals(body, visibleLomUserText(prefix + body))
        assertEquals(body, visibleLomUserText(body))
        assertEquals(body + prefix, visibleLomUserText(body + prefix))
    }
}
