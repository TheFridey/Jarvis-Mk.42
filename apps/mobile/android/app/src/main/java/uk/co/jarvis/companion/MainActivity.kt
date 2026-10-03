package uk.co.jarvis.companion

import android.app.*
import android.content.Intent
import android.os.Bundle
import android.security.KeyChain
import android.speech.RecognizerIntent
import android.view.View
import android.view.WindowManager
import android.widget.*
import org.json.JSONObject

class MainActivity:Activity(){
    private lateinit var status:TextView
    private lateinit var overview:TextView
    private lateinit var transcript:TextView
    private lateinit var input:EditText
    private lateinit var node:EditText
    private lateinit var endpoint:EditText
    private lateinit var token:EditText
    private lateinit var scene:Spinner
    private lateinit var display:Spinner
    private lateinit var conversation:Spinner
    private var sceneIds=listOf<String>()
    private var displayIds=listOf<String>()
    private var conversationIds=listOf<String>()
    private var alias=""
    private var selectedConversation:String?=null
    private var speech:android.speech.tts.TextToSpeech?=null
    private var speechReady=false
    private val prefs by lazy { getSharedPreferences("presentation",MODE_PRIVATE) }
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        alias=prefs.getString("certificateAlias","")?:""
        val layout=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(28,30,28,30)}
        setContentView(ScrollView(this).apply{addView(layout)})
        fun text(value:String):TextView=TextView(this).apply{text=value;setTextColor(0xffbdd7e8.toInt());textSize=17f;layout.addView(this)}
        fun edit(hintText:String,value:String=""):EditText=EditText(this).apply{hint=hintText;setText(value);layout.addView(this)}
        fun button(label:String,action:()->Unit){layout.addView(Button(this).apply{text=label;setOnClickListener{action()}})}
        text("JARVIS / MARK 42").textSize=27f
        status=text("Disconnected")
        speech=android.speech.tts.TextToSpeech(this){result->speechReady=result==android.speech.tts.TextToSpeech.SUCCESS}
        overview=text("Awaiting Kernel")
        endpoint=edit("Private HTTPS tunnel endpoint",prefs.getString("endpoint","")?:"")
        node=edit("Mobile node ID",prefs.getString("nodeId","mobile-phone")?:"mobile-phone")
        token=edit("Single-use enrollment token (first connect only)").apply{inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD}
        button("Import JARVIS public CA"){startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE),10)}
        button("Choose device certificate"){KeyChain.choosePrivateKeyAlias(this,{chosen->if(chosen!=null){alias=chosen;prefs.edit().putString("certificateAlias",alias).apply();runOnUiThread{status.text="Device certificate selected"}}},arrayOf("RSA","EC"),null,null,-1,null)}
        button("Connect"){
            if(alias.isEmpty()){status.text="Choose a device certificate first";return@button}
            if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),11)
            val url=endpoint.text.toString().trim();val id=node.text.toString().trim()
            prefs.edit().putString("endpoint",url).putString("nodeId",id).apply()
            startForegroundService(Intent(this,ConnectionService::class.java).putExtra("endpoint",url).putExtra("nodeId",id).putExtra("alias",alias).putExtra("token",token.text.toString().trim()))
            token.text.clear()
        }
        text("Conversation")
        conversation=Spinner(this).also{layout.addView(it)}
        conversation.onItemSelectedListener=object:AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent:AdapterView<*>?,view:View?,position:Int,id:Long){selectedConversation=conversationIds.getOrNull(position);renderTranscript()}
            override fun onNothingSelected(parent:AdapterView<*>?){}
        }
        transcript=text("")
        input=edit("Continue with JARVIS")
        button("New conversation"){selectedConversation=null;transcript.text="New conversation"}
        button("Send"){val value=input.text.toString().trim();if(value.isNotEmpty()&&NodeConnection.connected){NodeConnection.converse(value,selectedConversation);input.text.clear()}}
        button("Push to talk"){
            val speech=Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true).putExtra(RecognizerIntent.EXTRA_PROMPT,"Speak to JARVIS")
            if(speech.resolveActivity(packageManager)!=null)startActivityForResult(speech,12) else status.text="Speech recognition unavailable on this device"
        }
        button("Read latest answer"){
            val turns=NodeConnection.picture?.optJSONArray("conversations")
            val answer=(0 until (turns?.length()?:0)).map{turns!!.getJSONObject(it)}.lastOrNull{it.optString("conversationId")==selectedConversation&&!it.isNull("answer")}?.optString("answer")
            val engine=speech;val voice=engine?.voices?.firstOrNull{!it.isNetworkConnectionRequired&&it.locale.language==java.util.Locale.getDefault().language}
            if(!speechReady||engine==null||voice==null){status.text="Local speech voice unavailable"}else if(answer.isNullOrBlank()){status.text="No answer ready"}else{
                engine.voice=voice;engine.setAudioAttributes(android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ASSISTANT).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build())
                engine.speak(answer.take(4000),android.speech.tts.TextToSpeech.QUEUE_FLUSH,null,"jarvis-answer")
            }
        }
        button("Audio routing settings"){startActivity(Intent(android.provider.Settings.ACTION_SOUND_SETTINGS))}
        text("Present a Scene resource")
        scene=Spinner(this).also{layout.addView(it)};display=Spinner(this).also{layout.addView(it)}
        button("Put that on the wall"){val objectId=sceneIds.getOrNull(scene.selectedItemPosition);val displayId=displayIds.getOrNull(display.selectedItemPosition);if(NodeConnection.connected&&objectId!=null&&displayId!=null)NodeConnection.present(displayId,objectId)}
        button("Disconnect"){NodeConnection.send(JSONObject().put("type","DISCONNECT"));NodeConnection.disconnect();stopService(Intent(this,ConnectionService::class.java))}
        button("Emergency revoke this device"){AlertDialog.Builder(this).setTitle("Revoke this mobile node?").setMessage("The Kernel will revoke this device. Reconnection requires operator provisioning.").setNegativeButton("Cancel",null).setPositiveButton("Revoke"){_,_->NodeConnection.revoke()}.show()}
        text("Background connection runs only while enabled. Audio uses Android routing. Wake word unavailable until a local detector is qualified. No camera capture.").textSize=12f
        NodeConnection.onUpdate={runOnUiThread{render()}};render()
    }
    private fun render(){
        status.text=NodeConnection.status
        val p=NodeConnection.picture
        if(p==null){overview.text="Live state unavailable";transcript.text="";sceneIds=emptyList();displayIds=emptyList();conversationIds=emptyList();scene.adapter=null;display.adapter=null;conversation.adapter=null;return}
        overview.text="${p.optString("mode")} · ${p.optString("work")}\n${p.optString("health")}\n${if(p.isNull("objective"))"Standing by" else p.optString("objective")}\n${if(p.isNull("nextMeeting"))"Next meeting unavailable" else "Next meeting: "+p.optString("nextMeeting")}"
        val choices=p.optJSONArray("sceneChoices");val newSceneIds=(0 until (choices?.length()?:0)).map{choices!!.getJSONObject(it).getString("id")}
        if(newSceneIds!=sceneIds){sceneIds=newSceneIds;scene.adapter=ArrayAdapter(this,android.R.layout.simple_spinner_dropdown_item,newSceneIds.indices.map{choices!!.getJSONObject(it).getString("title")})}
        val screens=p.optJSONArray("displays");val newDisplayIds=(0 until (screens?.length()?:0)).map{screens!!.getJSONObject(it).getString("id")}
        if(newDisplayIds!=displayIds){displayIds=newDisplayIds;display.adapter=ArrayAdapter(this,android.R.layout.simple_spinner_dropdown_item,displayIds)}
        val turns=p.optJSONArray("conversations");val ids=(0 until (turns?.length()?:0)).map{turns!!.getJSONObject(it).getString("conversationId")}.distinct()
        if(ids!=conversationIds){conversationIds=ids;conversation.adapter=ArrayAdapter(this,android.R.layout.simple_spinner_dropdown_item,ids);conversation.setSelection((selectedConversation?.let{ids.indexOf(it)}?:-1).takeIf{it>=0}?:ids.lastIndex.coerceAtLeast(0))}
        renderTranscript()
    }
    private fun renderTranscript(){val turns=NodeConnection.picture?.optJSONArray("conversations");transcript.text=(0 until (turns?.length()?:0)).map{turns!!.getJSONObject(it)}.filter{it.optString("conversationId")==selectedConversation}.joinToString("\n\n"){"You: ${it.optString("input")}\nJARVIS: ${if(it.isNull("answer"))it.optString("status") else it.optString("answer")}"}}
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?){
        super.onActivityResult(requestCode,resultCode,data);if(resultCode!=RESULT_OK)return
        if(requestCode==10)data?.data?.let{uri->try{val bytes=contentResolver.openInputStream(uri)!!.use{stream->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(4096);while(true){val count=stream.read(buffer);if(count<0)break;require(out.size()+count<=32768);out.write(buffer,0,count)};out.toByteArray()};java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(bytes.inputStream());openFileOutput("node-ca.crt",MODE_PRIVATE).use{it.write(bytes)};status.text="Public CA imported"}catch(_:Exception){status.text="Invalid CA certificate"}}
        if(requestCode==12)input.setText(data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?:"")
    }
    override fun onStop(){speech?.stop();super.onStop()}
    override fun onDestroy(){NodeConnection.onUpdate=null;speech?.shutdown();speech=null;super.onDestroy()}
}
