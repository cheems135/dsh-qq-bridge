package io.dsh.companion.overlay;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.provider.Settings;
import android.media.projection.MediaProjectionManager;
import android.graphics.Color;
import android.widget.*;

public final class ConnectActivity extends Activity {
    private TextView status; private Button connect;private Spinner profile;private Spinner scope;
    private String base="",ticket="";private boolean busy;
    @Override public void onCreate(Bundle state){super.onCreate(state);readLink(getIntent());
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(CompanionUi.dp(this,24),CompanionUi.dp(this,28),CompanionUi.dp(this,24),CompanionUi.dp(this,24));layout.setBackgroundColor(CompanionUi.SURFACE);
        TextView title=new TextView(this);title.setText("屏幕陪伴");title.setTextSize(28);title.setTextColor(Color.rgb(36,65,91));CompanionUi.text(title,28,true);layout.addView(title);
        TextView intro=new TextView(this);intro.setText("让陪伴球留在其他应用上方\n\n组件只负责悬浮球和系统屏幕共享，模型与 API 设置继续使用 QQ 桥接插件。\n\n首次连接需要允许悬浮窗，并选择要共享的屏幕或应用。停止后会立即释放采集。\n");CompanionUi.text(intro,15,false);intro.setPadding(0,CompanionUi.dp(this,16),0,0);layout.addView(intro);
        layout.addView(CompanionUi.label(this,"共享范围"));scope=new Spinner(this);scope.setMinimumHeight(CompanionUi.dp(this,48));scope.setBackground(CompanionUi.card(this,Color.WHITE,12));scope.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"整个手机屏幕 · 跨应用陪伴（推荐）","单个应用 · 切出该应用时等待"}));layout.addView(scope);layout.addView(CompanionUi.label(this,"观察频率"));profile=new Spinner(this);profile.setMinimumHeight(CompanionUi.dp(this,48));profile.setBackground(CompanionUi.card(this,Color.WHITE,12));profile.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"省流 · 约12秒分析","均衡 · 约8秒分析","细看 · 约6秒分析"}));profile.setSelection(1);layout.addView(profile);status=new TextView(this);CompanionUi.text(status,14,false);status.setPadding(0,CompanionUi.dp(this,18),0,CompanionUi.dp(this,8));status.setAccessibilityLiveRegion(1);layout.addView(status);connect=new Button(this);connect.setText("授权并开始陪伴");CompanionUi.button(connect,true);layout.addView(connect);
        connect.setOnClickListener(v->begin());
        Button paste=new Button(this);paste.setText("粘贴插件连接信息（打不开时使用）");CompanionUi.button(paste,false);layout.addView(paste);paste.setOnClickListener(v->{try{android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(!clipboard.hasPrimaryClip())return;String value=clipboard.getPrimaryClip().getItemAt(0).coerceToText(this).toString();readLink(new Intent(Intent.ACTION_VIEW,Uri.parse(value.trim())));update();}catch(Exception e){status.setText("没有读到有效连接信息，请回插件重新复制");}});
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(layout);setContentView(scroll);layout.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());v.setPadding(CompanionUi.dp(this,24)+bars.left,CompanionUi.dp(this,28)+bars.top,CompanionUi.dp(this,24)+bars.right,CompanionUi.dp(this,24)+bars.bottom);}return insets;});update();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readLink(intent);update();}
    private void readLink(Intent intent){
        base="";ticket="";Uri uri=intent.getData();if(uri==null||!"dshcompanion".equals(uri.getScheme())||!"connect".equals(uri.getHost()))return;
        try{Uri args=Uri.parse("http://local/?"+uri.getEncodedFragment());String b=args.getQueryParameter("base"),t=args.getQueryParameter("ticket");new BridgeClient(b);if(t==null||!t.matches("[A-Za-z0-9_-]{43}"))return;base=b;ticket=t;}catch(Exception ignored){}
    }
    private void update(){connect.setEnabled(!busy&&!ticket.isEmpty());status.setText(ticket.isEmpty()?"请先回 QQ 桥接插件，点击“连接跨应用悬浮球”。":"连接信息已收到，点击下面按钮继续");}
    private void begin(){
        if(busy)return;
        if(!Settings.canDrawOverlays(this)){startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())),10);return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=0){requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},12);return;}
        requestProjection();
    }
    private void requestProjection(){busy=true;connect.setEnabled(false);status.setText("请在系统窗口选择共享范围");MediaProjectionManager m=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);if(Build.VERSION.SDK_INT>=34&&scope.getSelectedItemPosition()==0)startActivityForResult(m.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay()),11);else startActivityForResult(m.createScreenCaptureIntent(),11);}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==12)requestProjection();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==10){if(Settings.canDrawOverlays(this))begin();else status.setText("还未开启悬浮窗权限，可以稍后再试");}
        if(request==11){busy=false;connect.setEnabled(true);if(result!=RESULT_OK||data==null){status.setText("屏幕共享已取消，没有启动识屏或模型调用");return;}
            Intent service=new Intent(this,CompanionService.class).setAction("start").putExtra("base",base).putExtra("profile",new String[]{"saver","balanced","detail"}[profile.getSelectedItemPosition()]).putExtra("ticket",ticket).putExtra("result",result).putExtra("projection",data);
            startForegroundService(service);status.setText("正在连接插件，请查看悬浮球状态");ticket="";connect.setEnabled(false);
        }
    }
}
