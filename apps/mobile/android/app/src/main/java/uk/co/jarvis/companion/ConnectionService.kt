package uk.co.jarvis.companion

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.content.pm.ServiceInfo
import org.json.JSONObject

/** User-started messaging only. No wake lock, camera, microphone, boot receiver or auto-restart. */
class ConnectionService:Service(){
    override fun onCreate(){
        super.onCreate()
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("connection","JARVIS connection",NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel("alerts","JARVIS alerts",NotificationManager.IMPORTANCE_DEFAULT))
        NodeConnection.onDisconnect={stopSelf()}
        NodeConnection.onAlert={alert->notifyAlert(alert)}
    }
    private fun launch():PendingIntent=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun notification():Notification{
        val stop=PendingIntent.getService(this,1,Intent(this,ConnectionService::class.java).setAction("disconnect"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this,"connection").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("JARVIS companion connection").setContentText("Private companion · tap to check live status").setContentIntent(launch()).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(Notification.Action.Builder(null,"Disconnect",stop).build()).build()
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
        if(intent?.action=="disconnect"){NodeConnection.disconnect();stopSelf();return START_NOT_STICKY}
        if(android.os.Build.VERSION.SDK_INT>=34)startForeground(42,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) else startForeground(42,notification())
        NodeConnection.connect(this,intent?.getStringExtra("endpoint")?:"",intent?.getStringExtra("nodeId")?:"",intent?.getStringExtra("alias")?:"",intent?.getStringExtra("token")?:"")
        return START_NOT_STICKY
    }
    private fun notifyAlert(alert:JSONObject){
        if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)return
        val public=Notification.Builder(this,"alerts").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("JARVIS alert").setContentText("Unlock to review").build()
        val notification=Notification.Builder(this,"alerts").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(alert.optString("title").take(200)).setContentText(alert.optString("body").take(500)).setContentIntent(launch()).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public).setAutoCancel(true).build()
        getSystemService(NotificationManager::class.java).notify(alert.optString("id").hashCode(),notification)
    }
    override fun onDestroy(){NodeConnection.onDisconnect=null;NodeConnection.onAlert=null;NodeConnection.disconnect();super.onDestroy()}
    override fun onBind(intent:Intent?):IBinder?=null
}
