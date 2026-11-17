package io.dsh.companion.overlay;

import android.net.Uri;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Only a loopback plugin endpoint. Tokens stay in memory and never enter logs. */
final class BridgeClient {
    final String base;
    volatile String token = "";
    BridgeClient(String base) throws Exception {
        URI u = new URI(base);
        if (!"http".equals(u.getScheme()) || !"127.0.0.1".equals(u.getHost()) || u.getPort()<1 || u.getPort()>65535 || u.getRawUserInfo()!=null || (u.getPath()!=null&&!u.getPath().isEmpty()) || u.getQuery()!=null || u.getFragment()!=null)
            throw new IOException("只支持连接本机 DSH Go 插件");
        this.base = base;
    }
    static JSONObject body(String action) throws JSONException { return new JSONObject().put("action", action); }
    JSONObject call(JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL(base+"/im-bridge/mobile-overlay").openConnection();
        c.setConnectTimeout(5000);c.setReadTimeout("transcribe".equals(body.optString("action"))?65000:10000);
        c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setDoOutput(true);
        c.setRequestProperty("Content-Type","application/json; charset=utf-8");
        if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
        byte[] data=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(data.length);
        try {
            try(OutputStream out=c.getOutputStream()){out.write(data);}
            int status=c.getResponseCode();InputStream raw=status<400?c.getInputStream():c.getErrorStream();
            if(raw==null)throw new IOException("插件没有返回结果（HTTP "+status+"）");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;
            try(InputStream in=raw){while((n=in.read(b))!=-1){if(bytes.size()+n>262144)throw new IOException("插件返回过大");bytes.write(b,0,n);}}
            JSONObject reply=new JSONObject(bytes.toString("UTF-8"));
            if(status>=400||reply.has("error"))throw new IOException(reply.optString("error","插件连接失败"));
            return reply;
        } finally { c.disconnect(); }
    }
    void claim(String ticket) throws Exception { token=call(body("claim").put("ticket",ticket)).getString("token"); }
    static String message(Throwable e){String s=e.getMessage();return s==null?"连接暂时不可用，请回插件重新连接":s.substring(0,Math.min(s.length(),240));}
}
