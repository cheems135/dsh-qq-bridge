package io.dsh.companion.overlay;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.*;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.*;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.util.concurrent.*;

/** Native window + projection only. Inference, persona and delivery belong to the plugin. */
public final class CompanionService extends Service {
    static volatile CompanionService live;
    private final Handler main=new Handler(Looper.getMainLooper());
    final ExecutorService network=Executors.newSingleThreadExecutor();
    final ExecutorService speech=Executors.newSingleThreadExecutor();
    private HandlerThread pixelsThread;private Handler pixels;
    private MediaProjection projection;private VirtualDisplay display;private ImageReader reader;
    private WindowManager wm;private WindowManager.LayoutParams position;private View window;
    private TextView caption,detail,history;private Button toggle;
    volatile BridgeClient client;volatile JSONObject session;
    private volatile JSONObject latest;private volatile boolean running,closing,destroyed;
    private volatile boolean contentVisible=true;private volatile long lastCapture;private volatile int sampleMs=2000,maxEdge=768,quality=65;
    private boolean expanded=false,loopBusy=false;private int lastWidth,lastHeight,orbX,orbY;private boolean anchorSaved;
    private String note="正在连接插件",lastMessageIdentity="";private volatile String captureError="";
    private long disconnectedAt,lastSentAt;
    @Override public void onCreate(){super.onCreate();live=this;wm=(WindowManager)getSystemService(WINDOW_SERVICE);pixelsThread=new HandlerThread("companion-latest-frame");pixelsThread.start();pixels=new Handler(pixelsThread.getLooper());}
    @Override public IBinder onBind(Intent i){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        if("stop".equals(intent.getAction())){finishFromUser();return START_NOT_STICKY;}
        if(projection!=null||client!=null){note="已有陪伴正在运行，请先结束再重新连接";render();return START_NOT_STICKY;}
        NotificationManager notifications=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);notifications.createNotificationChannel(new NotificationChannel("companion","屏幕陪伴",NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,CompanionService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notice=new Notification.Builder(this,"companion").setSmallIcon(io.dsh.companion.overlay.R.drawable.companion_icon).setContentTitle("屏幕陪伴正在运行").setContentText("点击停止可结束屏幕采集与陪伴").setOngoing(true).addAction(new Notification.Action.Builder(null,"停止陪伴",stop).build()).build();
        try{
            if(Build.VERSION.SDK_INT>=29)startForeground(73,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);else startForeground(73,notice);
            if(!Settings.canDrawOverlays(this))throw new IOException("悬浮窗权限未开启");
            client=new BridgeClient(intent.getStringExtra("base"));
            MediaProjectionManager manager=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);
            projection=manager.getMediaProjection(intent.getIntExtra("result",0),(Intent)intent.getParcelableExtra("projection"));
            if(projection==null)throw new IOException("屏幕共享授权未就绪");
            projection.registerCallback(new MediaProjection.Callback(){
                @Override public void onStop(){if(!destroyed&&!closing){running=false;latest=null;note="系统已结束共享，正在停止陪伴";render();finishFromUser();}}
                @Override public void onCapturedContentVisibilityChanged(boolean visible){contentVisible=visible;if(!visible)latest=null;}
                @Override public void onCapturedContentResize(int w,int h){pixels.post(()->resizeCapture(w,h));}
            },main);
            DisplayMetrics metrics=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(metrics);initCapture(metrics.widthPixels,metrics.heightPixels,metrics.densityDpi);
            showWindow();String ticket=intent.getStringExtra("ticket"),profile=intent.getStringExtra("profile");
            network.execute(()->{try{client.claim(ticket);if(closing||destroyed)return;JSONObject reply=client.call(BridgeClient.body("start").put("profile",profile==null?"balanced":profile));if(closing||destroyed){JSONObject late=reply.optJSONObject("session");if(late!=null)client.call(BridgeClient.body("stop").put("id",late.optString("id")));return;}adopt(reply.optJSONObject("session"));main.post(()->{note="";render();schedulePoll();});}catch(Exception e){main.post(()->{note=BridgeClient.message(e);running=false;releaseCapture();render();});}});
        }catch(Exception e){note=BridgeClient.message(e);Toast.makeText(this,note,Toast.LENGTH_LONG).show();stopSelf();}
        return START_NOT_STICKY;
    }
    private void initCapture(int width,int height,int dpi){
        int[] size=dimensions(width,height);lastWidth=size[0];lastHeight=size[1];reader=newReader(lastWidth,lastHeight);
        display=projection.createVirtualDisplay("DSH Companion Latest Screen",lastWidth,lastHeight,dpi,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,null,null,pixels);
    }
    private int[] dimensions(int w,int h){double ratio=Math.min(1.0,1024.0/Math.max(w,h));return new int[]{Math.max(2,(int)(w*ratio)),Math.max(2,(int)(h*ratio))};}
    private ImageReader newReader(int w,int h){ImageReader r=ImageReader.newInstance(w,h,PixelFormat.RGBA_8888,2);r.setOnImageAvailableListener(this::acceptImage,pixels);return r;}
    private void resizeCapture(int w,int h){if(destroyed||closing||display==null||w<1||h<1)return;int[] size=dimensions(w,h);if(size[0]==lastWidth&&size[1]==lastHeight)return;
        try{ImageReader old=reader;ImageReader next=newReader(size[0],size[1]);display.setSurface(running?next.getSurface():null);display.resize(size[0],size[1],getResources().getDisplayMetrics().densityDpi);reader=next;lastWidth=size[0];lastHeight=size[1];old.close();latest=null;}catch(Exception e){main.post(()->{captureError="画面尺寸变化后采集失败，请重新连接";render();});}}
    private void acceptImage(ImageReader source){
        try(Image image=source.acquireLatestImage()){
            if(image==null||!running||closing||destroyed||!contentVisible)return;long at=System.currentTimeMillis();if(at-lastCapture<sampleMs)return;lastCapture=at;
            Image.Plane plane=image.getPlanes()[0];int stride=plane.getPixelStride(),row=plane.getRowStride();if(stride!=4)throw new IOException("当前设备的屏幕像素格式不支持");
            int padded=row/stride;Bitmap raw=Bitmap.createBitmap(padded,image.getHeight(),Bitmap.Config.ARGB_8888);raw.copyPixelsFromBuffer(plane.getBuffer());
            Bitmap cropped=Bitmap.createBitmap(raw,0,0,image.getWidth(),image.getHeight());double ratio=Math.min(1.0,(double)maxEdge/Math.max(cropped.getWidth(),cropped.getHeight()));
            Bitmap scaled=Bitmap.createScaledBitmap(cropped,Math.max(1,(int)(cropped.getWidth()*ratio)),Math.max(1,(int)(cropped.getHeight()*ratio)),true);
            ByteArrayOutputStream out=new ByteArrayOutputStream();scaled.compress(Bitmap.CompressFormat.JPEG,quality,out);
            Bitmap tiny=Bitmap.createScaledBitmap(scaled,16,9,true);JSONArray signature=new JSONArray();for(int y=0;y<9;y++)for(int x=0;x<16;x++){int color=tiny.getPixel(x,y);signature.put((Color.red(color)*77+Color.green(color)*150+Color.blue(color)*29)>>8);}
            JSONObject frame=new JSONObject().put("data",Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP)).put("capturedAt",at).put("signature",signature).put("displaySurface","monitor");
            tiny.recycle();if(scaled!=cropped)scaled.recycle();if(cropped!=raw)cropped.recycle();raw.recycle();latest=frame;captureError="";
        }catch(Exception e){if(!destroyed&&!closing)main.post(()->{captureError="采集画面失败："+BridgeClient.message(e);render();});}
    }
    private void adopt(JSONObject next){if(next==null)return;String previous=session==null?"":session.optString("id");session=next;
        if(!previous.equals(next.optString("id")))latest=null;
        boolean wasRunning=running;running="running".equals(next.optString("status"));if(!running)latest=null;
        if(wasRunning!=running)pixels.post(()->{try{if(display!=null)display.setSurface(running&&!closing&&reader!=null?reader.getSurface():null);}catch(Exception e){captureError="系统画面来源已断开，请重新连接";}});
        JSONObject b=next.optJSONObject("budget");if(b!=null){sampleMs=b.optInt("sampleMs",2000);maxEdge=b.optInt("maxEdge",768);quality=b.optInt("quality",65);}
    }
    private void schedulePoll(){if(!destroyed&&!closing)main.postDelayed(this::poll,1000);}
    private void poll(){if(!Settings.canDrawOverlays(this)){finishFromUser();return;}if(loopBusy||destroyed||closing||client==null||session==null)return;loopBusy=true;
        network.execute(()->{try{
            JSONObject next=client.call(BridgeClient.body("status").put("sourceVisible",contentVisible)).optJSONObject("session");if(next==null||!next.optString("id").equals(session.optString("id")))throw new IOException("会话已切换，请回插件重新连接");adopt(next);
            JSONObject frame=latest;long observed=System.currentTimeMillis();
            // Android only emits damaged frames. A live, visible projection may keep
            // the same pixels indefinitely; transport heartbeat is not a new model call.
            if(running&&contentVisible&&projection!=null&&frame!=null&&observed-lastSentAt>=sampleMs){
                JSONObject observedFrame=new JSONObject(frame.toString()).put("sourceCapturedAt",frame.optLong("capturedAt")).put("capturedAt",observed).put("unchangedSource",frame.optLong("capturedAt")<=lastSentAt);
                client.call(BridgeClient.body("frame").put("id",session.optString("id")).put("frame",observedFrame));lastSentAt=observed;
            }
            main.post(()->{disconnectedAt=0;note="";loopBusy=false;render();if("stopped".equals(session.optString("status"))||"ended".equals(session.optString("status"))){stopSelf();return;}schedulePoll();});
        }catch(Exception e){main.post(()->{loopBusy=false;if(disconnectedAt==0)disconnectedAt=System.currentTimeMillis();note="连接待核实："+BridgeClient.message(e);render();if(System.currentTimeMillis()-disconnectedAt>30000){running=false;releaseCapture();note="插件连接已中断，屏幕采集已停止；请回插件重新连接";render();}else schedulePoll();});}});
    }
    private JSONObject request(String action) throws Exception {if(session==null)throw new IOException("插件尚未连接");return BridgeClient.body(action).put("id",session.getString("id"));}
    void input(String text,java.util.function.Consumer<String> result){if(closing||destroyed||client==null){result.accept("陪伴已结束");return;}network.execute(()->{try{client.call(request("input").put("text",text));main.post(()->result.accept(""));}catch(Exception e){main.post(()->result.accept(BridgeClient.message(e)));}});}
    void transcribe(byte[] wav,java.util.function.BiConsumer<String,String> result){if(closing||destroyed||client==null){result.accept("","陪伴已结束");return;}speech.execute(()->{try{JSONObject audio=new JSONObject().put("mediaType","audio/wav").put("data",Base64.encodeToString(wav,Base64.NO_WRAP));JSONObject reply=client.call(request("transcribe").put("audio",audio));main.post(()->result.accept(reply.optString("text"),""));}catch(Exception e){main.post(()->result.accept("",BridgeClient.message(e)));}});}
    private void changeState(){if(session==null||closing)return;String action=running?"pause":"resume";toggle.setEnabled(false);
        network.execute(()->{try{adopt(client.call(request(action)).optJSONObject("session"));main.post(()->{note="";toggle.setEnabled(true);render();});}catch(Exception e){main.post(()->{note=BridgeClient.message(e);toggle.setEnabled(true);render();});}});}
    private void finishFromUser(){if(closing||destroyed)return;closing=true;running=false;latest=null;releaseCapture();note="屏幕采集已停止，正在确认结束陪伴";render();
        if(client==null||session==null){stopSelf();return;}
        // A local close always releases pixels; a failed network close remains visible for retry.
        network.execute(()->{try{client.call(request("disconnect"));main.post(this::stopSelf);}catch(Exception e){main.post(()->{closing=false;note="采集已停止，插件结束状态未确认："+BridgeClient.message(e);render();});}});
    }
    private void releaseCapture(){if(pixels==null)return;pixels.post(()->{latest=null;if(display!=null){display.release();display=null;}if(reader!=null){reader.close();reader=null;}if(projection!=null){MediaProjection p=projection;projection=null;p.stop();}});}
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private GradientDrawable background(int color,int radius){GradientDrawable b=new GradientDrawable();b.setColor(color);b.setCornerRadius(dp(radius));b.setStroke(dp(1),Color.rgb(199,225,244));return b;}
    private Button button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setTextColor(Color.rgb(36,65,91));b.setTextSize(14);b.setMinHeight(dp(44));b.setAllCaps(false);b.setBackground(background(Color.WHITE,14));b.setOnClickListener(v->action.run());return b;}
    private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.rgb(36,65,91));t.setPadding(dp(8),dp(6),dp(8),dp(6));return t;}
    private void addButton(LinearLayout parent,Button b){LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(46),1);lp.setMargins(dp(3),dp(3),dp(3),dp(3));parent.addView(b,lp);}
    private void showWindow(){if(position==null){DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);position=new WindowManager.LayoutParams(dp(64),dp(64),WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);position.gravity=Gravity.TOP|Gravity.LEFT;position.x=m.widthPixels-dp(78);position.y=m.heightPixels/3;}
        if(window!=null){if(expanded&&window instanceof Orb){orbX=position.x;orbY=position.y;anchorSaved=true;}else if(!expanded&&!(window instanceof Orb)&&anchorSaved){position.x=orbX;position.y=orbY;}wm.removeView(window);window=null;}
        if(!expanded){Orb orb=new Orb();orb.setContentDescription("屏幕陪伴悬浮球，点击展开，长按输入");orb.setOnClickListener(v->{expanded=true;showWindow();});orb.setOnLongClickListener(v->{openInput();return true;});installDrag(orb);window=orb;position.width=dp(64);position.height=dp(64);}
        else {
            LinearLayout panel=new LinearLayout(this);panel.setOrientation(1);panel.setPadding(dp(12),dp(12),dp(12),dp(12));panel.setBackground(background(CompanionUi.SURFACE,22));panel.setElevation(dp(10));
            LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);TextView title=text("陪你看",18);title.setTypeface(null,android.graphics.Typeface.BOLD);header.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));installDrag(title);Button fold=button("−",()->{expanded=false;showWindow();});fold.setContentDescription("收起为悬浮球");Button close=button("×",this::finishFromUser);close.setContentDescription("关闭并停止识屏");LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(dp(44),dp(44));hp.setMargins(dp(4),0,dp(4),0);header.addView(fold,hp);header.addView(close,new LinearLayout.LayoutParams(hp));panel.addView(header);
            caption=text("",15);detail=text("",12);LinearLayout body=new LinearLayout(this);body.setOrientation(1);body.addView(caption);body.addView(detail);
            ScrollView scroll=new ScrollView(this);history=text("",14);history.setTextIsSelectable(true);history.setLineSpacing(dp(4),1);history.setPadding(dp(12),dp(12),dp(12),dp(12));history.setBackground(background(Color.WHITE,14));LinearLayout.LayoutParams historyLp=new LinearLayout.LayoutParams(-1,-2);historyLp.topMargin=dp(12);historyLp.bottomMargin=dp(8);body.addView(history,historyLp);scroll.addView(body);panel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
            LinearLayout entry=new LinearLayout(this);Button input=button("和她说点什么 · 打字 / 语音",this::openInput);input.setBackground(background(CompanionUi.BLUE,14));input.setTextColor(Color.WHITE);addButton(entry,input);panel.addView(entry);
            LinearLayout actions=new LinearLayout(this);toggle=button("暂停",this::changeState);addButton(actions,toggle);addButton(actions,button("结束陪伴",this::finishFromUser));panel.addView(actions);window=panel;position.width=Math.min(dp(352),screenWidth()-dp(24));DisplayMetrics bounds=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(bounds);position.height=Math.min(dp(466),bounds.heightPixels-dp(72));
        }
        lastMessageIdentity="";clamp();try{wm.addView(window,position);window.post(()->{clamp();if(window!=null)wm.updateViewLayout(window,position);});render();}catch(Exception e){Toast.makeText(this,"无法显示悬浮球："+BridgeClient.message(e),Toast.LENGTH_LONG).show();finishFromUser();}
    }
    void inputVisible(boolean visible){if(window!=null)window.setVisibility(visible?View.GONE:View.VISIBLE);}
    private void openInput(){inputVisible(true);startActivity(new Intent(this,InputActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
    private int screenWidth(){DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);return m.widthPixels;}
    private void clamp(){DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);int w=position.width>0?position.width:window==null?dp(64):window.getMeasuredWidth();int h=position.height>0?position.height:window==null?dp(400):Math.max(dp(300),window.getMeasuredHeight());position.x=Math.max(dp(4),Math.min(position.x,m.widthPixels-w-dp(4)));position.y=Math.max(dp(28),Math.min(position.y,m.heightPixels-h-dp(32)));}
    private void installDrag(View handle){handle.setClickable(true);handle.setOnTouchListener(new View.OnTouchListener(){float x,y;int startX,startY;boolean drag;
        public boolean onTouch(View v,android.view.MotionEvent e){switch(e.getActionMasked()){
            case MotionEvent.ACTION_DOWN:x=e.getRawX();y=e.getRawY();startX=position.x;startY=position.y;drag=false;return false;
            case MotionEvent.ACTION_MOVE:if(Math.hypot(e.getRawX()-x,e.getRawY()-y)>dp(8))drag=true;if(drag){v.cancelLongPress();position.x=startX+Math.round(e.getRawX()-x);position.y=startY+Math.round(e.getRawY()-y);clamp();if(expanded){orbX=position.x+Math.max(0,position.width-dp(64));orbY=position.y;anchorSaved=true;}wm.updateViewLayout(window,position);return true;}return false;
            case MotionEvent.ACTION_UP:case MotionEvent.ACTION_CANCEL:if(drag){v.setPressed(false);return true;}return false;
        }return false;}});}
    private void render(){if(window==null)return;window.invalidate();if(!expanded)window.setContentDescription("屏幕陪伴："+(!note.isEmpty()?note:running?"正在观察":"已暂停")+"，点击展开，长按输入");if(!expanded||caption==null)return;
        String state=session==null?"正在连接":session.optString("status");String label="running".equals(state)?session.optBoolean("analyzing")?"正在理解画面":"正在观察":"paused".equals(state)?"陪伴已暂停":"error".equals(state)?"识屏需要重新连接":"正在连接";
        caption.setText(!note.isEmpty()?note:!captureError.isEmpty()?captureError:session!=null&&!session.optString("sourceWait").isEmpty()?session.optString("sourceWait"):label);long at=session==null?0:session.optLong("observedAt");detail.setText("共享手机画面\n"+(at>0?"最近画面 "+android.text.format.DateFormat.format("HH:mm:ss",at):"等待第一张共享画面")+(session==null?"":" · 理解 "+session.optInt("analyses")+" 次"));
        StringBuilder log=new StringBuilder();JSONArray messages=session==null?null:session.optJSONArray("messages");if(messages!=null)for(int i=Math.max(0,messages.length()-5);i<messages.length();i++){JSONObject m=messages.optJSONObject(i);if(m!=null)log.append("user".equals(m.optString("role"))?"你：":"陪伴：").append(m.optString("text")).append("\n\n");}
        if(log.length()==0)log.append("只处理最新画面，有值得聊的再开口\n也可以点下面输入你的问题");String value=log.toString();if(!value.equals(lastMessageIdentity)){history.setText(value);lastMessageIdentity=value;}
        toggle.setText(running?"暂停陪看":"继续陪看");toggle.setEnabled(session!=null&&!closing&&projection!=null);
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration c){super.onConfigurationChanged(c);if(window!=null)showWindow();}
    @Override public void onDestroy(){destroyed=true;running=false;latest=null;main.removeCallbacksAndMessages(null);releaseCapture();if(window!=null){try{wm.removeView(window);}catch(Exception ignored){}window=null;}if(pixelsThread!=null)pixelsThread.quitSafely();network.shutdownNow();speech.shutdownNow();if(client!=null)client.token="";if(live==this)live=null;stopForeground(true);super.onDestroy();}
    private final class Orb extends View {
        final Paint p=new Paint(3);Orb(){super(CompanionService.this);setElevation(dp(8));}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);float scale=getWidth()/64f;canvas.save();canvas.scale(scale,scale);p.setColor(Color.rgb(225,242,255));canvas.drawCircle(32,32,30,p);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1.5f);p.setColor(Color.rgb(151,195,229));canvas.drawCircle(32,32,30,p);p.setStyle(Paint.Style.FILL);
            p.setColor(Color.rgb(71,143,203));Path whale=new Path();whale.moveTo(13,35);whale.cubicTo(13,25,26,20,37,26);whale.cubicTo(44,30,47,28,54,24);whale.cubicTo(55,32,50,39,43,42);whale.cubicTo(41,51,31,53,27,46);whale.cubicTo(18,45,13,42,13,35);canvas.drawPath(whale,p);p.setColor(Color.rgb(36,65,91));canvas.drawCircle(23,32,2,p);p.setColor(!note.isEmpty()?Color.rgb(192,126,63):running?Color.rgb(57,148,119):Color.rgb(121,149,173));canvas.drawCircle(51,12,5,p);canvas.restore();}
    }
}
