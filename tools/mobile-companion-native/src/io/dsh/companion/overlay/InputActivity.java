package io.dsh.companion.overlay;

import android.Manifest;
import android.app.*;
import android.os.*;
import android.graphics.Color;
import android.media.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.*;

/** Foreground microphone input avoids background microphone restrictions. */
public final class InputActivity extends Activity {
    private EditText draft;private TextView status;private Button mic,send;
    private volatile boolean recording,discard,transcribing;
    private volatile AudioRecord recorder;private Thread worker;
    private CompanionService owner;private String sessionId;
    @Override public void onCreate(Bundle state){super.onCreate(state);owner=CompanionService.live;sessionId=owner==null||owner.session==null?"":owner.session.optString("id");
        LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(CompanionUi.dp(this,24),CompanionUi.dp(this,24),CompanionUi.dp(this,24),CompanionUi.dp(this,24));box.setBackgroundColor(CompanionUi.SURFACE);
        TextView title=new TextView(this);title.setText("和她一起看");title.setTextSize(24);title.setTextColor(Color.rgb(36,65,91));CompanionUi.text(title,26,true);box.addView(title);
        status=new TextView(this);status.setText("屏幕共享会继续运行；语音转成文字后，你可以修改再发送");CompanionUi.text(status,14,false);status.setPadding(0,CompanionUi.dp(this,12),0,CompanionUi.dp(this,20));status.setAccessibilityLiveRegion(1);box.addView(status);
        draft=new EditText(this);draft.setHint("想对她说什么？");draft.setMinLines(5);draft.setTextSize(17);draft.setTextColor(CompanionUi.INK);draft.setHintTextColor(CompanionUi.MUTED);draft.setBackground(CompanionUi.card(this,Color.WHITE,18));draft.setPadding(CompanionUi.dp(this,16),CompanionUi.dp(this,16),CompanionUi.dp(this,16),CompanionUi.dp(this,16));draft.setGravity(Gravity.TOP);draft.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);box.addView(draft,new LinearLayout.LayoutParams(-1,CompanionUi.dp(this,188)));if(state!=null)draft.setText(state.getString("draft",""));
        mic=new Button(this);mic.setText("按住说话 · 松开转文字");CompanionUi.button(mic,false);box.addView(mic);mic.setOnTouchListener((v,e)->{switch(e.getActionMasked()){case MotionEvent.ACTION_DOWN:startRecording();return true;case MotionEvent.ACTION_UP:v.performClick();stopRecording(false);return true;case MotionEvent.ACTION_CANCEL:stopRecording(true);return true;}return false;});
        send=new Button(this);send.setText("发送");CompanionUi.button(send,true);box.addView(send);send.setOnClickListener(v->send());Button back=new Button(this);back.setText("返回刚才的应用");back.setOnClickListener(v->finish());CompanionUi.button(back,false);box.addView(back);ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(box);setContentView(scroll);box.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(CompanionUi.dp(this,24)+bars.left,CompanionUi.dp(this,24)+bars.top,CompanionUi.dp(this,24)+bars.right,CompanionUi.dp(this,24)+bars.bottom);}else v.setPadding(CompanionUi.dp(this,24)+insets.getSystemWindowInsetLeft(),CompanionUi.dp(this,24)+insets.getSystemWindowInsetTop(),CompanionUi.dp(this,24)+insets.getSystemWindowInsetRight(),CompanionUi.dp(this,24)+insets.getSystemWindowInsetBottom());return insets;});
        if(!current()){status.setText("陪伴尚未连接，请先回插件连接悬浮球");send.setEnabled(false);mic.setEnabled(false);}
    }
    private boolean current(){return owner!=null&&owner==CompanionService.live&&owner.session!=null&&sessionId.equals(owner.session.optString("id"))&&"running".equals(owner.session.optString("status"));}
    private void send(){String value=draft.getText().toString().trim();if(value.isEmpty()||transcribing||recording)return;if(!current()){status.setText("陪伴会话已变化，请重新打开输入窗口");return;}send.setEnabled(false);status.setText("正在提交…");owner.input(value,error->{if(isFinishing()||isDestroyed())return;if(error.isEmpty()){draft.setText("");finish();}else{status.setText(error);send.setEnabled(true);}});}
    private void startRecording(){
        if(recording||transcribing||!current())return;if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=0){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},21);return;}
        try{int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);if(min<=0)throw new IOException("麦克风格式不支持");
            AudioRecord r=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(min,4096));recorder=r;if(r.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("麦克风未就绪");
            discard=false;r.startRecording();recording=true;mic.setText("正在听 · 松开结束");status.setText("录音中，最长45秒；不会自动发送");send.setEnabled(false);
            worker=new Thread(()->{ByteArrayOutputStream pcm=new ByteArrayOutputStream();byte[] buffer=new byte[3200];String error="";
                try{while(recording&&pcm.size()<16000*2*45){int count=r.read(buffer,0,Math.min(buffer.length,16000*2*45-pcm.size()));if(count<0)throw new IOException("麦克风读取失败");if(count>0)pcm.write(buffer,0,count);}}catch(Exception e){if(recording)error=BridgeClient.message(e);}finally{recording=false;try{r.stop();}catch(Exception ignored){}r.release();if(recorder==r)recorder=null;}
                final String failure=error;byte[] data=pcm.toByteArray();runOnUiThread(()->{mic.setText("按住说话 · 松开转文字");if(discard||isFinishing()||isDestroyed()){send.setEnabled(true);return;}if(!failure.isEmpty()||data.length<3200){status.setText(failure.isEmpty()?"录音太短，请再试一次":failure);send.setEnabled(true);return;}recognize(wav(data));});
            },"companion-microphone");worker.start();
        }catch(Exception e){recording=false;if(recorder!=null){recorder.release();recorder=null;}status.setText(BridgeClient.message(e));send.setEnabled(true);}
    }
    private void stopRecording(boolean cancel){if(!recording)return;discard=cancel;recording=false;AudioRecord r=recorder;if(r!=null)try{r.stop();}catch(Exception ignored){}}
    private void recognize(byte[] data){if(!current()){status.setText("会话已改变，录音未发送识别");send.setEnabled(true);return;}transcribing=true;mic.setEnabled(false);send.setEnabled(false);draft.setEnabled(false);status.setText("正在转成文字，识屏继续运行…");
        owner.transcribe(data,(text,error)->{if(isFinishing()||isDestroyed())return;transcribing=false;mic.setEnabled(true);send.setEnabled(true);draft.setEnabled(true);if(!current()){status.setText("陪伴会话已改变，未使用旧录音");return;}if(error.isEmpty()){draft.append((draft.length()>0?"\n":"")+text);status.setText("已转写，修改或确认后再发送");}else status.setText(error);});
    }
    static byte[] wav(byte[] pcm){ByteBuffer b=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN);b.put(new byte[]{'R','I','F','F'}).putInt(36+pcm.length).put(new byte[]{'W','A','V','E','f','m','t',' '}).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put(new byte[]{'d','a','t','a'}).putInt(pcm.length).put(pcm);return b.array();}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==21)status.setText(results.length>0&&results[0]==0?"麦克风已授权，请重新按住说话":"麦克风未授权，仍可直接打字");}
    @Override protected void onSaveInstanceState(Bundle out){out.putString("draft",draft.getText().toString());super.onSaveInstanceState(out);}
    @Override protected void onResume(){super.onResume();if(owner!=null)owner.inputVisible(true);}
    @Override protected void onStop(){if(owner!=null)owner.inputVisible(false);super.onStop();}
    @Override protected void onPause(){stopRecording(true);super.onPause();}
}
