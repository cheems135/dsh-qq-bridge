package io.dsh.companion.overlay;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.widget.*;

/** Shared presentation only; capture and connection behavior stay in their owners. */
final class CompanionUi {
    static final int INK=Color.rgb(35,61,82), MUTED=Color.rgb(82,106,128), BLUE=Color.rgb(45,111,168), SURFACE=Color.rgb(244,248,252), LINE=Color.rgb(197,218,235);
    static int dp(Context c,float n){return Math.round(n*c.getResources().getDisplayMetrics().density);}
    static GradientDrawable card(Context c,int color,int radius){GradientDrawable b=new GradientDrawable();b.setColor(color);b.setCornerRadius(dp(c,radius));b.setStroke(dp(c,1),LINE);return b;}
    static void text(TextView v,int size,boolean heading){v.setTextColor(heading?INK:MUTED);v.setTextSize(size);v.setLineSpacing(dp(v.getContext(),3),1);if(heading)v.setTypeface(null,Typeface.BOLD);}
    static void button(Button b,boolean primary){Context c=b.getContext();b.setAllCaps(false);b.setTextSize(15);b.setMinHeight(dp(c,48));b.setTextColor(primary?Color.WHITE:INK);b.setBackground(card(c,primary?BLUE:Color.WHITE,14));b.setPadding(dp(c,12),dp(c,10),dp(c,12),dp(c,10));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(c,12);b.setLayoutParams(lp);}
    static TextView label(Context c,String name){TextView v=new TextView(c);v.setText(name);text(v,14,true);v.setPadding(0,dp(c,18),0,dp(c,8));return v;}
}
