package uk.co.jarvis.companion

import android.content.Context
import android.security.KeyChain
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.Socket
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.Executors
import javax.net.ssl.*

/** Credential handles and a disposable projection only. All state/commands belong to the Kernel. */
object NodeConnection {
    private val worker = Executors.newSingleThreadExecutor()
    private var client: OkHttpClient? = null
    private var socket: WebSocket? = null
    private var binding: JSONObject? = null
    private var sequence = 0
    private var admitted = false
    private var pendingNonce: String? = null
    @Volatile private var generation = 0
    @Volatile var picture: JSONObject? = null; private set
    @Volatile var connected = false; private set
    var onUpdate: (() -> Unit)? = null
    var onAlert: ((JSONObject) -> Unit)? = null
    var onDisconnect: (() -> Unit)? = null
    var status = "Disconnected"; private set

    fun connect(context: Context, endpoint: String, nodeId: String, alias: String, token: String) {
        disconnect(false)
        val current = generation
        status = "Connecting"; onUpdate?.invoke()
        worker.execute {
            try {
                val url = java.net.URI(endpoint)
                require(url.scheme == "https" && url.host != null && url.userInfo == null && url.query == null && url.fragment == null && (url.path.isNullOrEmpty() || url.path == "/"))
                require(Regex("[A-Za-z0-9._:-]{3,128}").matches(nodeId))
                val key = KeyChain.getPrivateKey(context, alias) ?: error("Key unavailable")
                val chain = KeyChain.getCertificateChain(context, alias) ?: error("Certificate unavailable")
                val ca = context.openFileInput("node-ca.crt").use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
                val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("jarvis-ca", ca) }
                val tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }.trustManagers.filterIsInstance<X509TrustManager>().single()
                val km = object : X509ExtendedKeyManager() {
                    override fun getPrivateKey(a: String?): PrivateKey = key
                    override fun getCertificateChain(a: String?): Array<X509Certificate> = chain
                    override fun chooseClientAlias(t: Array<out String>?, i: Array<out Principal>?, s: Socket?): String = alias
                    override fun chooseEngineClientAlias(t: Array<out String>?, i: Array<out Principal>?, e: SSLEngine?): String = alias
                    override fun getClientAliases(t: String?, i: Array<out Principal>?): Array<String> = arrayOf(alias)
                    override fun getServerAliases(t: String?, i: Array<out Principal>?): Array<String>? = null
                    override fun chooseServerAlias(t: String?, i: Array<out Principal>?, s: Socket?): String? = null
                }
                val ssl = SSLContext.getInstance("TLSv1.3").apply { init(arrayOf(km), arrayOf(tm), null) }
                val http = OkHttpClient.Builder().sslSocketFactory(ssl.socketFactory, tm).connectionSpecs(listOf(ConnectionSpec.MODERN_TLS)).followRedirects(false).followSslRedirects(false).callTimeout(java.time.Duration.ofSeconds(10)).build()
                val base = endpoint.trimEnd('/')
                val descriptor = JSONObject().put("nodeId",nodeId).put("nodeType","mobile").put("protocolVersion","1").put("requestedTrustTier","owned-mobile").put("sensors",JSONArray()).put("capabilities",JSONArray()).put("surfaces",JSONArray().put("mobile-companion")).put("attributes",JSONObject())
                fun call(path: String, body: JSONObject? = null): JSONObject {
                    val request = Request.Builder().url(base+path).apply { if(body!=null)post(body.toString().toRequestBody("application/json".toMediaType())) }.build()
                    return http.newCall(request).execute().use { response -> require(response.isSuccessful); JSONObject(response.body!!.string()) }
                }
                if(token.isNotBlank())call("/nodes/enroll",JSONObject().put("token",token).put("descriptor",descriptor).put("softwareVersion","android-companion-v1"))
                val epoch = call("/nodes/status").getInt("epoch")
                val auth = call("/nodes/authenticate",JSONObject().put("nodeId",nodeId).put("expectedEpoch",epoch))
                synchronized(this) { if(current!=generation)return@execute; client=http; binding=JSONObject().put("nodeId",nodeId).put("sessionId",auth.getString("sessionId")).put("epoch",auth.getInt("epoch")).put("accessToken",auth.getString("accessToken")); sequence=0; admitted=false }
                val request = Request.Builder().url(base.replaceFirst("https:","wss:")+"/nodes/socket").header("Authorization","Bearer "+auth.getString("accessToken")).header("x-jarvis-session-id",auth.getString("sessionId")).header("x-jarvis-node-epoch",auth.getInt("epoch").toString()).build()
                http.newWebSocket(request,object:WebSocketListener(){
                    override fun onOpen(ws:WebSocket,response:Response){synchronized(NodeConnection){if(current!=generation){ws.cancel();return};socket=ws};send(JSONObject().put("type","DECLARE").put("descriptor",descriptor))}
                    override fun onMessage(ws:WebSocket,text:String){
                        if(current!=generation)return
                        try { require(text.length<=262144); val f=JSONObject(text)
                            when(f.getString("type")) {
                                "ADMIT" -> { admitted=true; pendingNonce?.let { heartbeat(it) }; pendingNonce=null; send(JSONObject().put("type","SUBSCRIBE").put("channel","companion")) }
                                "HEARTBEAT_CHALLENGE" -> { val nonce=f.getString("nonce"); if(admitted)heartbeat(nonce) else pendingNonce=nonce }
                                "COMPANION_STATE" -> { picture=f.getJSONObject("picture"); connected=true; status="Connected"; onUpdate?.invoke() }
                                "NOTIFICATION" -> onAlert?.invoke(f.getJSONObject("notification"))
                                "COMMAND_RESULT" -> { status=if(f.getBoolean("ok"))"Command received by Kernel" else "Command rejected · refresh current state";onUpdate?.invoke() }
                                "REVOKED", "REJECTED", "DISCONNECTED" -> disconnect()
                            }
                        }catch(_:Exception){disconnect()}
                    }
                    override fun onFailure(ws:WebSocket,t:Throwable,response:Response?){if(current==generation)disconnect()}
                    override fun onClosed(ws:WebSocket,code:Int,reason:String){if(current==generation)disconnect()}
                })
            }catch(_:Exception){if(current==generation){disconnect();status="Connection rejected · check private tunnel and device certificate";onUpdate?.invoke()}}
        }
    }
    private fun heartbeat(nonce:String){send(JSONObject().put("type","HEARTBEAT").put("nonce",nonce))}
    @Synchronized fun send(frame:JSONObject):Boolean {
        val b=binding?:return false; val ws=socket?:return false
        for(k in b.keys())frame.put(k,b.get(k))
        frame.put("sequence",++sequence).put("requestId",UUID.randomUUID().toString())
        return ws.send(frame.toString())
    }
    fun converse(input:String,conversationId:String?){val p=picture?:return;require(input.length in 1..4000);val frame=JSONObject().put("type","CONVERSE").put("commandId",UUID.randomUUID().toString()).put("expectedStateVersion",p.getLong("stateVersion")).put("input",input);if(conversationId!=null)frame.put("conversationId",conversationId);send(frame)}
    fun present(displayId:String,objectId:String){val p=picture?:return;send(JSONObject().put("type","PRESENT").put("displayNodeId",displayId).put("objectId",objectId).put("expectedSceneVersion",p.getLong("sceneVersion")))}
    fun revoke(){send(JSONObject().put("type","REVOKE_SELF"))}
    @Synchronized fun disconnect(notify:Boolean=true){generation++;socket?.cancel();socket=null;binding=null;picture=null;connected=false;admitted=false;pendingNonce=null;status="Disconnected";client?.dispatcher?.cancelAll();client?.connectionPool?.evictAll();client=null;onUpdate?.invoke();if(notify)onDisconnect?.invoke()}
}
