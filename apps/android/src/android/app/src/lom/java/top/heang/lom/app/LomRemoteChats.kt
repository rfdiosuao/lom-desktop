package top.heang.lom.app

import android.content.Context
import com.openminis.app.MinisApp
import com.openminis.app.debug.HeadlessChatRunner
import com.openminis.app.ui.chat.ChatMessage
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

internal fun remoteStoredText(parts: JSONArray): String = (0 until parts.length()).mapNotNull { i ->
    parts.optJSONObject(i)?.takeIf { it.optString("type") == "text" }?.let { p ->
        p.optString("text").ifBlank { p.optString("value") }.takeIf { it.isNotBlank() }
    }
}.joinToString("\n")

/** Uses the same phone ViewModel/session DB as the native chat UI. */
internal class LomRemoteChats(private val app: MinisApp, private val files: LomRemoteFiles = LomRemoteFiles(app)) {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val gate=Mutex()
    private val prefs=app.getSharedPreferences("lom_remote_chats",Context.MODE_PRIVATE)
    private val busy=java.util.concurrent.ConcurrentHashMap<String,String>()
    private val jobs=java.util.concurrent.ConcurrentHashMap<String,Job>()
    private val cancelled=java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    init {
        // A process restart is not permission to repeat a task with external side effects.
        val edit=prefs.edit()
        prefs.all.forEach { (key,value) ->
            val old=runCatching { JSONObject(value as String) }.getOrNull()
            if(old?.optString("status") in listOf("accepted","running")) {
                old!!.put("status","interrupted"); edit.putString(key,old.toString())
                busy[old.getString("session_id")]="interrupted"
            }
        }
        edit.commit()
    }
    suspend fun send(p:JSONObject, desktop:String):JSONObject = gate.withLock {
        val client=p.getString("client_id")
        require(Regex("[a-zA-Z0-9-]{16,64}").matches(client)) { "chat.invalid_id" }
        val fileIds=p.optString("files", "[]")
        val attachments=files.attachments(fileIds,desktop)
        val text=p.getString("text").trim().ifBlank { if(attachments.isNotEmpty()) "请查看附件。" else "" }
        require(text.isNotEmpty() && text.toByteArray().size<=60000) { "chat.invalid_text" }
        val receipt=digest(desktop+client)
        val fingerprint=digest(JSONObject().put("session_id",p.optString("session_id")).put("text",text).put("files",fileIds).toString())
        prefs.getString(receipt,null)?.let { saved ->
            val old=JSONObject(saved)
            check(old.getString("fingerprint")==fingerprint) { "chat.id_reused" }
            return@withLock old
        }
        app.providerRepository.awaitConfigLoaded()
        val entry=app.providerRepository.config.value.modelEntries.firstOrNull {
            it.providerInstanceId == "lom-"+digest(desktop).take(24)
        } ?: error("chat.model_missing")
        val requested=p.optString("session_id")
        val session=if(requested.isBlank()) HeadlessChatRunner.ensureSession(app) else requested
        check(app.chatRepository.dao.getSession(session)!=null) { "chat.session_missing" }
        val running=withContext(Dispatchers.Main) { HeadlessChatRunner.existingViewModel(session)?.isStreaming?.value == true }
        check(busy[session] !in listOf("accepted","running") && !running) { "chat.busy" }
        if(requested.isBlank()) {
            app.chatRepository.dao.updateSource(session,"lom")
            app.chatRepository.dao.updateSessionTitle(session,com.openminis.app.ui.chat.visibleLomUserText(text).take(40),System.currentTimeMillis())
            HeadlessChatRunner.applyModelOverride(app,session,null,null)
        }
        val result=JSONObject().put("session_id",session).put("client_id",client).put("fingerprint",fingerprint).put("status","accepted")
        check(prefs.edit().putString(receipt,result.toString()).commit()) { "chat.receipt_failed" }
        cancelled.remove(session)
        busy[session]="accepted"
        val job=scope.launch(start=CoroutineStart.LAZY) {
            try {
                if(session in cancelled) return@launch
                busy[session]="running"
                HeadlessChatRunner.selectModel(app,session,entry.id)
                val outcome=HeadlessChatRunner.prompt(app,session,text,attachments=attachments,wait=true,timeoutMs=3600000)
                val err=withContext(Dispatchers.Main) { HeadlessChatRunner.existingViewModel(session)?.error?.value }
                busy[session]=when {
                    session in cancelled -> "cancelled"
                    outcome.timedOut -> { HeadlessChatRunner.cancel(app,session); "timeout" }
                    outcome.status=="Error" || !err.isNullOrBlank() -> "failed"
                    else -> "completed"
                }
            } catch(e:CancellationException) { busy[session]="cancelled"; throw e }
            catch(e:Exception) { busy[session]="failed"; android.util.Log.w("LomRemote", "Phone task failed: ${e.javaClass.simpleName}") }
            finally {
                result.put("status",busy[session] ?: "interrupted")
                prefs.edit().putString(receipt,result.toString()).commit()
                jobs.remove(session); cancelled.remove(session)
            }
        }
        jobs[session]=job; job.start(); result
    }
    suspend fun cancel(p:JSONObject):JSONObject = gate.withLock {
        val session=p.getString("session_id")
        check(app.chatRepository.dao.getSession(session)!=null) { "chat.session_missing" }
        cancelled.add(session)
        HeadlessChatRunner.cancel(app,session)
        jobs[session]?.cancelAndJoin()
        busy[session]="cancelled"
        cancelled.remove(session)
        return@withLock JSONObject().put("status","cancelled").put("session_id",session)
    }
    suspend fun change(method:String,p:JSONObject):JSONObject = gate.withLock {
        val id=p.getString("session_id")
        if(method=="chat.delete" && app.chatRepository.dao.getSession(id)==null) return@withLock JSONObject().put("status","deleted")
        check(app.chatRepository.dao.getSession(id)!=null) { "chat.session_missing" }
        when(method) {
            "chat.rename" -> {
                val title=p.getString("title").trim()
                require(title.isNotEmpty() && title.length<=200) { "chat.invalid_title" }
                app.chatRepository.dao.updateSessionTitle(id,title,System.currentTimeMillis())
            }
            "chat.pin" -> app.chatRepository.dao.updatePinnedAt(id,if(p.getBoolean("pinned")) System.currentTimeMillis() else null)
            "chat.delete" -> {
                check(busy[id] !in listOf("accepted","running")) { "chat.busy" }
                com.openminis.app.data.session.SessionDeleter.deleteTree(app,app.chatRepository,id,"lom-desktop")
                busy.remove(id)
            }
        }
        JSONObject().put("status","saved").put("session_id",id)
    }
    suspend fun list(p:JSONObject):JSONObject {
        val offset=p.optInt("offset",0).coerceAtLeast(0)
        val all=app.chatRepository.dao.listSessions()
        val page=all.sortedByDescending { it.updatedAt }.drop(offset).take(100)
        return JSONObject().put("items",JSONArray(page.map { s -> JSONObject().put("id",s.id).put("title",s.title?:"新的会话")
            .put("updated",s.updatedAt).put("pinned",s.pinnedAt!=null).put("model",s.modelId).put("running",busy[s.id] in listOf("accepted","running")) }))
            .put("total",all.size).put("next",offset+page.size)
    }
    suspend fun read(p:JSONObject):JSONObject {
        val session=p.getString("session_id")
        check(app.chatRepository.dao.getSession(session)!=null) { "chat.session_missing" }
        val live=withContext(Dispatchers.Main) {
            HeadlessChatRunner.existingViewModel(session)?.let { vm ->
                val items=vm.messages.value.filter { !it.isInternalBridge }.map { m ->
                    val delta=vm.streamingById.value[m.id]
                    JSONObject().put("id",m.id).put("role",m.role).put("text",delta?.content?:m.content)
                        .put("attachments",JSONArray(m.attachmentNames))
                        .put("at",m.completedAt ?: 0L).put("blocks",JSONArray((delta?.toolBlocks?:m.toolBlocks).filter { it.kind!="thinking" }.map { block ->
                            JSONObject().put("id",block.id).put("kind",block.kind).put("title",block.toolTitle)
                                .put("text",block.content).put("status",block.toolStatus?.name?:"")
                        }))
                }
                Triple(items,vm.isStreaming.value,vm.error.value)
            }
        }
        val items=live?.first ?: app.chatRepository.dao.loadMessages(session).mapNotNull { row ->
            val parts=JSONArray(row.partsJson)
            val text=remoteStoredText(parts)
            val names=(0 until parts.length()).mapNotNull { i -> parts.optJSONObject(i)?.takeIf { it.optString("type")=="mediaRef" }?.optJSONObject("value")?.let { it.optString("originalFileName", "附件") } }
            if(ChatMessage.isInternalBridgeText(text)) null else JSONObject().put("id",row.id).put("role",row.role).put("text",text).put("at",row.createdAt).put("attachments",JSONArray(names))
        }
        val offset=p.optInt("offset",0).coerceAtLeast(0)
        val page=items.drop(offset).take(50)
        val active=live?.second==true || busy[session] in listOf("accepted","running")
        return JSONObject().put("items",JSONArray(page)).put("total",items.size).put("next",offset+page.size)
            .put("running",active).put("status",if(active) "running" else busy[session]?:"idle")
            .put("error",if(live?.third.isNullOrBlank()) "" else "手机模型调用失败，请在手机查看详情")
    }
}
