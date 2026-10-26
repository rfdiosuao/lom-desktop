package top.heang.lom.app

import android.app.AlarmManager
import android.content.Context
import android.os.Build
import com.openminis.app.MinisApp
import com.openminis.app.scheduled.*
import com.openminis.app.data.model.ModelGroup
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone
import java.time.*
import java.time.format.DateTimeFormatter

internal class LomRemoteSchedules(private val app: MinisApp) {
    private val gate = Mutex()
    private val manager get() = ScheduledTaskManager(app)
    private val receipts = app.getSharedPreferences("lom_remote_schedule_receipts", Context.MODE_PRIVATE)
    private fun revision(task: ScheduledTask) = digest(task.toJson().toString())
    private fun row(t: ScheduledTask): JSONObject {
        val editable = t.triggerKind in listOf(ScheduledTriggerKind.CALENDAR,ScheduledTriggerKind.INTERVAL) &&
            (t.targetMode == ScheduledTargetMode.NewSession || t.targetMode is ScheduledTargetMode.AppendToSession)
        val freq = when {
            t.triggerKind == ScheduledTriggerKind.INTERVAL -> "interval"
            t.triggerKind != ScheduledTriggerKind.CALENDAR -> "custom"
            t.repeatMode == ScheduledRepeatMode.ONCE -> "once"
            t.repeatMode == ScheduledRepeatMode.DAILY -> "daily"
            else -> "weekly"
        }
        val days = if(t.repeatMode == ScheduledRepeatMode.WEEKDAYS) (2..6).toSet() else t.customDays
        return JSONObject().put("id",t.id).put("revision",revision(t)).put("name",t.label).put("prompt",t.prompt)
            .put("freq",freq).put("time",if(freq=="once") java.time.Instant.ofEpochMilli(t.startDateMs ?: t.nextTriggerMs() ?: t.createdAt).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")) else "%02d:%02d".format(t.timeOfDayHour,t.timeOfDayMinute))
            .put("days",JSONArray(days.map { if(it == 1) 7 else it-1 }).toString()).put("every",((t.intervalSec ?: 3600)/60).toString())
            .put("enabled",t.enabled.toString()).put("session_id",t.targetMode.sessionIdOrNull ?: "")
            .put("next",(if(t.enabled) t.nextTriggerMs() else null)?.toString() ?: "")
            .put("last",t.lastFiredAt?.toString() ?: "").put("runs",JSONArray(t.runHistory.map { it.toJson() }).toString())
            .put("editable",editable.toString())
    }
    suspend fun handle(method: String, p: JSONObject, desktop: String): JSONObject = gate.withLock {
        if(method == "schedule.list") {
            val alarms=app.getSystemService(AlarmManager::class.java)
            return@withLock JSONObject().put("items",JSONArray(manager.list().map { row(it) }).toString())
                .put("timezone",TimeZone.getDefault().id).put("exact",(Build.VERSION.SDK_INT<31 || alarms.canScheduleExactAlarms()).toString())
        }
        val id=p.getString("id")
        require(Regex("[a-zA-Z0-9-]{16,80}").matches(id)) { "schedule.invalid_id" }
        val old=manager.get(id)
        if(method=="schedule.save") {
            val task=decode(p,desktop,old)
            if(old!=null && p.getString("revision").isEmpty()) {
                check(old.label==task.label && old.prompt==task.prompt && old.repeatMode==task.repeatMode &&
                    old.timeOfDayHour==task.timeOfDayHour && old.timeOfDayMinute==task.timeOfDayMinute &&
                    old.customDays==task.customDays && old.triggerKind==task.triggerKind && old.intervalSec==task.intervalSec &&
                    old.targetMode==task.targetMode) { "schedule.id_reused" }
                return@withLock row(old)
            }
            check((old?.let { revision(it) } ?: "") == p.getString("revision")) { "sync.conflict" }
            val bound = bindModel(task, desktop)
            return@withLock row(if(old==null) manager.create(bound) else manager.update(bound))
        }
        if(method=="schedule.delete" && old==null) return@withLock JSONObject().put("status","deleted")
        check(old!=null) { "schedule.missing" }
        if(method=="schedule.run") {
            val request=p.getString("request_id")
            require(Regex("[a-zA-Z0-9-]{16,64}").matches(request)) { "schedule.invalid_request" }
            val key=digest(desktop+request)
            receipts.getString(key,null)?.let { saved ->
                val result=JSONObject(saved); check(result.getString("id")==id) { "schedule.id_reused" }; return@withLock result
            }
            val result=JSONObject().put("id",id).put("status","dispatching")
            check(receipts.edit().putString(key,result.toString()).commit()) { "schedule.receipt_failed" }
            val session=ScheduledAgentRunner.run(app,old,waitForCompletion=false)
            result.put("status",if(session==null) "failed" else "accepted").put("session_id",session ?: "")
            check(receipts.edit().putString(key,result.toString()).commit()) { "schedule.receipt_failed" }
            check(session!=null) { "schedule.dispatch_failed" }
            return@withLock result
        }
        check(revision(old)==p.getString("revision")) { "sync.conflict" }
        when(method) {
            "schedule.delete" -> { manager.delete(id); JSONObject().put("status","deleted") }
            "schedule.toggle" -> { manager.setEnabled(id,p.getString("enabled").toBooleanStrict()); row(manager.get(id) ?: error("schedule.missing")) }
            else -> error("schedule.unknown_method")
        }
    }
    // Keep scheduled BYOK and URL independent of later interactive model changes.
    // Secrets remain in the existing encrypted provider store, never in the task JSON.
    private fun bindModel(task: ScheduledTask, desktop: String): ScheduledTask {
        val repo=app.providerRepository
        val cfg=repo.config.value
        val source=cfg.instances.firstOrNull { it.id=="lom-"+digest(desktop).take(24) } ?: error("chat.model_missing")
        val entry=cfg.modelEntries.firstOrNull { it.id==task.modelId } ?: error("chat.model_missing")
        val key=repo.loadApiKey(source.id) ?: error("chat.model_missing")
        val id="lom-schedule-"+digest(desktop+entry.id+source.customBaseURL+source.providerType.name+key).take(24)
        val snapshot=entry.copy(providerInstanceId=id,uuid="$id/${entry.baseModel.id}")
        repo.importLomModel(source.copy(id=id,label="Lom · 定时任务模型"),snapshot,
            ModelGroup(id=id,name="Lom · 定时任务模型",memberEntryIds=mutableListOf(snapshot.id)),key,makeDefault=false)
        return task.copy(modelId=snapshot.model.id,modelBinding=JSONObject().put("type","entry").put("entryId",snapshot.id).toString())
    }
    private suspend fun decode(p: JSONObject, desktop: String, old: ScheduledTask?): ScheduledTask {
        val name=p.getString("name").trim(); val prompt=p.getString("prompt").trim()
        require(name.isNotBlank() && name.length<=200 && prompt.isNotBlank() && prompt.toByteArray().size<=60000) { "schedule.invalid_content" }
        val freq=p.getString("freq")
        require(freq in listOf("once","daily","weekly","interval")) { "schedule.unsupported_frequency" }
        if(old!=null) check(row(old).getString("editable")=="true") { "schedule.edit_on_phone" }
        val once=if(freq=="once") LocalDateTime.parse(p.getString("time")).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() else null
        require(once==null || once>System.currentTimeMillis() || old?.enabled==false) { "schedule.time_in_past" }
        val time=p.getString("time").substringAfter('T').split(':'); val hour=time.getOrNull(0)?.toIntOrNull(); val minute=time.getOrNull(1)?.toIntOrNull()
        require(hour!=null && hour in 0..23 && minute!=null && minute in 0..59) { "schedule.invalid_time" }
        val ds=JSONArray(p.getString("days")); val days=(0 until ds.length()).map { ds.getInt(it) }.toSet()
        require(days.all { it in 1..7 } && (freq!="weekly" || days.isNotEmpty())) { "schedule.invalid_days" }
        val every=p.getString("every").toLong(); require(every in 1..525600) { "schedule.invalid_interval" }
        val session=p.getString("session_id")
        if(session.isNotEmpty()) check(app.chatRepository.dao.getSession(session)!=null) { "chat.session_missing" }
        app.providerRepository.awaitConfigLoaded()
        val entry=app.providerRepository.config.value.modelEntries.firstOrNull { it.providerInstanceId=="lom-"+digest(desktop).take(24) }
            ?: error("chat.model_missing")
        val base=old ?: ScheduledTask(id=p.getString("id"),label=name,prompt=prompt,timeOfDayHour=hour,timeOfDayMinute=minute,repeatMode=ScheduledRepeatMode.DAILY)
        return base.copy(label=name,prompt=prompt,timeOfDayHour=hour,timeOfDayMinute=minute,
            repeatMode=when(freq) { "once"->ScheduledRepeatMode.ONCE; "weekly"->ScheduledRepeatMode.CUSTOM; else->ScheduledRepeatMode.DAILY },
            customDays=days.map { if(it==7) 1 else it+1 }.toSet(),enabled=p.getString("enabled").toBooleanStrict(),
            triggerKind=if(freq=="interval") ScheduledTriggerKind.INTERVAL else ScheduledTriggerKind.CALENDAR,
            startDateMs=once,endDateMs=once?.plus(59999),
            anchorMs=if(old?.triggerKind==ScheduledTriggerKind.INTERVAL && old.intervalSec==every*60) old.anchorMs else System.currentTimeMillis(),
            triggeredCount=if(old?.intervalSec==every*60) old.triggeredCount else 0,
            intervalSec=if(freq=="interval") every*60 else null,
            targetMode=if(session.isEmpty()) ScheduledTargetMode.NewSession else ScheduledTargetMode.AppendToSession(session),
            modelId=entry.id,modelBinding=JSONObject().put("type","entry").put("entryId",entry.id).toString())
    }
}
