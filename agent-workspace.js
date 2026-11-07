export const WORKSPACE_RULES='【操作环境】默认用DSH内部环境和原生工具；操作本机文件、终端、软件或桌面时，可直接使用当前会话的DSH原生工具，不必先切工作区。bridge_browser/bridge_device的独立浏览器或电脑封装用于需要它们观察和控制的场景；内部浏览器的ref、标签页与截图不等于Windows桌面句柄，两者不混用。需要使用当前桌面窗口时可在已开放的设备能力内切换，不再单独申请插件许可；充值准备只可操作Harness自身充值页面，不扩大到其他桌面应用。';
export function explicitDesktopRequest(words=''){
 const text=String(words);if(/不要.{0,8}(?:桌面|前台)|别.{0,8}(?:桌面|窗口)|仅.{0,6}(?:内部|后台)/.test(text))return false;
 return /(?:用|操作|打开|切换|查看|控制|启动|在|把|到|发|截).{0,16}(?:我的桌面|电脑桌面|电脑屏幕|桌面(?:上的|快捷方式|应用|窗口|浏览器|软件)|前台窗口)|(?:桌面(?:上的|快捷方式|应用|窗口|浏览器|软件)|电脑桌面).{0,16}(?:打开|操作|设.{0,4}默认|默认使用)|(?:打开|启动|操作).{0,8}(?:记事本|计算器|资源管理器)|(?:控制|操控|操作|查看|看看|截取|接管).{0,10}(?:我的电脑|电脑屏幕|电脑上的|电脑里)|(?:允许|同意).{0,8}(?:操作|控制|操控).{0,5}(?:电脑|桌面)/.test(text);
}
export function workspaceMode(config={},context={}){const words=String(context.meta?.userWords||'');if(/(?:用|使用|在|换回|只要).{0,6}(?:内部|自带|后台|独立运行)|不要.{0,8}(?:桌面|前台)|别.{0,8}(?:桌面|窗口)/.test(words))return 'internal';return explicitDesktopRequest(words)||context.workspaceLease?.mode==='desktop'?'desktop':config.workspace==='desktop'?'desktop':'internal';}
export function browserWorkspaceMode(config={},context={}){
 const words=context.meta?.kind==='user'?String(context.meta.userWords||''):'';
 if(/(?:用|使用|在|只要).{0,6}(?:内部|后台)|不要.{0,8}(?:桌面|前台)|别.{0,8}(?:桌面|窗口)/.test(words))return 'internal';
 if(config.preferBackground!==false){
  const visibleBrowser=explicitDesktopRequest(words)&&/浏览器|网页|页面|视频|前台窗口|桌面窗口/.test(words);
  return visibleBrowser||context.workspaceLease?.browserVisible===true?'desktop':'internal';
 }
 return workspaceMode(config,context);
}
export function nativeDesktopTool(name=''){return !/browser|playwright|puppeteer|pilot|phone|android/i.test(name)&&/computer|desktop|mouse|keyboard|screen.?shot|screen_control|ui_automation|window_(?:focus|list)/i.test(name);}
export function requestedWorkspaceDefault(words=''){
 const text=String(words);if(!/(?:默认|以后都|一直用)/.test(text))return null;
 if(/(?:内部|自带|后台|独立运行)/.test(text))return 'internal';
 if(/桌面|前台/.test(text))return 'desktop';return null;
}
