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
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.*;

/** Offline device experiment. No frame or landmark persistence. */
public class MainActivity extends ComponentActivity {
 static final String ORIGIN="https://appassets.androidplatform.net";
 final ExecutorService executor=Executors.newSingleThreadExecutor();
 final Handler main=new Handler(Looper.getMainLooper());
 WebView web; PreviewView preview; TextView status; ProcessCameraProvider provider;
 GestureRecognizer recognizer; JavaScriptReplyProxy client;
 final LatestResultQueue<JSONObject> deliveries=new LatestResultQueue<>();
 volatile long epoch=0; volatile boolean active=false;
 long frameId=0,lastTimestamp=0; int clientGeneration; boolean foreground=true;
 int samples=0,seen=0,two=0; long reportStart; ArrayList<Double> durations=new ArrayList<>();
 String buildLabel(){return "Cloud Claw "+BuildConfig.VERSION_NAME+" · "+BuildConfig.SOURCE_COMMIT.substring(0,Math.min(7,BuildConfig.SOURCE_COMMIT.length()))+(BuildConfig.SOURCE_DIRTY?" · local changes":"");}
 static double now(){return SystemClock.elapsedRealtimeNanos()/1e6;}
 static JSONObject json(Object... pairs){JSONObject o=new JSONObject();try{for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);}catch(JSONException e){throw new IllegalArgumentException(e);}return o;}
 static boolean trusted(Uri u){return "https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443);}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
  web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
  LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setBackgroundColor(0xdd10151f);
  Button toggle=new Button(this);toggle.setText("CAMERA VIEW · HIDE");panel.addView(toggle);
  preview=new PreviewView(this);preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
  panel.addView(preview,new LinearLayout.LayoutParams(300,225));
  status=new TextView(this);status.setTextColor(Color.WHITE);status.setTextSize(12);status.setText(buildLabel()+"\nStart camera in the game");panel.addView(status);
  FrameLayout.LayoutParams position=new FrameLayout.LayoutParams(300,-2,Gravity.TOP|Gravity.RIGHT);position.topMargin=65;position.rightMargin=12;root.addView(panel,position);
  toggle.setOnClickListener(v->{boolean show=preview.getVisibility()!=View.VISIBLE;preview.setVisibility(show?View.VISIBLE:View.GONE);toggle.setText(show?"CAMERA VIEW · HIDE":"CAMERA VIEW · SHOW");});setContentView(root);
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
   @Override public void onPageStarted(WebView v,String url,Bitmap icon){stopTracking();client=null;}
   @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){stopTracking();status.setText("Game renderer stopped. Reopen the prototype.");return true;}
  });
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){Log.i("TomkoGameWeb",m.message());return true;}});
  if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){status.setText("This WebView needs updating before native tracking can run.");return;}
  WebViewCompat.addWebMessageListener(web,"TomkoNative",Set.of(ORIGIN),(view,message,origin,isMainFrame,reply)->{
   if(!isMainFrame||!trusted(origin)||message.getType()!=WebMessageCompat.TYPE_STRING)return;
   try{String data=message.getData();if(data==null||data.length()>4096)return;JSONObject o=new JSONObject(data);String type=o.optString("type");
    if(type.equals("start")){
     int hands=o.getInt("hands");double jsTime=o.getDouble("jsTime");int gen=o.getInt("generation");
     if((hands!=1&&hands!=2)||!Double.isFinite(jsTime)||gen<0||!foreground)return;
     stopTracking();client=reply;clientGeneration=gen;double receipt=now();
     send(json("type","clock","generation",gen,"jsTime",jsTime,"nativeTime",receipt));
     if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},1);send(json("type","error","generation",gen,"message","Allow camera permission, then start the camera again."));return;}
     startTracking(hands,epoch);
    }else if(type.equals("sync")&&o.optInt("generation",-1)==clientGeneration){
     double jsTime=o.getDouble("jsTime");if(Double.isFinite(jsTime))send(json("type","clock","generation",clientGeneration,"jsTime",jsTime,"nativeTime",now()));
    }else if(type.equals("stop")&&o.optInt("generation",-1)==clientGeneration){stopTracking();}
    else if(type.equals("ack")&&o.optInt("generation",-1)==clientGeneration){if(deliveries.acknowledge(epoch,o.optLong("id",-1))){long token=epoch;main.post(()->deliver(token));}}
    else if(type.equals("stats")){Log.i("TomkoGameStats",data);}
   }catch(Exception e){Log.w("TomkoGame","Rejected bridge message");}
  });
  web.loadUrl(ORIGIN+"/?hands=manual");
 }
 void send(JSONObject value){if(client!=null)client.postMessage(value.toString());}
 synchronized void stopTracking(){active=false;epoch++;deliveries.reset(epoch);if(provider!=null)provider.unbindAll();executor.execute(()->{if(recognizer!=null){recognizer.close();recognizer=null;}});}
 void deliver(long token){if(token!=epoch||!active)return;JSONObject payload=deliveries.take(token);if(payload!=null)send(payload);}
 void fail(long token,Exception e){Log.e("TomkoGame","Tracking error",e);main.post(()->{if(token!=epoch)return;send(json("type","error","generation",clientGeneration,"message","Native tracking failed. Restart the camera."));stopTracking();status.setText("Tracking error · restart camera");});}
 void startTracking(int hands,long token){executor.execute(()->{try{
  if(token!=epoch)return;
  recognizer=GestureRecognizer.createFromOptions(this,GestureRecognizer.GestureRecognizerOptions.builder().setBaseOptions(BaseOptions.builder().setModelAssetPath("gesture_recognizer.task").setDelegate(Delegate.GPU).build()).setNumHands(hands).setMinHandDetectionConfidence(.65f).setMinHandPresenceConfidence(.5f).setMinTrackingConfidence(.5f).setRunningMode(RunningMode.VIDEO).build());
  main.post(()->{if(token!=epoch||!foreground)return;var future=ProcessCameraProvider.getInstance(this);future.addListener(()->{try{
   if(token!=epoch||!foreground)return;provider=future.get();provider.unbindAll();
   Preview p=new Preview.Builder().build();p.setSurfaceProvider(preview.getSurfaceProvider());
   ImageAnalysis a=new ImageAnalysis.Builder().setTargetResolution(new Size(640,480)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build();
   samples=seen=two=0;durations.clear();reportStart=SystemClock.elapsedRealtime();active=true;
   a.setAnalyzer(executor,frame->analyze(frame,token));provider.bindToLifecycle(this,CameraSelector.DEFAULT_FRONT_CAMERA,p,a);
   send(json("type","ready","generation",clientGeneration));status.setText(buildLabel()+"\nGPU · "+hands+" hand mode");
  }catch(Exception e){fail(token,e);}},ContextCompat.getMainExecutor(this));});
 }catch(Exception e){fail(token,e);}});}
 void analyze(ImageProxy frame,long token){Bitmap raw=null,rotated=null;MPImage image=null;try{
  if(!active||token!=epoch||recognizer==null)return;
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
  if(samples%30==0){ArrayList<Double> sorted=new ArrayList<>(durations);Collections.sort(sorted);String line=String.format(Locale.US,"GPU %.1f/s · p50 %.0f p95 %.0f ms · seen %d/%d · two %d",samples*1000.0/(SystemClock.elapsedRealtime()-reportStart),sorted.get(sorted.size()/2),sorted.get((int)(sorted.size()*.95)),seen,samples,two);Log.i("TomkoGame",line);main.post(()->{if(token==epoch)status.setText(buildLabel()+"\n"+line);});}
  if(durations.size()>2000)durations.remove(0);
 }catch(Exception e){fail(token,e);}finally{if(image!=null)image.close();if(rotated!=null&&rotated!=raw)rotated.recycle();if(raw!=null)raw.recycle();frame.close();}}
 @Override protected void onPause(){foreground=false;send(json("type","paused","generation",clientGeneration));stopTracking();if(web!=null)web.onPause();super.onPause();}
 @Override protected void onResume(){super.onResume();foreground=true;if(web!=null)web.onResume();}
 @Override protected void onDestroy(){stopTracking();executor.shutdown();if(web!=null)web.destroy();super.onDestroy();}
}
