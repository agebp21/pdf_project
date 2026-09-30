package id.sarvamaya.sarvamaya_book

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

// Read aloud: the Android WebView has no speech voices, so the book asks
// Android's own text-to-speech through the "myflipbook/tts" channel
// (speak {id, text, lang} / stop) and hears back "done" {id, ok}.
class MainActivity : FlutterActivity() {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var channel: MethodChannel? = null
    private val waiting = mutableListOf<Pair<Int, () -> Unit>>()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val speech = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "myflipbook/tts")
        channel = speech
        speech.setMethodCallHandler { call, result ->
            when (call.method) {
                "speak" -> {
                    val id = call.argument<Int>("id") ?: 0
                    val text = call.argument<String>("text") ?: ""
                    val lang = call.argument<String>("lang") ?: "id-ID"
                    whenReady(id) { speak(id, text, lang) }
                    result.success(null)
                }
                "stop" -> { waiting.clear(); tts?.stop(); result.success(null) }
                else -> result.notImplemented()
            }
        }
    }

    private fun whenReady(id: Int, action: () -> Unit) {
        if (ready) { action(); return }
        waiting.add(Pair(id, action))
        if (tts != null) return
        tts = TextToSpeech(this) { status ->
            ready = status == TextToSpeech.SUCCESS
            val queued = waiting.toList()
            waiting.clear()
            if (!ready) { queued.forEach { report(it.first.toString(), false) }; return@TextToSpeech }
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { report(utteranceId, true) }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { report(utteranceId, false) }
                override fun onError(utteranceId: String?, errorCode: Int) { report(utteranceId, false) }
            })
            queued.forEach { it.second() }
        }
    }

    private fun speak(id: Int, text: String, lang: String) {
        val engine = tts ?: return
        // Keep the device's default voice when that language isn't installed.
        val result = engine.setLanguage(Locale.forLanguageTag(lang))
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) engine.language = Locale.getDefault()
        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id.toString()) != TextToSpeech.SUCCESS) report(id.toString(), false)
    }

    private fun report(utteranceId: String?, ok: Boolean) {
        val id = utteranceId?.toIntOrNull() ?: return
        runOnUiThread { channel?.invokeMethod("done", mapOf("id" to id, "ok" to ok)) }
    }

    override fun onDestroy() {
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }
}
