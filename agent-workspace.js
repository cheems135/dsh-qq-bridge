export const WORKSPACE_RULES='【操作环境】默认在DSH内部独立浏览器/运行环境工作，不读取、切换或占用用户桌面窗口。内部浏览器的ref、标签页与截图不等于Windows桌面句柄；两者不能混用。只有本人当前明确要求操作桌面应用时才用bridge_device电脑工具；本人说把桌面设为默认时才持久切换。内部环境做不到时说明原因并询问是否使用桌面，不自行切换。充值准备只可操作Harness自身充值页面，不扩大到其他桌面应用。';
export function explicitDesktopRequest(words=''){
 const text=String(words);if(/不要.{0,8}(?:桌面|前台)|别.{0,8}(?:桌面|窗口)|仅.{0,6}(?:内部|后台)/.test(text))return false;
 return /(?:用|操作|打开|切换|查看|控制|启动|在|把|到|发|截).{0,16}(?:我的桌面|电脑桌面|电脑屏幕|桌面(?:上的|快捷方式|应用|窗口|浏览器|软件)|前台窗口)|(?:桌面(?:上的|快捷方式|应用|窗口|浏览器|软件)|电脑桌面).{0,16}(?:打开|操作|设.{0,4}默认|默认使用)|(?:打开|启动|操作).{0,8}(?:记事本|计算器|资源管理器)|(?:控制|操控|操作|查看|看看|截取|接管).{0,10}(?:我的电脑|电脑屏幕|电脑上的|电脑里)|(?:允许|同意).{0,8}(?:操作|控制|操控).{0,5}(?:电脑|桌面)/.test(text);
}
export function workspaceMode(config={},context={}){const words=String(context.meta?.userWords||'');if(/(?:用|使用|在|换回|只要).{0,6}(?:内部|自带|后台|独立运行)|不要.{0,8}(?:桌面|前台)|别.{0,8}(?:桌面|窗口)/.test(words))return 'internal';return explicitDesktopRequest(words)||context.workspaceLease?.mode==='desktop'?'desktop':config.workspace==='desktop'?'desktop':'internal';}
export function nativeDesktopTool(name=''){return !/browser|playwright|puppeteer|pilot|phone|android/i.test(name)&&/computer|desktop|mouse|keyboard|screen.?shot|screen_control|ui_automation|window_(?:focus|list)/i.test(name);}
export function requestedWorkspaceDefault(words=''){
 const text=String(words);if(!/(?:默认|以后都|一直用)/.test(text))return null;
 if(/(?:内部|自带|后台|独立运行)/.test(text))return 'internal';
 if(/桌面|前台/.test(text))return 'desktop';return null;
}
