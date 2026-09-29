package com.coderpush.cloudclaw;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.util.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.webkit.*;
import com.google.mediapipe.framework.image.*;
import com.google.mediapipe.tasks.core.*;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.gesturerecognizer.*;
import org.json.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.*;

/** Offline shared game. No frame or landmark persistence. */
@androidx.annotation.OptIn(markerClass = androidx.camera.camera2.interop.ExperimentalCamera2Interop.class)
public class MainActivity extends ComponentActivity {
 static final String ORIGIN="https://appassets.androidplatform.net";
 final ExecutorService executor=Executors.newSingleThreadExecutor();
 final ExecutorService fileExecutor=Executors.newSingleThreadExecutor();
 final Handler main=new Handler(Looper.getMainLooper());
 WebView web; PreviewView preview; TextView status, previewStatus; Button previewToggle; ProcessCameraProvider provider;
 GestureRecognizer recognizer; JavaScriptReplyProxy client;
 final LatestResultQueue<JSONObject> deliveries=new LatestResultQueue<>();
 volatile long epoch=0; volatile boolean active=false;
 long frameId=0,lastTimestamp=0; int clientGeneration; boolean foreground=true, destroyed=false;
 PreviewConfiguration previewConfiguration;
 String selectedCamera="", nativeStats="", deliveryStats="";
 long pageEpoch=0;
 ExportRequest pendingExport;
 boolean pickerOutstanding=false;
 static final int MAX_EXPORT_BYTES=2*1024*1024;
 static final class ExportRequest {
  final long id,page; final String data; final JavaScriptReplyProxy reply;
  ExportRequest(long id,long page,String data,JavaScriptReplyProxy reply){this.id=id;this.page=page;this.data=data;this.reply=reply;}
 }
 final ActivityResultLauncher<String> exportPicker=registerForActivityResult(new ActivityResultContracts.CreateDocument("application/json"),this::writeExport);
 int samples=0,seen=0,two=0; long reportStart; ArrayList<Double> durations=new ArrayList<>();
 String buildLabel(){return "Cloud Claw "+BuildConfig.VERSION_NAME+" · "+BuildConfig.SOURCE_COMMIT.substring(0,Math.min(7,BuildConfig.SOURCE_COMMIT.length()))+(BuildConfig.SOURCE_DIRTY?" · local changes":"");}
 static double now(){return SystemClock.elapsedRealtimeNanos()/1e6;}
 static JSONObject json(Object... pairs){JSONObject o=new JSONObject();try{for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);}catch(JSONException e){throw new IllegalArgumentException(e);}return o;}
 static boolean trusted(Uri u){return "https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443);}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  previewConfiguration=new PreviewConfiguration(state!=null&&state.getBoolean("previewRequested",false),state!=null&&state.getBoolean("previewApplied",false));
  pickerOutstanding=state!=null&&state.getBoolean("pickerOutstanding",false);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
  web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
  LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setBackgroundColor(0xdd10151f);panel.setVisibility(View.GONE);
  previewToggle=new Button(this);panel.addView(previewToggle);
  previewStatus=new TextView(this);previewStatus.setTextColor(Color.WHITE);previewStatus.setTextSize(12);panel.addView(previewStatus);
  updatePreviewStatus();
  preview=new PreviewView(this);preview.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);preview.setVisibility(View.GONE);
  panel.addView(preview,new LinearLayout.LayoutParams(300,225));
  status=new TextView(this);status.setTextColor(Color.WHITE);status.setTextSize(12);status.setText(buildLabel()+"\n"+(state!=null&&state.getBoolean("exportInterrupted",false)?"Export interrupted by restart. Retry export and verify the file.":"Start camera in the game"));panel.addView(status);
  FrameLayout.LayoutParams position=new FrameLayout.LayoutParams(300,-2,Gravity.TOP|Gravity.RIGHT);position.topMargin=65;position.rightMargin=12;root.addView(panel,position);
  previewToggle.setOnClickListener(v->{previewConfiguration.toggleRequested();updatePreviewStatus();});
  Button reload=new Button(this);reload.setText("RELOAD GAME");reload.setVisibility(View.GONE);panel.addView(reload);
  reload.setOnClickListener(v->recreate());setContentView(root);
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(false);
  WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
  WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/",path->{try{
   if(path.isEmpty())path="index.html";
   if(path.equals("privacy")||path.equals("privacy.html"))path="privacy-android.html";
   String mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(path));
   if(path.endsWith(".js"))mime="text/javascript";if(mime==null)mime="application/octet-stream";
   return new WebResourceResponse(mime,"UTF-8",getAssets().open("web/"+path));
  }catch(Exception e){return null;}}).build();
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
    WebResourceResponse response=trusted(r.getUrl())&&"GET".equals(r.getMethod())?loader.shouldInterceptRequest(r.getUrl()):null;
    return response!=null?response:new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
   }
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !trusted(r.getUrl())||!("/".equals(r.getUrl().getPath())||"/index.html".equals(r.getUrl().getPath())||"/privacy".equals(r.getUrl().getPath())||"/privacy.html".equals(r.getUrl().getPath()));}
   @Override public void onPageStarted(WebView v,String url,Bitmap icon){stopTracking();client=null;pageEpoch++;pendingExport=null;}
   @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){stopTracking();client=null;pageEpoch++;pendingExport=null;
    root.removeView(v);v.destroy();web=null;panel.setVisibility(View.VISIBLE);reload.setVisibility(View.VISIBLE);
    status.setText(buildLabel()+"\nGame renderer stopped. Reload game; saved scores remain.");return true;}
  });
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){Log.i("TomkoGameWeb",m.message());return true;}});
  if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){panel.setVisibility(View.VISIBLE);status.setText("This WebView needs updating before native tracking can run.");return;}
  WebViewCompat.addWebMessageListener(web,"TomkoNative",Set.of(ORIGIN),(view,message,origin,isMainFrame,reply)->{
   if(!isMainFrame||!trusted(origin)||message.getType()!=WebMessageCompat.TYPE_STRING)return;
   try{String data=message.getData();if(data==null||data.length()>6*MAX_EXPORT_BYTES+4096)return;JSONObject o=new JSONObject(data);String type=o.optString("type");
    if(type.equals("export")){beginExport(o,reply);return;}
    if(data.length()>4096)return;
    if(type.equals("cameras")){
     listCameras(reply,o.optInt("generation",-1));return;
    }
    if(type.equals("start")){
     int hands=o.getInt("hands");double jsTime=o.getDouble("jsTime");int gen=o.getInt("generation");
     if((hands!=1&&hands!=2)||!Double.isFinite(jsTime)||gen<0||!foreground)return;
     stopTracking();client=reply;clientGeneration=gen;double receipt=now();
     send(json("type","clock","generation",gen,"jsTime",jsTime,"nativeTime",receipt));
     if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},1);send(json("type","error","generation",gen,"message","Allow camera permission, then start the camera again."));return;}
     boolean sessionPreview=previewConfiguration.beginSession(o.optBoolean("applyPreview",false));
     preview.setVisibility(sessionPreview?View.VISIBLE:View.GONE);updatePreviewStatus();
     startTracking(hands,epoch,o.optString("cameraId",""),sessionPreview);
    }else if(type.equals("sync")&&o.optInt("generation",-1)==clientGeneration){
     double jsTime=o.getDouble("jsTime");if(Double.isFinite(jsTime))send(json("type","clock","generation",clientGeneration,"jsTime",jsTime,"nativeTime",now()));
    }else if(type.equals("stop")&&o.optInt("generation",-1)==clientGeneration){stopTracking();}
    else if(type.equals("ack")&&o.optInt("generation",-1)==clientGeneration){if(deliveries.acknowledge(epoch,o.optLong("id",-1))){long token=epoch;main.post(()->deliver(token));}}
    else if(type.equals("stats")&&o.optInt("generation",-1)==clientGeneration&&active){
     Log.i("TomkoGameStats",data);
     deliveryStats=String.format(Locale.US,"Delivered %.1f/s · fresh %.1f/s\nAnalysis→JS p50 %.0f p95 %.0f ms",o.optDouble("deliveredHz",0),o.optDouble("freshHz",0),o.optDouble("p50",0),o.optDouble("p95",0));
     updateStatus();
    }
   }catch(Exception e){Log.w("TomkoGame","Rejected bridge message");}
  });
  web.loadUrl(ORIGIN+"/?hands=manual");
 }
 void send(JSONObject value){if(client!=null&&!destroyed)client.postMessage(value.toString());}
 void updatePreviewStatus(){
  previewToggle.setText(previewConfiguration.requested()?"CAMERA VIEW · REQUEST OFF":"CAMERA VIEW · REQUEST ON");
  previewStatus.setText("Session preview: "+(previewConfiguration.applied()?"ON":"OFF")+(previewConfiguration.pending()?"\nPending: "+(previewConfiguration.requested()?"ON":"OFF")+" · stop/start camera between runs to apply.":""));
 }
 void updateStatus(){status.setText(buildLabel()+"\n"+nativeStats+"\n"+deliveryStats);}
 String cameraId(CameraInfo info){return Camera2CameraInfo.from(info).getCameraId();}
 JSONArray cameraInventory(){
  JSONArray cameras=new JSONArray();
  for(CameraInfo info:provider.getAvailableCameraInfos()){
   String id=cameraId(info);int facing=info.getLensFacing();
   cameras.put(json("id",id,"label","Camera "+id+" · "+(facing==CameraSelector.LENS_FACING_FRONT?"front":facing==CameraSelector.LENS_FACING_BACK?"back":"external")));
  }
  return cameras;
 }
 void listCameras(JavaScriptReplyProxy reply,int generation){
  if(destroyed||!foreground||generation<0)return;long page=pageEpoch;
  if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){
   reply.postMessage(json("type","cameras","generation",generation,"cameras",new JSONArray()).toString());return;
  }
  var future=ProcessCameraProvider.getInstance(this);
  future.addListener(()->{if(destroyed||page!=pageEpoch)return;try{
   provider=future.get();reply.postMessage(json("type","cameras","generation",generation,"cameras",cameraInventory(),"selected",selectedCamera).toString());
  }catch(Exception e){status.setText(buildLabel()+"\nCamera list unavailable. Start camera to retry.");}},ContextCompat.getMainExecutor(this));
 }
 void beginExport(JSONObject message,JavaScriptReplyProxy reply){
  long id=message.optLong("id",-1);String data=message.optString("data","");
  if(id<0)return;
  if(pickerOutstanding||pendingExport!=null||!foreground||data.isEmpty()||data.getBytes(StandardCharsets.UTF_8).length>MAX_EXPORT_BYTES){
   reply.postMessage(json("type","export-result","id",id,"status","error","message","Export unavailable or too large. Finish any open export; scores remain on this device.").toString());return;
  }
  String filename=message.optString("filename","cloud-claw-scores.json");
  if(!filename.matches("cloud-claw-[a-z0-9-]+\\.json"))filename="cloud-claw-scores.json";
  pendingExport=new ExportRequest(id,pageEpoch,data,reply);
  try{pickerOutstanding=true;exportPicker.launch(filename);}catch(Exception e){pickerOutstanding=false;finishExport(pendingExport,"error","No document picker available. Scores remain on this device.");}
 }
 void finishExport(ExportRequest request,String result,String message){
  if(request!=pendingExport||request==null)return;pendingExport=null;
  if(!destroyed&&request.page==pageEpoch)request.reply.postMessage(json("type","export-result","id",request.id,"status",result,"message",message).toString());
 }
 void writeExport(Uri uri){
  pickerOutstanding=false;
  ExportRequest request=pendingExport;if(request==null){
   String message="Export interrupted. Retry export; the selected file may be empty. Scores remain on this device.";
   status.setText(buildLabel()+"\n"+message);Toast.makeText(this,message,Toast.LENGTH_LONG).show();return;
  }
  if(uri==null){finishExport(request,"cancelled","");return;}
  fileExecutor.execute(()->{
   String result="saved",message="";
   try{
    ScoreExport.write(getContentResolver().openOutputStream(uri,"wt"),request.data);
   }catch(Exception e){result="error";message="Could not save file. Scores remain on this device.";}
   String outcome=result,detail=message;main.post(()->finishExport(request,outcome,detail));
  });
 }
 synchronized void stopTracking(){active=false;epoch++;deliveries.reset(epoch);if(provider!=null)provider.unbindAll();if(!executor.isShutdown())executor.execute(()->{if(recognizer!=null){recognizer.close();recognizer=null;}});}
 void deliver(long token){if(token!=epoch||!active)return;JSONObject payload=deliveries.take(token);if(payload!=null)send(payload);}
 void fail(long token,Exception e){Log.e("TomkoGame","Tracking error",e);main.post(()->{if(token!=epoch)return;send(json("type","error","generation",clientGeneration,"message","Native tracking failed. Restart the camera."));stopTracking();status.setText("Tracking error · restart camera");});}
 void startTracking(int hands,long token,String requestedCamera,boolean sessionPreview){executor.execute(()->{try{
  if(token!=epoch)return;
  recognizer=GestureRecognizer.createFromOptions(this,GestureRecognizer.GestureRecognizerOptions.builder().setBaseOptions(BaseOptions.builder().setModelAssetPath("gesture_recognizer.task").setDelegate(Delegate.GPU).build()).setNumHands(hands).setMinHandDetectionConfidence(.65f).setMinHandPresenceConfidence(.5f).setMinTrackingConfidence(.5f).setRunningMode(RunningMode.VIDEO).build());
  main.post(()->{if(token!=epoch||!foreground||destroyed)return;var future=ProcessCameraProvider.getInstance(this);future.addListener(()->{try{
   if(token!=epoch||!foreground||destroyed)return;provider=future.get();provider.unbindAll();
   var cameras=provider.getAvailableCameraInfos();
   if(cameras.isEmpty())throw new IllegalStateException("No CameraX cameras available");
   CameraInfo selected=null;
   for(CameraInfo info:cameras)if(cameraId(info).equals(requestedCamera))selected=info;
   if(selected==null&&!requestedCamera.isEmpty()){
    selectedCamera="";send(json("type","cameras","generation",clientGeneration,"cameras",cameraInventory()));
    throw new IllegalStateException("Selected camera unavailable; choose a camera and retry");
   }
   if(selected==null){selected=cameras.get(0);for(CameraInfo info:cameras)if(info.getLensFacing()==CameraSelector.LENS_FACING_FRONT){selected=info;break;}}
   selectedCamera=cameraId(selected);final String chosenId=selectedCamera;
   CameraSelector selector=new CameraSelector.Builder().addCameraFilter(available->{
    ArrayList<CameraInfo> matches=new ArrayList<>();for(CameraInfo info:available)if(cameraId(info).equals(chosenId))matches.add(info);return matches;
   }).build();
   ImageAnalysis a=new ImageAnalysis.Builder().setTargetResolution(new Size(640,480)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build();
   samples=seen=two=0;durations.clear();reportStart=SystemClock.elapsedRealtime();active=true;
   a.setAnalyzer(executor,frame->analyze(frame,token));if(sessionPreview){Preview p=new Preview.Builder().build();p.setSurfaceProvider(preview.getSurfaceProvider());provider.bindToLifecycle(this,selector,p,a);}
   else provider.bindToLifecycle(this,selector,a);
   send(json("type","cameras","generation",clientGeneration,"cameras",cameraInventory(),"selected",selectedCamera));
   send(json("type","ready","generation",clientGeneration));nativeStats="GPU · "+hands+" hand mode · camera "+selectedCamera+" · preview "+(sessionPreview?"on":"off");deliveryStats="Analysis age excludes sensor queue time";updateStatus();
  }catch(Exception e){fail(token,e);}},ContextCompat.getMainExecutor(this));});
 }catch(Exception e){fail(token,e);}});}
 void analyze(ImageProxy frame,long token){Bitmap raw=null,rotated=null;MPImage image=null;try{
  if(!active||token!=epoch||recognizer==null)return;
  // CameraX sensor timestamps are source-dependent; do not invent a clock conversion.
  double capturedAt=now();int w=frame.getWidth(),h=frame.getHeight();var plane=frame.getPlanes()[0];ByteBuffer buffer=plane.getBuffer();
  raw=Bitmap.createBitmap(plane.getRowStride()/4,h,Bitmap.Config.ARGB_8888);raw.copyPixelsFromBuffer(buffer);
  Matrix matrix=new Matrix();matrix.postRotate(frame.getImageInfo().getRotationDegrees());rotated=Bitmap.createBitmap(raw,0,0,w,h,matrix,true);image=new BitmapImageBuilder(rotated).build();
  lastTimestamp=Math.max(SystemClock.uptimeMillis(),lastTimestamp+1);var result=recognizer.recognizeForVideo(image,lastTimestamp);
  JSONArray landmarks=new JSONArray(),gestures=new JSONArray(),handedness=new JSONArray();
  for(var hand:result.landmarks()){JSONArray points=new JSONArray();for(var point:hand)points.put(json("x",point.x(),"y",point.y(),"z",point.z()));landmarks.put(points);}
  for(var hand:result.gestures()){JSONArray categories=new JSONArray();for(var c:hand)categories.put(json("categoryName",c.categoryName(),"score",c.score()));gestures.put(categories);}
  for(var hand:result.handedness()){JSONArray categories=new JSONArray();for(var c:hand)categories.put(json("categoryName",c.categoryName(),"score",c.score()));handedness.put(categories);}
  double processing=now()-capturedAt;long id=++frameId;int generation=clientGeneration;
  JSONObject payload=json("type","result","generation",generation,"id",id,"capturedAt",capturedAt,"width",rotated.getWidth(),"height",rotated.getHeight(),"processingMs",processing,"result",json("landmarks",landmarks,"gestures",gestures,"handedness",handedness));
  if(token!=epoch||!active)return;
  samples++;if(landmarks.length()>0)seen++;if(landmarks.length()>1)two++;durations.add(processing);
  if(deliveries.offer(token,id,payload))main.post(()->deliver(token));
  if(SystemClock.elapsedRealtime()-reportStart>=5000){
   ArrayList<Double> sorted=new ArrayList<>(durations);Collections.sort(sorted);
   String line=String.format(Locale.US,"GPU %.1f/s · processing p50 %.0f p95 %.0f ms · %dx%d",samples*1000.0/(SystemClock.elapsedRealtime()-reportStart),sorted.get(sorted.size()/2),sorted.get((int)((sorted.size()-1)*.95)),w,h);
   Log.i("TomkoGame",line);main.post(()->{if(token==epoch){nativeStats=line;updateStatus();}});
   samples=seen=two=0;durations.clear();reportStart=SystemClock.elapsedRealtime();
  }
  if(durations.size()>300)durations.remove(0);
 }catch(Exception e){fail(token,e);}finally{if(image!=null)image.close();if(rotated!=null&&rotated!=raw)rotated.recycle();if(raw!=null)raw.recycle();frame.close();}}
 @Override protected void onSaveInstanceState(Bundle state){
  state.putBoolean("previewRequested",previewConfiguration.requested());state.putBoolean("previewApplied",previewConfiguration.applied());
  state.putBoolean("pickerOutstanding",pickerOutstanding);state.putBoolean("exportInterrupted",pendingExport!=null||pickerOutstanding);
  super.onSaveInstanceState(state);
 }
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){
  super.onRequestPermissionsResult(code,permissions,results);
  if(code==1)status.setText(buildLabel()+"\n"+(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED?"Camera allowed. Start camera in the game.":"Camera denied. Allow Camera in Android app settings, then retry."));
 }
 @Override protected void onPause(){foreground=false;send(json("type","paused","generation",clientGeneration));stopTracking();if(web!=null)web.onPause();super.onPause();}
 @Override protected void onResume(){super.onResume();foreground=true;if(web!=null)web.onResume();}
 @Override protected void onDestroy(){destroyed=true;pageEpoch++;pendingExport=null;client=null;stopTracking();executor.shutdown();fileExecutor.shutdown();if(web!=null)web.destroy();super.onDestroy();}
}
