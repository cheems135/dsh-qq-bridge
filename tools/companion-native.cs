using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace DSHCompanion {
 public static class NativeScreen {
  public static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=4000000 };
  public delegate bool EnumProc(IntPtr hwnd,IntPtr param);
  [StructLayout(LayoutKind.Sequential)]public struct Rect {public int Left,Top,Right,Bottom;}
  [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr param);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool PrintWindow(IntPtr hwnd,IntPtr hdc,uint flags);
  [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
  [DllImport("user32.dll")]static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")]public static extern bool SetWindowDisplayAffinity(IntPtr hwnd,uint affinity);
  public static string Text(IDictionary<string,object> d,string k){return d!=null&&d.ContainsKey(k)?Convert.ToString(d[k]):"";}
  public static Dictionary<string,object> Obj(object o){return o as Dictionary<string,object>??new Dictionary<string,object>();}
  static int Number(IDictionary<string,object> d,string k,int fallback){int n;return Int32.TryParse(Text(d,k),out n)?n:fallback;}
  public static object Sources(){var rows=new List<object>();EnumWindows(delegate(IntPtr h,IntPtr p){if(IsWindowVisible(h)&&!IsIconic(h)){var text=new StringBuilder(512);GetWindowText(h,text,text.Capacity);if(text.Length>0&&!text.ToString().StartsWith("DSH 陪伴"))rows.Add(new {windowId=h.ToInt64().ToString(),title=text.ToString()});}return true;},IntPtr.Zero);return new {ok=true,windows=rows};}
  public static object Capture(Dictionary<string,object> args){
   var desktop=OpenInputDesktop(0,false,0x0100);if(desktop==IntPtr.Zero)throw new Exception("桌面不可读取，请解锁 Windows 后再开始识屏");CloseDesktop(desktop);
   var bounds=SystemInformation.VirtualScreen;IntPtr sourceWindow=IntPtr.Zero;string id=Text(args,"windowId"),title="当前桌面";
   if(id.Length>0){long value;if(!Int64.TryParse(id,out value))throw new Exception("窗口编号无效，请重新选择");var hwnd=new IntPtr(value);sourceWindow=hwnd;Rect r;if(!IsWindowVisible(hwnd)||IsIconic(hwnd)||!GetWindowRect(hwnd,out r))throw new Exception("所选窗口已关闭、隐藏或最小化，请恢复窗口或重新选择");bounds=Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom);var t=new StringBuilder(512);GetWindowText(hwnd,t,t.Capacity);title=t.ToString();}
   if(bounds.Width<2||bounds.Height<2||bounds.Width>32000||bounds.Height>16000)throw new Exception("没有取得有效的可见桌面区域");
   int edge=Math.Max(256,Math.Min(1920,Number(args,"maxEdge",1024))),quality=Math.Max(35,Math.Min(85,Number(args,"quality",70)));double ratio=Math.Min(1,(double)edge/Math.Max(bounds.Width,bounds.Height));int width=Math.Max(1,(int)(bounds.Width*ratio)),height=Math.Max(1,(int)(bounds.Height*ratio));
   using(var full=new Bitmap(bounds.Width,bounds.Height))using(var graphics=Graphics.FromImage(full)){
    if(sourceWindow==IntPtr.Zero)graphics.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size);else{var hdc=graphics.GetHdc();try{if(!PrintWindow(sourceWindow,hdc,2))throw new Exception("这个窗口暂不支持直接取图，请恢复窗口或改选整个屏幕；没有截取其他应用代替");}finally{graphics.ReleaseHdc(hdc);}}
    using(var small=new Bitmap(width,height))using(var draw=Graphics.FromImage(small))using(var thumb=new Bitmap(16,9))using(var tg=Graphics.FromImage(thumb))using(var memory=new MemoryStream()){
     draw.InterpolationMode=InterpolationMode.HighQualityBilinear;draw.DrawImage(full,0,0,width,height);tg.DrawImage(small,0,0,16,9);var signature=new List<int>();for(int y=0;y<9;y++)for(int x=0;x<16;x++){var p=thumb.GetPixel(x,y);signature.Add((p.R+p.G+p.B)/3);}
     var codec=ImageCodecInfo.GetImageEncoders().First(c=>c.MimeType=="image/jpeg");using(var options=new EncoderParameters(1)){options.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)quality);small.Save(memory,codec,options);}
     return new {ok=true,data=Convert.ToBase64String(memory.ToArray()),signature=signature,width=width,height=height,mediaType="image/jpeg",capturedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),sourceLabel=title,audioState="not-captured",coverage=id.Length>0?"所选窗口直接返回的真实画面；不截取其他应用代替；未采集系统声音":"当前桌面的真实画面；未采集系统声音"};
    }
   }
  }
  public static void Serve(){SetProcessDPIAware();string line;while((line=Console.ReadLine())!=null){string id="";try{var request=Json.Deserialize<Dictionary<string,object>>(line);id=Text(request,"id");var result=Text(request,"action")=="sources"?Sources():Capture(request);Console.WriteLine(Json.Serialize(new {id=id,result=result}));}catch(Exception error){Console.WriteLine(Json.Serialize(new {id=id,error=error.Message}));}}}
 }


 public static class CompanionStyle {
  public static readonly Color Ink=Color.FromArgb(36,65,91),Muted=Color.FromArgb(84,107,130),Blue=Color.FromArgb(47,112,177),Line=Color.FromArgb(215,231,244),Surface=Color.FromArgb(246,251,255);
  public static GraphicsPath Round(RectangleF b,float r){var p=new GraphicsPath();float d=Math.Min(r*2,Math.Min(b.Width,b.Height));p.AddArc(b.X,b.Y,d,d,180,90);p.AddArc(b.Right-d,b.Y,d,d,270,90);p.AddArc(b.Right-d,b.Bottom-d,d,d,0,90);p.AddArc(b.X,b.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
 }
 public class CompanionButton:Button {
  bool hover,down;public bool Primary;
  public CompanionButton(){FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;DoubleBuffered=true;UseVisualStyleBackColor=false;BackColor=Color.White;ForeColor=CompanionStyle.Ink;}
  protected override void OnMouseEnter(EventArgs e){hover=true;Invalidate();base.OnMouseEnter(e);}protected override void OnMouseLeave(EventArgs e){hover=false;down=false;Invalidate();base.OnMouseLeave(e);}
  protected override void OnMouseDown(MouseEventArgs e){down=true;Invalidate();base.OnMouseDown(e);}protected override void OnMouseUp(MouseEventArgs e){down=false;Invalidate();base.OnMouseUp(e);}
  protected override void OnPaint(PaintEventArgs e){var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;g.Clear(Parent==null?CompanionStyle.Surface:Parent.BackColor);var color=!Enabled?Color.FromArgb(231,239,246):Primary?(down?Color.FromArgb(29,83,141):hover?Color.FromArgb(39,96,157):CompanionStyle.Blue):(down?Color.FromArgb(221,236,249):hover?Color.FromArgb(233,244,253):BackColor);using(var path=CompanionStyle.Round(new RectangleF(1,1,Width-3,Height-3),10))using(var b=new SolidBrush(color))using(var pen=new Pen(Primary?color:CompanionStyle.Line)){g.FillPath(b,path);g.DrawPath(pen,path);}TextRenderer.DrawText(g,Text,Font,ClientRectangle,!Enabled?CompanionStyle.Muted:Primary?Color.White:ForeColor,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);if(Focused&&ShowFocusCues)ControlPaint.DrawFocusRectangle(g,new Rectangle(5,5,Width-11,Height-11),CompanionStyle.Blue,BackColor);}
 }
 public sealed class CompanionOrb:Button {
  public string Phase="idle";
  public CompanionOrb(){FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;DoubleBuffered=true;}
  protected override void OnPaint(PaintEventArgs e){var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;g.Clear(CompanionStyle.Surface);float k=Width/64f;g.ScaleTransform(k,k);using(var b=new LinearGradientBrush(new Rectangle(1,1,62,62),Color.FromArgb(241,250,255),Color.FromArgb(190,224,250),65))g.FillEllipse(b,1,1,61,61);using(var pen=new Pen(Color.FromArgb(139,189,229),1))g.DrawEllipse(pen,1,1,61,61);
   using(var body=new SolidBrush(Color.FromArgb(70,143,203))){g.FillEllipse(body,13,25,34,23);using(var tail=new GraphicsPath()){tail.AddBezier(43,35,48,25,51,26,54,25);tail.AddBezier(54,25,54,35,47,43,42,42);tail.CloseFigure();g.FillPath(body,tail);}g.FillEllipse(body,24,40,14,9);}
   using(var b=new SolidBrush(Color.FromArgb(229,247,255)))g.FillEllipse(b,16,37,22,8);using(var b=new SolidBrush(Color.FromArgb(23,58,87)))g.FillEllipse(b,21,31,3.5f,3.5f);using(var pen=new Pen(Color.FromArgb(79,156,210),2)){g.DrawArc(pen,27,16,8,10,180,125);g.DrawArc(pen,31,16,8,10,240,125);}
   Color dot=Phase=="error"?Color.FromArgb(192,111,66):Phase=="running"?Color.FromArgb(46,147,118):Phase=="paused"?Color.FromArgb(188,143,52):Color.FromArgb(116,148,176);using(var white=new SolidBrush(Color.White))g.FillEllipse(white,45,44,15,15);using(var b=new SolidBrush(dot))g.FillEllipse(b,48,47,9,9);
   if(Focused&&ShowFocusCues)using(var pen=new Pen(CompanionStyle.Blue,2))g.DrawEllipse(pen,5,5,53,53);
  }
 }
 public sealed class CompanionCard:Panel {
  public CompanionCard(){DoubleBuffered=true;BackColor=Color.White;}
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;using(var p=CompanionStyle.Round(new RectangleF(0,0,Width-1,Height-1),14))using(var pen=new Pen(CompanionStyle.Line))e.Graphics.DrawPath(pen,p);}
 }

 public sealed class CompanionWindow:Form {
  readonly HttpClient http=new HttpClient();readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=4000000};
  readonly string origin,key,stateFile;readonly CompanionOrb ball=new CompanionOrb();readonly Panel panel=new Panel();readonly Label status=new Label(),detail=new Label();readonly FlowLayoutPanel history=new FlowLayoutPanel();readonly TextBox draft=new TextBox();readonly ToolTip tips=new ToolTip();readonly Label hint=new Label(),inputHint=new Label();readonly System.Windows.Forms.Timer refresh=new System.Windows.Forms.Timer(),hold=new System.Windows.Forms.Timer();
  Dictionary<string,object> session;int sessionRevision;string notice="";bool expanded,busy,closing,dragged,longPress,commandBusy;Point anchor,initial;WaveRecorder microphone;DateTime pressed,recordingAt,noticeUntil;Button mic,startButton,stopButton,sendButton;Point orbHome;float uiScale=1;int connectionFailures;string lastHistory="";
  public CompanionWindow(string baseUrl,string ownerKey,string token,string state){
   Uri uri;if(!Uri.TryCreate(baseUrl,UriKind.Absolute,out uri)||!uri.IsLoopback||uri.Scheme!="http")throw new Exception("悬浮窗只连接本机插件服务");origin=baseUrl.TrimEnd('/');key=ownerKey;stateFile=state;http.Timeout=TimeSpan.FromSeconds(8);http.DefaultRequestHeaders.Add("X-DSH-Companion",token);
   Text="DSH 陪伴悬浮球";FormBorderStyle=FormBorderStyle.None;TopMost=true;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;BackColor=CompanionStyle.Surface;Font=new Font("Microsoft YaHei UI",9.5f);AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;KeyPreview=true;
   using(var g=CreateGraphics())uiScale=Math.Max(1,Math.Min(2,g.DpiX/96f));uiScale=Math.Min(uiScale,(Screen.PrimaryScreen.WorkingArea.Width-16)/368f);
   orbHome=new Point(Screen.PrimaryScreen.WorkingArea.Right-(int)(84*uiScale),Screen.PrimaryScreen.WorkingArea.Bottom-(int)(104*uiScale));Location=orbHome;
   ball.Name="companionBall";ball.AccessibleName="陪伴悬浮球，点击展开，长按语音，方向键移动";ball.SetBounds(0,0,64,64);ball.TabStop=true;Controls.Add(ball);tips.SetToolTip(ball,"点击展开 · 拖动移动 · 长按说话\n右键打开快捷操作");
   ball.MouseDown+=(s,e)=>{if(e.Button!=MouseButtons.Left)return;anchor=Cursor.Position;initial=Location;pressed=DateTime.UtcNow;dragged=false;longPress=false;hold.Start();};
   ball.MouseMove+=(s,e)=>{if(e.Button!=MouseButtons.Left)return;var p=Cursor.Position;if(Math.Abs(p.X-anchor.X)+Math.Abs(p.Y-anchor.Y)>8){dragged=true;hold.Stop();if(microphone!=null)CancelRecording();Location=new Point(initial.X+p.X-anchor.X,initial.Y+p.Y-anchor.Y);}};
   ball.MouseUp+=async(s,e)=>{hold.Stop();if(dragged)FinishDrag();if(microphone!=null)await EndRecording();};
   ball.Click+=(s,e)=>{if(!dragged&&!longPress)Expand(!expanded);};
   var menu=new ContextMenuStrip();menu.Items.Add("展开对话",null,(s,e)=>Expand(true));menu.Items.Add("回到屏幕右下角",null,(s,e)=>{var area=Screen.FromControl(this).WorkingArea;orbHome=new Point(area.Right-(int)(84*uiScale),area.Bottom-(int)(104*uiScale));Expand(false);});menu.Items.Add(new ToolStripSeparator());menu.Items.Add("关闭并停止识屏",null,async(s,e)=>await CloseSafely());ball.ContextMenuStrip=menu;
   var heading=new Label {Text="陪你看",Font=new Font("Microsoft YaHei UI",13,FontStyle.Bold),ForeColor=CompanionStyle.Ink};heading.SetBounds(76,17,156,27);Controls.Add(heading);
   hint.Text="同一个画面，一起看";hint.ForeColor=CompanionStyle.Muted;hint.SetBounds(76,46,170,22);Controls.Add(hint);
   var fold=new CompanionButton {Text="−",AccessibleName="收起悬浮面板"};fold.SetBounds(260,18,40,40);fold.Click+=(s,e)=>Expand(false);Controls.Add(fold);tips.SetToolTip(fold,"收起为悬浮球 · Esc");
   var close=new CompanionButton {Text="×",AccessibleName="关闭并停止识屏"};close.SetBounds(308,18,40,40);close.Click+=async(s,e)=>await CloseSafely();Controls.Add(close);tips.SetToolTip(close,"关闭，同时停止识屏");
   panel.AutoScroll=true;panel.SetBounds(20,88,328,418);Controls.Add(panel);status.AutoSize=false;status.SetBounds(0,0,328,26);status.Font=new Font("Microsoft YaHei UI",10,FontStyle.Bold);status.ForeColor=CompanionStyle.Ink;panel.Controls.Add(status);
   detail.AutoSize=false;detail.SetBounds(0,29,328,35);detail.ForeColor=CompanionStyle.Muted;detail.AutoEllipsis=true;panel.Controls.Add(detail);
   var thread=new CompanionCard();thread.SetBounds(0,76,328,168);panel.Controls.Add(thread);history.SetBounds(10,10,308,148);history.BackColor=Color.White;history.AutoScroll=true;history.FlowDirection=FlowDirection.TopDown;history.WrapContents=false;thread.Controls.Add(history);
   var composer=new CompanionCard();composer.SetBounds(0,256,328,108);panel.Controls.Add(composer);
   draft.Multiline=true;draft.ScrollBars=ScrollBars.None;draft.BackColor=Color.White;draft.BorderStyle=BorderStyle.None;draft.SetBounds(12,12,304,35);draft.MaxLength=2000;draft.AccessibleName="想对她说的话，Ctrl+回车发送";composer.Controls.Add(draft);inputHint.Text="说点什么…";inputHint.ForeColor=CompanionStyle.Muted;inputHint.BackColor=Color.White;inputHint.SetBounds(12,12,304,35);inputHint.Click+=(sender,args)=>{if(draft.ReadOnly)startButton.Focus();else draft.Focus();};composer.Controls.Add(inputHint);inputHint.BringToFront();draft.TextChanged+=(sender,args)=>{inputHint.Visible=draft.TextLength==0;draft.ScrollBars=draft.Lines.Length>2?ScrollBars.Vertical:ScrollBars.None;};draft.GotFocus+=(sender,args)=>inputHint.Visible=draft.ReadOnly&&draft.TextLength==0;draft.LostFocus+=(sender,args)=>inputHint.Visible=draft.TextLength==0;
   sendButton=AddButton("发送",208,58,async()=>{var text=draft.Text.Trim();if(text.Length==0)return;if(session==null||NativeScreen.Text(session,"status")!="running")throw new Exception("先开始陪看，再发给我吧");await Post(new {action="input",key=key,id=NativeScreen.Text(session,"id"),text=text});draft.Clear();Notice("收到，正在结合画面回应你");});panel.Controls.Remove(sendButton);composer.Controls.Add(sendButton);sendButton.Width=108;((CompanionButton)sendButton).Primary=true;
   draft.KeyDown+=(s,e)=>{if(e.Control&&e.KeyCode==Keys.Enter){e.SuppressKeyPress=true;sendButton.PerformClick();}};tips.SetToolTip(sendButton,"发送 · Ctrl+Enter");
   mic=AddButton("按住说话",12,58,null);panel.Controls.Remove(mic);composer.Controls.Add(mic);mic.Width=108;mic.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Left)BeginRecording();};mic.MouseUp+=async(s,e)=>await EndRecording();tips.SetToolTip(mic,"按住录音，松开转文字；编辑后再发送。也可聚焦后按住空格");mic.KeyDown+=(sender,args)=>{if(args.KeyCode==Keys.Space){args.SuppressKeyPress=true;BeginRecording();}};mic.KeyUp+=async(sender,args)=>{if(args.KeyCode==Keys.Space){args.SuppressKeyPress=true;await EndRecording();}};
   startButton=AddButton("开始识屏",0,376,async()=>{string phase=NativeScreen.Text(session,"status");if(phase=="running")await Control("pause");else if(phase=="paused"||phase=="error")await Control("resume");else await Post(new {action="start",target="screen",mode="watch",key=key,sourceLabel="当前桌面",audio=false,control=false});});startButton.SetBounds(0,376,224,40);((CompanionButton)startButton).Primary=true;
   stopButton=AddButton("结束",236,376,()=>Control("stop"));stopButton.Width=92;stopButton.Height=40;
   MouseEventHandler dragHeaderDown=(s,e)=>{if(e.Button==MouseButtons.Left){anchor=Cursor.Position;initial=Location;}};MouseEventHandler dragHeaderMove=(s,e)=>{if(e.Button==MouseButtons.Left){var q=Cursor.Position;Location=new Point(initial.X+q.X-anchor.X,initial.Y+q.Y-anchor.Y);}};heading.MouseDown+=dragHeaderDown;heading.MouseMove+=dragHeaderMove;heading.MouseUp+=(s,e)=>FinishDrag();hint.MouseDown+=dragHeaderDown;hint.MouseMove+=dragHeaderMove;hint.MouseUp+=(s,e)=>FinishDrag();heading.Cursor=Cursors.SizeAll;
   KeyDown+=(s,e)=>{if(e.KeyCode==Keys.Escape&&expanded){Expand(false);e.Handled=true;}else if(!expanded&&(e.KeyCode==Keys.Left||e.KeyCode==Keys.Right||e.KeyCode==Keys.Up||e.KeyCode==Keys.Down)){Location=new Point(Left+(e.KeyCode==Keys.Right?8:e.KeyCode==Keys.Left?-8:0),Top+(e.KeyCode==Keys.Down?8:e.KeyCode==Keys.Up?-8:0));KeepOnScreen();e.Handled=true;}};
   if(uiScale!=1)Scale(new SizeF(uiScale,uiScale));
   hold.Interval=450;hold.Tick+=(s,e)=>{hold.Stop();if(!dragged){longPress=true;Expand(true);BeginRecording();}};refresh.Interval=1500;refresh.Tick+=async(s,e)=>await RefreshStatus();
   Shown+=async(s,e)=>{NativeScreen.SetWindowDisplayAffinity(Handle,0x11);WriteState("ready");refresh.Start();await RefreshStatus();};FormClosing+=async(s,e)=>{if(closing)return;e.Cancel=true;await CloseSafely();};Deactivate+=(s,e)=>{if(microphone!=null)CancelRecording();};Expand(false);
  }
  Button AddButton(string text,int x,int y,Func<Task> action){var b=new CompanionButton {Text=text};b.SetBounds(x,y,80,40);panel.Controls.Add(b);if(action!=null)b.Click+=async(s,e)=>{if(commandBusy)return;commandBusy=true;b.Enabled=false;notice="";try{await action();await RefreshStatus();}catch(Exception error){Notice(error.Message);}finally{commandBusy=false;if(!b.IsDisposed){b.Enabled=true;RenderStatus();}}};return b;}
  void FinishDrag(){KeepOnScreen();if(expanded)orbHome.Offset(Left-initial.X,Top-initial.Y);}
  void KeepOnScreen(){var area=Screen.FromControl(this).WorkingArea;Location=new Point(Math.Max(area.Left,Math.Min(Left,area.Right-Width)),Math.Max(area.Top,Math.Min(Top,area.Bottom-Height)));if(!expanded)orbHome=Location;}
  protected override CreateParams CreateParams {get {var p=base.CreateParams;p.ExStyle|=0x8;return p;}}
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);if(!expanded)return;e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;using(var p=CompanionStyle.Round(new RectangleF(0.5f,0.5f,Width-2,Height-2),20*uiScale))using(var pen=new Pen(CompanionStyle.Line,1))e.Graphics.DrawPath(pen,p);}
  void WriteState(string phase){if(String.IsNullOrEmpty(stateFile))return;try{File.WriteAllText(stateFile,json.Serialize(new {pid=System.Diagnostics.Process.GetCurrentProcess().Id,hwnd=Handle.ToInt64().ToString(),state=phase,expanded=expanded}),Encoding.UTF8);}catch{}}
  void Expand(bool value){if(value&&!expanded)orbHome=Location;expanded=value;var available=Screen.FromPoint(orbHome).WorkingArea;Size=value?new Size((int)(368*uiScale),Math.Min((int)(526*uiScale),available.Height-16)):new Size((int)(64*uiScale),(int)(64*uiScale));foreach(Control item in Controls)if(item!=ball)item.Visible=value;panel.Visible=value;if(value)panel.Height=Math.Max(80,Height-(int)(108*uiScale));ball.SetBounds(value?(int)(20*uiScale):0,value?(int)(18*uiScale):0,(int)((value?44:64)*uiScale),(int)((value?44:64)*uiScale));var area=Screen.FromPoint(orbHome).WorkingArea;Location=value?new Point(orbHome.X>area.Left+area.Width/2?orbHome.X+(int)(64*uiScale)-Width:orbHome.X,orbHome.Y>area.Top+area.Height/2?orbHome.Y+(int)(64*uiScale)-Height:orbHome.Y):orbHome;KeepOnScreen();using(var p=new GraphicsPath()){if(value){using(var round=CompanionStyle.Round(new RectangleF(0,0,Width-1,Height-1),20*uiScale))p.AddPath(round,false);}else p.AddEllipse(0,0,Width-1,Height-1);var old=Region;Region=new Region(p);if(old!=null)old.Dispose();}ball.Invalidate();if(value){if(NativeScreen.Text(session,"status")=="running")draft.Focus();else startButton.Focus();}else ball.Focus();if(IsHandleCreated&&Visible)WriteState("ready");}
  void RenderMessages(object[] messages){history.SuspendLayout();try{while(history.Controls.Count>0){var c=history.Controls[0];history.Controls.RemoveAt(0);c.Dispose();}var rows=messages??new object[0];if(rows.Length==0){var welcome=new Label {Text="我在这里，等你一起看\r\n\r\n开始后，可以打字或按住说话",ForeColor=CompanionStyle.Muted,TextAlign=ContentAlignment.MiddleCenter,AutoSize=false,Size=new Size(history.ClientSize.Width-8,history.ClientSize.Height-8)};history.Controls.Add(welcome);return;}int width=history.ClientSize.Width-SystemInformation.VerticalScrollBarWidth-8;foreach(var row in rows){var m=NativeScreen.Obj(row);bool mine=NativeScreen.Text(m,"role")=="user";string body=NativeScreen.Text(m,"text");int h=TextRenderer.MeasureText(body,Font,new Size(width-24,0),TextFormatFlags.WordBreak|TextFormatFlags.NoPadding).Height;var card=new Panel {BackColor=mine?Color.FromArgb(229,242,253):Color.FromArgb(246,250,254),Margin=new Padding(0,0,0,10),Size=new Size(width,h+42)};var who=new Label {Text=mine?"你":"陪伴",ForeColor=CompanionStyle.Muted,Location=new Point(10,7),Size=new Size(width-20,18)};var words=new Label {Text=body,ForeColor=CompanionStyle.Ink,Location=new Point(10,28),Size=new Size(width-20,h+4)};card.Controls.Add(who);card.Controls.Add(words);history.Controls.Add(card);}if(history.Controls.Count>0)history.ScrollControlIntoView(history.Controls[history.Controls.Count-1]);}finally{history.ResumeLayout();}}
  async Task<Dictionary<string,object>> Request(string path,object data){if(data!=null)sessionRevision++;HttpResponseMessage response;if(data==null)response=await http.GetAsync(origin+path);else response=await http.PostAsync(origin+path,new StringContent(json.Serialize(data),Encoding.UTF8,"application/json"));using(response){var result=NativeScreen.Obj(json.DeserializeObject(await response.Content.ReadAsStringAsync()));if(!response.IsSuccessStatusCode)throw new Exception(NativeScreen.Text(result,"error"));if(data!=null&&result.ContainsKey("session")){var next=NativeScreen.Obj(result["session"]);if(next.ContainsKey("status")&&NativeScreen.Text(next,"key")==key){session=next;sessionRevision++;}}return result;}}
  Task<Dictionary<string,object>> Post(object body){return Request("/im-bridge/visual-session",body);}
  Task Control(string action){if(session==null)throw new Exception("当前没有识屏会话");return Post(new {action=action,key=key,id=NativeScreen.Text(session,"id")});}
  async Task RefreshStatus(){if(busy||closing)return;if(microphone!=null&&(DateTime.UtcNow-recordingAt).TotalSeconds>=45)await EndRecording();busy=true;var revision=sessionRevision;try{var data=await Request("/im-bridge/visual-session",null);if(revision!=sessionRevision)return;session=null;var rows=data.ContainsKey("sessions")?data["sessions"] as object[]:null;if(rows!=null)foreach(var row in rows){var item=NativeScreen.Obj(row);if(NativeScreen.Text(item,"key")==key){session=item;break;}}
    connectionFailures=0;RenderStatus();WriteState("ready");
   }catch(Exception e){connectionFailures++;ball.Phase="error";ball.Invalidate();status.Text="连接状态待同步";detail.Text="状态查询暂未成功，不能据此判断识屏已停止\n"+e.Message;detail.ForeColor=Color.FromArgb(166,107,48);}finally{busy=false;}}
  void RenderStatus(){
   string state=NativeScreen.Text(session,"status"),error=NativeScreen.Text(session,"error");bool running=state=="running",paused=state=="paused",failed=state=="error";
   string label=running?(NativeScreen.Text(session,"priorityWait")=="True"?"聊天优先，稍后继续":NativeScreen.Text(session,"analyzing")=="True"?"正在理解画面":NativeScreen.Text(session,"observedAt")=="0"?"正在获取画面":"正在陪你看"):paused?"已暂停":state=="stopped"?"已结束":failed?"识屏已停止，需要重试":"还没有开始";
   ball.Phase=failed?"error":running?"running":paused?"paused":"idle";ball.AccessibleDescription=label;ball.Invalidate();status.Text=label;
   hint.Text=running?"正在分享眼前这一刻":paused?"先歇一会儿，随时继续":"同一个画面，一起看";
   string source=session==null?"观察来源：当前桌面":NativeScreen.Text(session,"sourceLabel");
   string summary=notice.Length>0&&DateTime.UtcNow<noticeUntil?notice:failed&&error.Length>0?error:running?source+" · 有值得说的再开口":paused?"观察暂停了，点击继续就好":"点击开始；点球展开，长按说话";
   detail.Text=summary;detail.ForeColor=failed?Color.FromArgb(153,80,42):CompanionStyle.Muted;tips.SetToolTip(detail,summary+(session==null?"":"\n采集 "+NativeScreen.Text(session,"captures")+" · 理解 "+NativeScreen.Text(session,"analyses")+" · 回应 "+NativeScreen.Text(session,"reactions")));
   startButton.Text=running?"暂停陪看":paused?"继续陪看":failed?"重新连接":"开始识屏";startButton.Enabled=!commandBusy;stopButton.Visible=running||paused||failed;stopButton.Enabled=!commandBusy;startButton.Width=(int)((stopButton.Visible?224:328)*uiScale);sendButton.Enabled=running;mic.Enabled=running;draft.ReadOnly=!running;inputHint.Text=running?"说点什么…  Ctrl+Enter 发送":"先开始陪看，再和我说话";inputHint.Visible=draft.TextLength==0&&(!draft.Focused||!running);
   var messages=session!=null&&session.ContainsKey("messages")?session["messages"] as object[]:null;
   string next=messages==null?"你的提问和她的回应会出现在这里":String.Join("\r\n\r\n",messages.Select(row=>{var m=NativeScreen.Obj(row);return (NativeScreen.Text(m,"role")=="user"?"你：":"她：")+NativeScreen.Text(m,"text");}));
   if(next!=lastHistory){lastHistory=next;RenderMessages(messages);}
  }
  void Notice(string text){notice=text;noticeUntil=DateTime.UtcNow.AddSeconds(12);RenderStatus();}
  void BeginRecording(){try{if(microphone!=null)return;if(session==null||NativeScreen.Text(session,"status")!="running")throw new Exception("先开始识屏，再按住说话");microphone=new WaveRecorder();microphone.Start();recordingAt=DateTime.UtcNow;Notice("正在听，松开后转文字；不会自动发送");}catch(Exception e){CancelRecording();Notice(e.Message);}}
  void CancelRecording(){if(microphone==null)return;microphone.Dispose();microphone=null;Notice("录音已取消");}
  async Task EndRecording(){if(microphone==null)return;var recorder=microphone;microphone=null;var id=NativeScreen.Text(session,"id");try{var bytes=recorder.Stop();if(bytes.Length<8044)throw new Exception("录音太短，请按住说完再松开");Notice("正在把语音转成文字…");var result=await Post(new {action="transcribe",key=key,id=id,audio=new {data=Convert.ToBase64String(bytes),mediaType="audio/wav"}});if(NativeScreen.Text(session,"id")!=id||NativeScreen.Text(session,"status")!="running")throw new Exception("识屏会话已切换，未填入旧录音");draft.Text+=(draft.TextLength>0?"\r\n":"")+NativeScreen.Text(result,"text");Notice("已转成文字，可以修改后发送");}catch(Exception e){Notice(e.Message);}finally{recorder.Dispose();}}
  async Task CloseSafely(){if(closing)return;closing=true;refresh.Stop();hold.Stop();CancelRecording();try{if(session!=null&&NativeScreen.Text(session,"status")!="stopped")await Control("stop");}catch(Exception e){closing=false;refresh.Start();Expand(true);Notice("停止状态尚未确认："+e.Message);return;}WriteState("closed");Close();}
  protected override bool ShowWithoutActivation {get{return true;}}
  public static void Run(string baseUrl,string key,string token,string stateFile){NativeScreen.SetProcessDPIAware();Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var form=new CompanionWindow(baseUrl,key,token,stateFile))Application.Run(form);}
 }

 public sealed class WaveRecorder:IDisposable {
  [StructLayout(LayoutKind.Sequential)]struct Format {public ushort Tag,Channels;public uint Rate,Bytes;public ushort Align,Bits,Extra;}
  [StructLayout(LayoutKind.Sequential)]struct Header {public IntPtr Data;public uint Length,Recorded;public UIntPtr User;public uint Flags,Loops;public IntPtr Next,Reserved;}
  [DllImport("winmm.dll")]static extern uint waveInOpen(out IntPtr handle,uint id,ref Format format,IntPtr callback,IntPtr instance,uint flags);
  [DllImport("winmm.dll")]static extern uint waveInPrepareHeader(IntPtr h,IntPtr p,uint size);
  [DllImport("winmm.dll")]static extern uint waveInAddBuffer(IntPtr h,IntPtr p,uint size);
  [DllImport("winmm.dll")]static extern uint waveInStart(IntPtr h);
  [DllImport("winmm.dll")]static extern uint waveInReset(IntPtr h);
  [DllImport("winmm.dll")]static extern uint waveInUnprepareHeader(IntPtr h,IntPtr p,uint size);
  [DllImport("winmm.dll")]static extern uint waveInClose(IntPtr h);
  IntPtr handle=IntPtr.Zero,buffer=IntPtr.Zero,header=IntPtr.Zero;readonly uint size=(uint)Marshal.SizeOf(typeof(Header));
  static void Check(uint code){if(code!=0)throw new Exception("麦克风录音未能启动（Windows "+code+"），请检查默认麦克风与权限");}
  public void Start(){try{var format=new Format {Tag=1,Channels=1,Rate=16000,Bytes=32000,Align=2,Bits=16};Check(waveInOpen(out handle,UInt32.MaxValue,ref format,IntPtr.Zero,IntPtr.Zero,0));buffer=Marshal.AllocHGlobal(1920000);header=Marshal.AllocHGlobal((int)size);Marshal.StructureToPtr(new Header {Data=buffer,Length=1920000},header,false);Check(waveInPrepareHeader(handle,header,size));Check(waveInAddBuffer(handle,header,size));Check(waveInStart(handle));}catch{Dispose();throw;}}
  public byte[] Stop(){if(handle==IntPtr.Zero)return new byte[0];waveInReset(handle);var h=(Header)Marshal.PtrToStructure(header,typeof(Header));var pcm=new byte[(int)Math.Min(h.Recorded,1920000)];Marshal.Copy(buffer,pcm,0,pcm.Length);using(var stream=new MemoryStream())using(var w=new BinaryWriter(stream)){w.Write(Encoding.ASCII.GetBytes("RIFF"));w.Write(pcm.Length+36);w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));w.Write(16);w.Write((ushort)1);w.Write((ushort)1);w.Write(16000);w.Write(32000);w.Write((ushort)2);w.Write((ushort)16);w.Write(Encoding.ASCII.GetBytes("data"));w.Write(pcm.Length);w.Write(pcm);return stream.ToArray();}}
  public void Dispose(){if(handle!=IntPtr.Zero){waveInReset(handle);if(header!=IntPtr.Zero)waveInUnprepareHeader(handle,header,size);waveInClose(handle);handle=IntPtr.Zero;}if(header!=IntPtr.Zero){Marshal.FreeHGlobal(header);header=IntPtr.Zero;}if(buffer!=IntPtr.Zero){Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;}}
 }
}
