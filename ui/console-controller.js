import {renderPageNavigation, enhancePageNavigation, passiveConsoleRequest, capturePanelView, restorePanelView} from './console-interaction.js';
import {renderServiceSources, paintExecutionRequests} from './execution-overview.js';
import {createFormState, sameFormValue} from './form-state.js';
import {deviceCapabilities, openPermissionControls} from './settings-contract.js';




(function () {
  function reportClient(text) {
    try { fetch('/im-bridge/clientlog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(text).slice(0, 400) }) }).catch(function () {}); } catch (e) {}
  }
  window.onerror = function (message, source, line) { reportClient('JS 错误 ' + message + ' @' + line); };
  window.addEventListener('unhandledrejection', function (event) { reportClient('Promise 拒绝 ' + (event.reason && event.reason.message ? event.reason.message : event.reason)); });
  var data = null;
  var uiDevice='',desktopNavSnapshot=null,desktopHeadsSnapshot=null,navEventsBound=false;
  function runtimeDevice(){return data&&data.status&&data.status.edition==='mobile'?'phone':'desktop';}
  /* 能力限制由实际运行设备决定；统一连接界面不代表电脑只能使用 API。 */
  function mobileApiOnly(){return deviceCapabilities(runtimeDevice()).apiOnly;}
  function deviceUiPreview(){return !!uiDevice&&uiDevice!==runtimeDevice();}
  function mobileUiPolicy(){
    if(!data)return;
    if(!desktopNavSnapshot){desktopNavSnapshot=NAV_GROUPS.map(function(g){return Object.assign({},g,{pages:g.pages.slice()});});desktopHeadsSnapshot=Object.assign({},PAGE_HEADS);}
    uiDevice=runtimeDevice();
    var adapter=window.QQBridgeDeviceUI;NAV_GROUPS=adapter?adapter.groups(uiDevice,desktopNavSnapshot):desktopNavSnapshot.map(function(g){return Object.assign({},g,{pages:g.pages.filter(function(p){return uiDevice!=='phone'||p!=='local';})});});
    PAGE_HEADS=Object.assign({},desktopHeadsSnapshot);
    if(mobileApiOnly()){PAGE_HEADS.services=['API 连接与搭配','聊天、图片与语音可分别连接不同提供商。','API 连接 模型 协议 搭配'];PAGE_HEADS.devices=['设备与同步','管理连接配置、切换实际运行设备与同步资料。','手机 电脑 设备 同步'];}
    if(!pageVisible(tab)){tab='overview';history.replaceState(null,'','#overview');}
    if(adapter)adapter.apply(uiDevice,runtimeDevice());
  }
  function applyPreviewControls(){if(deviceUiPreview()){document.querySelectorAll('#pane input,#pane textarea,#pane select,#pane button').forEach(function(el){if(el.matches('[data-go],[data-close-persona],[data-persona-tool]')||/^(?:profile|device)/.test(el.id)||['diaryPrev','diaryNext','cpGraphMotion','cpGraphReset'].includes(el.id))return;el.disabled=true;el.title='当前为另一设备的界面预览，请在实际运行设备打开插件后修改设置或执行任务。';});}}
  var deviceProfileData=null,deviceUiSwitchBusy=false,deviceProfileSaving=false;
  var login = null;
  var monitor = null;
  var models = null;
  var storage = null;
  var thoughts = null;
  var presets = [];
  var viewPreset = '';
  var msgChat = 'all';
  var sFilter = '';
  var pickedStickers = {};
  var showFullQQ = false;
  var editingId = '';
  var tab = 'overview';
  var renderedTab = '';
  var imagegenDraft = null;
  var imagegenTypedKeys = {};
  var groupLastPages = {};
  var themeMode = 'auto';
  try { themeMode = localStorage.getItem('qqb-ui-theme') || 'auto'; } catch (e) {}
  if (['auto', 'light', 'dark'].indexOf(themeMode) < 0) themeMode = 'auto';
  var msgFilter = 'all';
  var monQuery = '';
  var monitorTimer = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  /** Follow the host page's theme when embedded, the OS when opened standalone. */
  function applyTheme() {
    var apply = function (mode) { if (document.documentElement.getAttribute('data-theme') !== mode) document.documentElement.setAttribute('data-theme', mode); };
    if (themeMode !== 'auto') { apply(themeMode); return; }
    var dark = null;
    try {
      var parentDoc = window.parent && window.parent !== window ? window.parent.document : null;
      var root = parentDoc ? parentDoc.documentElement : null;
      if (root && parentDoc.body) {
        var marker = ((root.className || '') + ' ' + (root.getAttribute('data-theme') || '') + ' ' + (root.getAttribute('data-color-mode') || '')).toLowerCase();
        if (marker.indexOf('dark') !== -1) dark = true;
        else if (marker.indexOf('light') !== -1) dark = false;
        else {
          var bg = window.parent.getComputedStyle(parentDoc.body).backgroundColor || '';
          var parts = bg.match(/\d+/g);
          if (parts && parts.length >= 3) {
            dark = (Number(parts[0]) * 0.299 + Number(parts[1]) * 0.587 + Number(parts[2]) * 0.114) < 128;
          }
        }
      }
    } catch (e) {
      dark = null;
    }
    if (dark === null) dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(dark ? 'dark' : 'light');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  /** 自建弹窗：面板跑在 iframe 里，window.confirm / prompt 会被 Chromium 直接拦掉。 */
  function showModal(message, withInput, placeholder, okLabel) {
    return new Promise(function (resolve) {
      var box = $('modal'); var input = $('modalInput'); var ok = $('modalOk'); var cancel = $('modalCancel');
      var previous = document.activeElement;
      $('modalMsg').textContent = message;
      input.style.display = withInput ? '' : 'none'; input.value = ''; input.placeholder = placeholder || '';
      ok.textContent = okLabel || '确定'; cancel.textContent = '取消';
      box.hidden = false;
      function done(value) {
        box.hidden = true; ok.onclick = null; cancel.onclick = null;
        document.removeEventListener('keydown', onKey);
        if (previous && previous.isConnected) previous.focus({ preventScroll: true });
        resolve(value);
      }
      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); cancel.click(); }
        else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); ok.click(); }
        else if (event.key === 'Tab') {
          var elements = withInput ? [input,cancel,ok] : [cancel,ok];
          var first = elements[0]; var last = elements[elements.length-1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      ok.onclick = function () { done(withInput ? (input.value.trim() === '' ? null : input.value.trim()) : true); };
      cancel.onclick = function () { done(withInput ? null : false); };
      document.addEventListener('keydown', onKey);
      (withInput ? input : cancel).focus({ preventScroll: true });
    });
  }

  function askConfirm(message) { return showModal(message, false, '', '确定'); }
  function askText(message, placeholder) { return showModal(message, true, placeholder, '确定'); }
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2000);
  }
  function requestApi(method, url, payload) {
    return fetch(url, {
      method: method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.json().then(function (v) {
        if (!r.ok) throw new Error(v && v.error ? v.error : ('HTTP ' + r.status));
        return v;
      });
    });
  }

  function load(options) {
    return Promise.all([
      api('GET', '/im-bridge/settings'),
      api('GET', '/im-bridge/login'),
      api('GET', '/im-bridge/messages'),
      api('GET', '/im-bridge/models'),
      api('GET', '/im-bridge/presets'),
      api('GET', '/im-bridge/thoughts'),
      api('GET', '/im-bridge/storage'),
      api('GET', '/im-bridge/features').catch(function () { return null; }),
      api('GET', '/im-bridge/device-profiles').catch(function () { return null; })
    ]).then(async function (r) {
      data = r[0]; login = r[1]; monitor = r[2]; models = r[3];
      presets = (r[4] && r[4].presets) || [];
      thoughts = r[5];
      storage = r[6];
      featureData = r[7]; deviceProfileData = r[8]; mobileUiPolicy(); initNavigation();
      hubPreview=null;hubSearchResult='';if(hubSelection)try{hubPreview=(await api('POST','/im-bridge/features/memory-hub',{key:hubSelection,action:'snapshot'})).memoryHub;}catch{};
      lastSnapshotAt = Date.now();
      if(options?.refreshCompanion&&['overview','daily','diary','star','study','songs'].includes(tab))await refreshCompanionPanel({render:false});
      renderPill(); renderPane();
    }).catch(function (e) {
      toast('读取失败：' + e.message);
      if (!data || !renderedTab) {
        $('pane').innerHTML = '<div class="loading-state"><h1>暂时无法加载控制台</h1><p>' + esc(e.message) + '</p><button class="primary" id="retryLoad">重新加载</button></div>';
        $('retryLoad').onclick = load;
      }
      return false;
    });
  }

  // Open policy values are fixed in the backend; do not offer controls that cannot save.
  function applyOpenPermissionControls(){
    if(data?.settings?.permissionsMode!=='open-nonpayment')return;
    var controls=openPermissionControls(data.settings),ids=controls.ids;
    ids.forEach(function(id){var el=$(id);if(!el)return;var container=el.closest('label');if(!container&&el.classList.contains('sharing-switch'))container=el.closest('.row');(container||el).remove();});
    controls.selectors.forEach(function(selector){document.querySelector(selector)?.closest('.row')?.remove();});

    if(['autonomy','persona','local'].includes(tab)){var note=document.createElement('p');note.className='muted';note.textContent='当前采用开放模式，已移除不会生效的额度和权限开关。实际行为仍取决于日程作息、联系人范围、能力配置和她的判断；空间总开关、B站评论开关与紧急停止仍有效。';$('pane').querySelector('.page-content')?.prepend(note);}
  }
  function optionalSetting(id,key,type){var el=$(id);return el?{[key]:type==='checked'?el.checked:type==='number'?Number(el.value):el.value}:{};}
  function renderPill() {
    var st = data.status;
    renderShellStatus();
    $('dot').style.background = st.connected ? '#2fbf71' : '#d94b4b';
    $('pillText').textContent = st.accountPaused ? '连接已停用' : (st.connected ? 'NapCat 已连接' : '等待连接');
    window.__bridgeVersion = st.version || '';
    if ($('ver')) $('ver').textContent = 'v' + (st.version || '—');
    var effortLabel = { off: '省', low: '标准', high: '高', max: '最高' };
    if ($('chipIq')) $('chipIq').textContent = '档位 ' + (effortLabel[st.effectiveEffort] || st.effectiveEffort || '—');
    if ($('chipVoice')) $('chipVoice').textContent = '语音 ' + (data.settings && data.settings.voice && data.settings.voice.enabled ? '开' : '关');
  }

  var ICONS = {
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    book:'<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3Z"/><path d="M12 6v15M6 8h3M15 8h3"/>',
    bulb:'<path d="M8 17c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8ZM9 21h6M9 17h6"/>',
    audio:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H8l-5 2v-6a8.5 8.5 0 0 1-1-4.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 10h8M7 14h5"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    settings: '<path d="M4 7h16M4 17h16"/><rect x="7" y="4" width="4" height="6" rx="1" fill="var(--panel)"/><rect x="14" y="14" width="4" height="6" rx="1" fill="var(--panel)"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="m11 13 7-7"/>',
    users: '<path d="M3 21v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2M17 14a5 5 0 0 1 4 5v2"/><circle cx="9.5" cy="6" r="4"/><path d="M16 2a4 4 0 0 1 0 8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5M16 14.5h.1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
    monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
    link: '<path d="m10 13 4-4m-7 5-2 2a4.2 4.2 0 0 0 6 6l4-4a4.2 4.2 0 0 0 0-6M17 10l2-2a4.2 4.2 0 0 0-6-6L9 6a4.2 4.2 0 0 0 0 6"/>',
    refresh: '<path d="M21 8a9 9 0 0 0-16-3L2 8m0-6v6h6M3 16a9 9 0 0 0 16 3l3-3m0 6v-6h-6"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
    whale: '<path d="M3 12C2 5 12 3 15 9c1 2 1 4 0 6 3 0 5-2 6-4 1 7-5 9-9 9-5 0-9-3-9-8Z"/><path d="M9 4V2m3 2 2-2M6 12h.1M6 16c2 1 3 1 5 0"/>'
  };
  function icon(name) {
    return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.spark) + '</svg>';
  }
  var NAV_GROUPS = [
    { id: 'home', label: '她的小世界', note: '现在、日程与小日记', icon: 'home', pages: ['overview','daily','diary','star'] },
    { id: 'messages', label: '消息中心', note: '查看、发送与管理对话', icon: 'chat', pages: ['monitor', 'send', 'sessions', 'delivery', 'activity','invocations'] },
    { id: 'character', label: '认识她', note: '人设、关系与学习', icon: 'spark', pages: ['persona', 'profiles', 'directives', 'autonomy', 'study', 'thoughts', 'memory'] },
    { id: 'web', label: '上网与内容', note: '账号、浏览与视频资料', icon: 'search', pages: ['bilibili','qzone','websitemcp'] },
    { id: 'assets', label: '声音与画面', note: '说话、唱歌与图像视频', icon: 'image', pages: ['voice', 'songs', 'imagegen', 'videogen', 'photo', 'sticker', 'collect'] },
    { id: 'system', label: '系统设置', note: '连接、权限与运行配置', icon: 'settings', pages: ['connection', 'prompts', 'services', 'local', 'devices', 'whitelist', 'model', 'storage', 'backup'] }
  ];
  var PAGE_HEADS = {
    prompts:['提示词管理','中文调整常规表达与画面偏好，查看模板中英对照。','提示词 模板 中文 英文 预览 恢复 历史'],
    directives:['长期指令','写下需要长期遵守的要求或任务，每轮生效；与当前要求冲突时会先问你。','长期 指令 任务 常驻 规则 冲突'],
    qzone:['QQ 空间','查看图文动态回执，读取并回复实际评论。','空间 动态 配图 评论 回复'],
    services:['连接与搭配','检测 API 或本地服务，分别选择聊天、图片与语音的来源。','API 本地 自由 连接 自动识别 模型 类型 混合 串联 搭配'],
    websitemcp:['网站工具 / MCP','输入网址，识别公开接口与搜索表单，测试后供本地和 API 使用。','网站 自动封装 MCP 接口 搜索 OpenAPI 工具 适配'],
    invocations:['提示词与调用记录','本地与 API 共用的实际调用记录，可复制提示词用于调整。','生图 视频 提示词 prompt 工具 调用 记录 API 本地 补全'],
    daily:['今天的小日程','在线做小事，离线就安心睡觉。','生活 当前 等待 恢复 任务 权限'],
    diary:['私人手账','','日记 摘记 经历 回忆'],
    star:['关系星图','看她和谁来往、在什么场合、常聊些什么。','星图 关系 人物 话题 来源 图谱'],
    study:['学习效果','分清已存资料、实际召回、生成答复和本人评价。','学习 反馈 纠正 效果 应用'],
    songs:['唱歌','配置 RunningHub 唱歌与翻唱工作流。','唱歌 翻唱 RunningHub 工作流'],
    devices: ['设备与同步', '管理当前设备的连接配置，也可同步资料与切换实际运行设备。', '手机 电脑 USB 数据线 同步 切换 密钥 隐私 版本'],
    delivery: ['消息可靠性', '查看处理队列、平台回执与失败记录，按需重试。', '去重 合并 重发 回执 失败'],
    activity: ['回复依据与纠错', '查看本轮使用的记忆与分享资料，预览修正版或申请撤回。', '上下文 诊断 引用 来源 撤回 重新生成'],
    profiles: ['对话偏好', '为每个联系人或群单独选择人设、模型、声音与回复偏好。', '联系人 独立 配置 音色 主动'],
    backup: ['备份与迁移', '导出人设、记忆与素材，先预览再合并恢复。', '导出 导入 恢复 备份 迁移 JSON'],
    overview: ['今天的小世界', '看看她正在做什么，翻翻今天的心情。', '概览 在线 状态 今日 花费'],
    monitor: ['对话记录', '查看与她的往来，按联系人或消息内容快速查找。', '聊天 监听 历史 搜索'],
    send: ['发送消息', '以她的身份发送文字、语音或表情。', '发消息 手动 补发'],
    sessions: ['会话管理', '为不同对话选择模型，管理每一段独立的上下文。', '重置 模型 单独 新会话'],
    persona: ['自我与人设卡', '空自我卡是底子，人设卡是她的 cosplay 外层。', '人设 人设卡 自我 性格 提示词 预设 导入 导出 AI 试聊 cosplay 角色'],
    memory: ['长期记忆', '管理她记住的事，让新的对话也能接着聊。', '压缩 轮数 迁移 记忆'],
    autonomy: ['主动互动', '统一管理自主日常、当前请求和离线休息。', '自主 签名 昵称 空间 主动 追问 沉默 补充 勿扰 频率'],
    thoughts: ['情绪与学习', '查看情绪变化、作品反思与主动行为。', '心情 情绪 学习 网站 网页 来源 分享 视频 复盘 动作'],
    sticker: ['表情库', '上传、分组与挑选，整理她在对话中使用的表情。', '素材 表情包 批量 上传 分组 删除'],
    collect: ['素材采集', '从网页、关键词或参考图中，寻找新的表情素材。', '搜图 AI 收集 下载 批量 以图搜图 表情含义 识别'],
    photo: ['照片来源', '选择搜图或生成，设置她的外观与照片偏好。', '图库 外观 性别 宽度 照片'],
    voice: ['语音表达', '选择声音、配置合成服务，听听她会怎么说。', '音色 TTS 本地 API 自定义 试听 引擎'],
    videogen: ['视频生成','选择视频 API，沿用当前形象与日程，再安排镜头和连续动作。','视频 API 时长 镜头 动作 参考图'],
    imagegen: ['图像生成', '管理生图服务与参数，试着把一句描述变成画面。', '生图 RunningHub 硅基流动 API Key 工作流'],
    connection: ['账号与连接', '登录与手动登出 QQ，切换机器人账号，管理 NapCat 连接。', '登录 登出 退出 logout 二维码 token WebSocket 重启 测试 暂停 自启'],
    bilibili: ['B站', '本地模型和 API 模型共用的账号、浏览与评论草稿。', 'B站 哔哩哔哩 Bilibili 二维码 扫码 登录 推荐 字幕 评论 API 本地'],
    local: ['本地连接', 'ComfyUI 与本地语音：填地址、看状态、直接试一次。', '本地 ComfyUI 工作流 反推 看图 本地模型 语音 Breeze VoiceLab 8188 7870'],
    whitelist: ['联系人与权限', '管理号主、私聊联系人与可用的群。', '白名单 QQ 群 备注 广播 权限'],
    model: ['模型与搜索', '选择聊天模型、思考深度和联网搜索方式。', '智力 档位 provider SearXNG 搜索引擎'],
    storage: ['存储与缓存', '查看空间占用，迁移或清理运行时缓存。', '目录 路径 占用 清理 迁移'],
    logs: ['运行日志', '查看插件的运行记录与连接信息。', '日志 排错 调试 错误']
  };
  var HIDDEN_PAGES = ['logs'];
  function pageVisible(page) {
    return HIDDEN_PAGES.indexOf(page) !== -1 || NAV_GROUPS.some(function (g) { return g.pages.indexOf(page) !== -1; });
  }
  function groupFor(page) {
    var found = NAV_GROUPS.filter(function (g) { return g.pages.indexOf(page) !== -1; })[0];
    if (found) return found;
    if (HIDDEN_PAGES.indexOf(page) !== -1) return NAV_GROUPS.filter(function (g) { return g.id === 'system'; })[0] || NAV_GROUPS[NAV_GROUPS.length - 1];
    return NAV_GROUPS[0];
  }
  function renderShellStatus() {
    var st = data.status;
    if ($('sidePersona')) $('sidePersona').textContent = st.personaName || st.preset || '尚未选择角色';
    if ($('sideAccount')) $('sideAccount').textContent = st.selfId ? 'QQ ' + st.selfId : '尚未连接账号';
    if ($('sideAvatar')) $('sideAvatar').innerHTML = icon('whale');
  }
  function syncNavigation() {
    var group = groupFor(tab);
    Array.prototype.forEach.call(document.querySelectorAll('[data-group]'), function (btn) {
      var active = btn.getAttribute('data-group') === group.id;
      btn.classList.toggle('on', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    $('breadcrumb').textContent = group.label;
    document.title = PAGE_HEADS[tab][0] + ' · QQ 桥接';
  }

  function bindRoutes() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (btn) {
      btn.onclick = function () { navigate(btn.getAttribute('data-go')); };
    });
  }
  function closeSearch() {
    $('searchResults').hidden = true;
    $('navSearch').setAttribute('aria-expanded', 'false');
  }
  function renderSearch() {
    var q = $('navSearch').value.trim().toLowerCase();
    var found = Object.keys(PAGE_HEADS).filter(function (key) { if(!NAV_GROUPS.some(function(g){return g.pages.indexOf(key)>=0;}))return false;return !q || PAGE_HEADS[key].join(' ').toLowerCase().indexOf(q) !== -1 || groupFor(key).label.indexOf(q) !== -1; });
    $('searchResults').innerHTML = '<div class="search-heading">' + (q ? '搜索结果' : '全部功能') + '<span>' + found.length + ' 项</span></div>' + (found.length ? found.map(function (key) {
      return '<button class="search-result" data-go="' + key + '"><span>' + icon(groupFor(key).icon) + '</span><span><b>' + PAGE_HEADS[key][0] + '</b><small>' + groupFor(key).label + '</small></span>' + icon('arrow') + '</button>';
    }).join('') : '<div class="search-empty">没有找到，试试「语音」「勿扰」或「登录」。</div>');
    $('searchResults').hidden = false;
    $('navSearch').setAttribute('aria-expanded', 'true');
    bindRoutes();
  }
  function renderThemeControl() {
    var label = { auto: '跟随宿主 / 系统', light: '浅色', dark: '深色' }[themeMode];
    $('themeToggle').innerHTML = icon(themeMode === 'auto' ? 'monitor' : themeMode === 'dark' ? 'moon' : 'sun');
    $('themeToggle').title = '当前主题：' + label + '，点击切换';
    $('themeToggle').setAttribute('aria-label', '当前主题：' + label + '，点击切换');
  }
  function initNavigation() {
    $('tabs').innerHTML = NAV_GROUPS.map(function (g) {
      return '<button class="tab" data-group="' + g.id + '">' + icon(g.icon) + '<span><b>' + g.label + (g.id === 'home' ? ' <em class="nav-version" id="ver">v—</em>' : '') + '</b><small>' + g.note + '</small></span><span class="nav-arrow">›</span></button>';
    }).join('');
    if ($('ver')) $('ver').textContent = 'v' + (window.__bridgeVersion || '—');
    Array.prototype.forEach.call(document.querySelectorAll('[data-group]'), function (btn) {
      btn.onclick = function () { var g = NAV_GROUPS.filter(function (item) { return item.id === btn.getAttribute('data-group'); })[0]; navigate(groupLastPages[g.id] || g.pages[0]); };
    });
    var hash = location.hash.slice(1);
    tab = PAGE_HEADS[hash]&&pageVisible(hash) ? hash : 'overview';
    groupLastPages[groupFor(tab).id] = tab;
    syncNavigation();
    $('refreshIcon').innerHTML = icon('refresh');
    $('refresh').onclick = async function () { var btn = this; btn.disabled = true; btn.classList.add('refreshing'); try { var loaded = await load({refreshCompanion:true});if (loaded !== false) toast('数据已刷新'); } finally { btn.disabled = false; btn.classList.remove('refreshing'); } };
    $('themeToggle').onclick = function () { themeMode = { auto: 'light', light: 'dark', dark: 'auto' }[themeMode]; try { localStorage.setItem('qqb-ui-theme', themeMode); } catch (e) {} applyTheme(); renderThemeControl(); };
    renderThemeControl();
    $('navSearch').oninput = renderSearch;
    $('navSearch').onfocus = renderSearch;
    $('navSearch').onkeydown = function (event) {
      if (event.key === 'Escape') { closeSearch(); this.blur(); }
      if (event.key === 'ArrowDown') { var next = $('searchResults').querySelector('[data-go]'); if (next) { event.preventDefault(); next.focus(); } }
      if (event.key === 'Enter') { var first = $('searchResults').querySelector('[data-go]'); if (first && !$('searchResults').hidden) first.click(); }
    };
    $('searchResults').onkeydown = function (event) {
      var buttons = Array.prototype.slice.call(this.querySelectorAll('[data-go]'));
      var at = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' && at < buttons.length - 1) { event.preventDefault(); buttons[at + 1].focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); if (at > 0) buttons[at - 1].focus(); else $('navSearch').focus(); }
      if (event.key === 'Escape') { closeSearch(); $('navSearch').focus(); closeSearch(); }
    };
    if(!navEventsBound){navEventsBound=true;
    document.addEventListener('click', function (event) { if (!event.target.closest('.feature-search')) closeSearch(); });
    document.addEventListener('keydown', function (event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('navSearch').focus(); } });
    window.addEventListener('popstate', function () { navigate(location.hash.slice(1), false); });
    window.addEventListener('hashchange', function () { if (tab !== location.hash.slice(1)) navigate(location.hash.slice(1), false); });
    }
    bindRoutes();
  }


  function resizePromptEditor(){var frame=$('promptManagerFrame');if(!frame)return;var dock=$('panelDock'),bottom=dock&&dock.offsetParent!==null?Math.min(innerHeight,dock.getBoundingClientRect().top):innerHeight;frame.style.height=Math.max(160,bottom-frame.getBoundingClientRect().top-12)+'px';}
  addEventListener('resize',resizePromptEditor);
  function viewPromptManager(){setTimeout(function(){var frame=$('promptManagerFrame');if(frame)frame.addEventListener('load',resizePromptEditor);resizePromptEditor();},0);return '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button data-go="model" class="small ghost">← 返回模型设置</button><a href="/im-bridge/prompt-manager">独立打开编辑器 ↗</a></div><iframe id="promptManagerFrame" src="/im-bridge/prompt-manager" title="提示词管理 · 中文编辑" style="display:block;width:100%;max-width:100%;min-width:0;height:500px;border:1px solid #d6e6f8;border-radius:16px;background:#f2f7fd"></iframe>'; }

  function viewDeviceProfiles(){
    var p=deviceProfileData;if(!p)return '<div class="card"><h2>设备连接配置</h2><p>重新加载插件后可在这里查看当前设备的连接配置。</p></div>';
    var device=p.runtimeDevice,c=p.profiles[device],names={phone:'手机版',desktop:'电脑版'};
    return '<div class="card"><h2>'+names[device]+'连接配置</h2><p>群聊自主参与、图片理解、语音和回执处理共用同一套规则，当前插件版本 '+esc(p.version)+'。这里保存的就是当前设备使用的连接配置；换到另一台设备运行时会读取那台设备自己的配置，聊天与记忆逻辑保持一致。</p><div class="form-two"><label class="field">QQ 连接地址<input id="profileWsUrl" value="'+esc(c.wsUrl)+'"></label><label class="field">连接令牌<input id="profileToken" type="password" autocomplete="new-password" placeholder="'+(c.hasAccessToken?'已保存，留空保留':'未设置')+'"></label></div><label class="check-field"><input id="profileClearToken" type="checkbox">清除这套配置保存的连接令牌</label><label class="field">NapCat 目录<input id="profileNapcatDir" value="'+esc(c.napcatDir)+'"></label>'+(device==='desktop'?'<label class="field">启动器路径（留空自动选择）<input id="profileLauncher" value="'+esc(c.launcher)+'"></label>':'<p class="muted">手机版自动使用 DSH Go 本机 QQ 服务和手机媒体工具。</p>')+'<div class="btnrow"><button id="profileSave">保存'+names[device]+'配置</button></div><p id="profileResult" role="status" aria-live="polite">只影响当前设备的连接方式，不会改变聊天与记忆。</p></div>';
  }
  function bindDeviceProfiles(){
    if(!deviceProfileData)return;
    if($('profileSave'))$('profileSave').onclick=async function(){var button=this,device=deviceProfileData.runtimeDevice;if(deviceProfileSaving||deviceUiSwitchBusy)return;deviceProfileSaving=true;button.disabled=true;try{deviceProfileData=await api('POST','/im-bridge/device-profiles',{action:'save',device:device,profile:{wsUrl:$('profileWsUrl').value,accessToken:$('profileToken').value,clearToken:$('profileClearToken').checked,napcatDir:$('profileNapcatDir').value,launcher:$('profileLauncher')?.value||''}});if($('profileToken'))$('profileToken').value='';if($('profileClearToken'))$('profileClearToken').checked=false;if($('profileResult'))$('profileResult').textContent=deviceProfileData.applied?'当前设备配置已保存并应用。':'配置已保存，下次在这台设备运行时生效。';if(renderedTab==='devices'){formBaselines.devices.profileToken='';formBaselines.devices.profileClearToken=false;rememberDraft('devices');renderDraftNotice();}toast('设备配置已保存');}catch(e){if($('profileResult'))$('profileResult').textContent=e.message;toast(e.message);}finally{deviceProfileSaving=false;if(button.isConnected)button.disabled=false;}};
  }

  function viewDevices(){return viewDeviceProfiles()+'<div class="card"><h2>运行设备</h2><p>可直接启用本机桥接。另一端已连接时会先暂停另一端；未连接时只能确认本机状态。跨设备搬移资料仍使用下方的数据线同步。</p><button id="deviceLocal">在本机启用桥接</button><div id="deviceStatus" role="status" aria-live="polite">正在检查设备连接…</div><div class="row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"><button id="devicePhone">在手机运行</button><button id="deviceDesktop">在电脑运行</button></div></div><div class="card"><h2>数据线同步</h2><p>用数据线连接已配对手机，保持手机 DSH Go 与电脑 Harness 打开。点击同步即可双向传输，拔线后各自保留完整资料。</p><p>同步包含插件设置、API 密钥、已保存的支付保险箱、聊天记录、日历记忆、学习成长、角色参考、表情、图片、语音和附件。设备自己的 QQ 登录连接保留在本机。</p><p>一键同步规则：插件源码以版本号更高的一端为准；资料按记录合并、去重，两端新增内容都会保留。同名冲突保留双方私有副本，素材同名不同内容会另外保存。停用与删除标记优先，不恢复旧待发消息。</p><button id="deviceSync" style="margin-top:12px">一键同步</button><button class="ghost" id="deviceRefresh">检查连接</button><p id="deviceProgress" role="status" aria-live="polite" style="overflow-wrap:anywhere"></p><p id="deviceLastSync" role="status" aria-live="polite"></p></div>';}
  function deviceReloadNotice(status){
    if(status.self?.codeReloadRequired||status.peer?.codeReloadRequired)return '插件版本已传输，请重载需要更新的设备以启用新代码。';
    if(!status.lastSync?.codeReloadRequired)return '';
    return status.peer?'当前两端均已加载代码，无需重载。':'本机无需重载；另一端未连接，加载状态尚未核验。';
  }
  async function bindDevices(){
    bindDeviceProfiles();
    var panel=$('deviceStatus'),working=false,syncReady=false,serviceBusy=false,polling=false,pollTimer=null;
    if(!panel)return;
    function current(){return panel.isConnected&&$('deviceStatus')===panel;}
    function disabled(){if(!current())return;['devicePhone','deviceDesktop','deviceSync'].forEach(function(id){if($(id))$(id).disabled=working||!syncReady;});if($('deviceLocal'))$('deviceLocal').disabled=working||serviceBusy;if($('deviceRefresh'))$('deviceRefresh').disabled=working;}
    function watch(){if(pollTimer)return;pollTimer=setInterval(function(){if(!current()){clearInterval(pollTimer);pollTimer=null;return;}if(!polling)void refresh();},2000);}
    function showProgress(value){var target=$('deviceProgress');if(!target)return;if(!value){target.textContent='';return;}var names={connecting:'正在连接设备',pausing:'正在保存资料并暂停桥接',scanning:'正在核对两端文件清单',planning:'正在合并与去重',transferring:'正在传输',applying:'传输完毕，正在应用',verifying:'正在逐项校验',reloading:'正在加载同步后的资料',completed:'同步完成，校验已通过'},label=names[value.phase]||'同步处理中';if(value.status==='failed')label='同步未完成';if(value.status==='interrupted')label='同步已中断';target.textContent=label+(value.filesTotal?' · '+value.filesDone+' / '+value.filesTotal+' 项 · '+(Number(value.bytesDone||0)/1048576).toFixed(1)+' / '+(Number(value.bytesTotal||0)/1048576).toFixed(1)+' MB':'')+(value.currentFile?' · 当前文件：'+value.currentFile:'')+(value.error?' · '+value.error:'');}
    async function refresh(){if(polling||!current())return;polling=true;try{var r=await api('GET','/im-bridge/device-sync');if(!current())return;var devices=[r.self,r.peer].filter(Boolean),names={phone:'手机',desktop:'电脑'},status=devices.map(d=>names[d.device]+'：v'+d.version+' · '+(d.paused?'待机':d.connected?'运行中':'等待QQ连接')).join(' ｜ ')+'。'+(r.usbConnected?'数据线已连接，可同步资料。':r.error||'等待连接数据线：请允许 USB 调试，并保持手机 DSH Go 内的 DSH 运行。');panel.textContent=status;showProgress(r.progress);if(r.busy||working)watch();else if(pollTimer){clearInterval(pollTimer);pollTimer=null;}if($('deviceStatus'))$('deviceStatus').textContent=status;serviceBusy=!!r.busy;syncReady=!!r.usbConnected&&!serviceBusy;var last=r.lastSync;if(last&&$('deviceLastSync'))$('deviceLastSync').textContent='最近同步：'+new Date(last.at).toLocaleString('zh-CN')+' · 校验 '+last.verifiedFiles+' 份文件，传输 '+last.files+' 份，保留 '+last.conflicts+' 份冲突副本。版本优先：'+(last.selectedVersion||'较高版本')+'；资料策略：合并保留。'+deviceReloadNotice(r);disabled();}catch(e){if(!current())return;syncReady=false;panel.textContent='连接检查未完成：'+e.message;disabled();}finally{polling=false;}}
    async function act(action,device){if(working||!current())return;working=true;disabled();watch();if($('deviceLastSync'))$('deviceLastSync').textContent=action==='sync'?'正在同步，请保持数据线连接…':'正在切换运行设备…';try{var r=await api('POST','/im-bridge/device-sync',{action:action,device:device});if(!current())return;toast(r.legacyVersionUpgradeOnly?'新版源码已写入，请重载旧版插件后再次一键同步资料':r.codeReloadRequired?'版本与资料已传输，请重载两端插件后启用桥接':action==='activate-local'?(r.peerCoordinated?'本机桥接已启用':'本机桥接已启用，另一端未连接'):action==='switch'?'已切换到'+(device==='phone'?'手机':'电脑'):'资料同步完成');if(action==='sync'&&$('deviceLastSync'))$('deviceLastSync').textContent='资料同步完成';}catch(e){if(!current())return;if($('deviceLastSync'))$('deviceLastSync').textContent='未完成：'+e.message+'。已传输的资料和恢复前副本会保留。';toast(e.message);}finally{working=false;if(current())await refresh();}}
    if($('deviceLocal'))$('deviceLocal').onclick=()=>act('activate-local');if($('devicePhone'))$('devicePhone').onclick=()=>act('switch','phone');if($('deviceDesktop'))$('deviceDesktop').onclick=()=>act('switch','desktop');if($('deviceSync'))$('deviceSync').onclick=()=>act('sync');if($('deviceRefresh'))$('deviceRefresh').onclick=refresh;await refresh();
  }

  var pageOutlineAt = 0;
  /* 把这一页的结构、配色和可疑的溢出写进日志：改完样式后能自己核对，而不是全靠截图。 */
  function reportPageOutline() {
    if (Date.now() - pageOutlineAt < 8000) return;
    pageOutlineAt = Date.now();
    var pageName = PAGE_HEADS[tab] ? PAGE_HEADS[tab][0] : tab;
    var heads = Array.prototype.slice.call(document.querySelectorAll('#pane .card h2, #pane .section-heading h2')).slice(0, 12).map(function (h) { return h.textContent.trim(); }).filter(Boolean);
    var overflow = Array.prototype.slice.call(document.querySelectorAll('#pane *')).filter(function (el) {
      return el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 4;
    }).slice(0, 6).map(function (el) {
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && el.className.toString ? '.' + String(el.className).split(' ')[0] : '');
    });
    var card = document.querySelector('#pane .card');
    var bodyStyle = getComputedStyle(document.body);
    var cardStyle = card ? getComputedStyle(card) : null;
    var textSize = card ? cardStyle.fontSize : '';
    reportClient('界面 ' + pageName +
      '｜底 ' + bodyStyle.backgroundColor +
      '｜卡 ' + (cardStyle ? cardStyle.backgroundColor + '/' + cardStyle.color + '/' + textSize : '无') +
      '｜卡片 ' + (heads.join('；') || '无') +
      '｜溢出 ' + (overflow.join('，') || '无'));
  }

  function renderPane() {
    document.body.dataset.promptEditor=String(tab==='prompts');
    if(qzoneHealthTimer){clearInterval(qzoneHealthTimer);qzoneHealthTimer=null;}
    if(tab!=='local')stopLocalRunWatch();if(invocationTimer){clearInterval(invocationTimer);invocationTimer=null;}
    constellationMount?.destroy();constellationMount=null;
    rememberDraft(renderedTab);
    stopQrWatch();
    var group = groupFor(tab);
    var renderers = { prompts:viewPromptManager,daily:rebuiltDaily,diary:rebuiltDiary,star:rebuiltStar,study:viewStudy,songs:viewSongs,devices: viewDevices, delivery: viewDelivery, activity: viewActivity, invocations:viewInvocations,directives:viewDirectives, qzone:viewQzone, profiles: viewProfiles, backup: viewBackup, overview: companionHome, monitor: viewMonitor, send: viewSend, sessions: viewSessions, persona: viewPersona, memory: viewMemory, autonomy: viewAutonomy, thoughts: viewThoughts, sticker: viewSticker, collect: viewCollect, photo: viewPhoto, voice: viewVoiceCard, imagegen: viewImagegen, videogen:viewVideogen, connection: viewConnection, services: viewServiceConnections, bilibili: viewBilibili, websitemcp: viewWebsiteMcp, local: viewLocal, whitelist: viewWhitelist, model: viewModelSettings, storage: viewStorage, logs: viewLogs };
    var head = PAGE_HEADS[tab];
    var samePage = renderedTab === tab;
    const audioScope=String(data.settings.activeAccountId||'');
    const previousAudio=samePage?document.querySelector('[data-rh-audio]'):null;
    var panelView = samePage ? capturePanelView($('pane')) : null;
    var spendView = samePage&&tab==='overview'&&$('homeSpend')?.dataset.scope===homeSpendScope() ? $('homeSpend') : null;
    var html = '<div class="pagehead"><div><div class="page-eyebrow">' + (group.id === 'home' ? 'OVERVIEW' : group.label) + '</div><h1>' + head[0] + '</h1><p>' + head[1] + '</p></div><span class="page-decoration">' + icon(group.icon) + '</span></div>';
    if (group.pages.length > 1) html += renderPageNavigation(group,tab,PAGE_HEADS,esc);
    html += '<div class="draft-notice" id="draftNotice" hidden><span id="draftText"></span><button class="small ghost" id="discardDraft">放弃修改</button></div>';
    if (tab === 'overview') html += '<div class="dashboard-live"><span class="live-label"><i class="status-dot online"></i><span id="liveSnapshot">实时同步状态</span></span></div>';
    const audioSettings=tab==='voice'?'speech':tab==='local'?'speech,sing':'';
    html += '<div class="page-content page-' + tab + '">' + renderers[tab]() + (audioSettings?'<div data-rh-audio="'+audioSettings+'"></div>':'') + '</div>';
    $('pane').innerHTML = html;
    const nextAudio=document.querySelector('[data-rh-audio]');
    if(nextAudio&&previousAudio?.dataset.rhScope===audioScope)nextAudio.replaceWith(previousAudio);
    if(spendView&&$('homeSpend'))$('homeSpend').replaceWith(spendView);
    restorePanelView($('pane'),panelView,{layoutOnly:true});
    renderedTab = tab;
    if(tab==='overview')overviewRenderSig=overviewSignature();
    syncNavigation();
    bind();
    enhanceCards();
    enhancePageNavigation($('pane'));
    try{ reportPageOutline(); }catch(e){}
    if (tab === 'model') renderModelPickers();
    applyOpenPermissionControls();
    startFormTracking();
    bindEnhancements();bindInvocations();bindDirectives();
    bindFeatureUI();bindQzone();
    bindCompanionPanel();
    bindRebuiltCompanion();
    if(mobileApiOnly()){['agWorkspace','igDir','cacheInput','memDir'].forEach(function(id){var el=$(id);if(el&&id!=='cacheInput'&&id!=='memDir')el.closest('label')?.setAttribute('data-desktop-only','');});if($('cacheInput'))$('cacheInput').placeholder='手机内的目录，留空使用默认位置';if($('agDesktop')){$('agDesktop').checked=false;$('agDesktop').disabled=true;$('agDesktop').closest('label')?.setAttribute('hidden','');}if($('agWorkspace'))$('agWorkspace').closest('label')?.remove();}
    applyPreviewControls();
    if(tab==='devices')bindDevices();
    bindVoiceStudio();
    const runningHubAudio=document.querySelector('[data-rh-audio]');
    if(runningHubAudio&&!runningHubAudio.dataset.rhReady)void import('./runninghub-audio-ui.js').then(({mountRunningHubAudio})=>{
      if(runningHubAudio.isConnected&&!runningHubAudio.dataset.rhReady){
        mountRunningHubAudio(runningHubAudio,{settings:data.settings.voice.runninghub,api,esc});
        runningHubAudio.dataset.rhReady='true';
        runningHubAudio.dataset.rhScope=audioScope;
      }
    }).catch(()=>{if(runningHubAudio.isConnected)runningHubAudio.textContent='RunningHub 音频设置暂未加载，请重新加载 QQ 桥接。';});
    syncFloatingSave();
    if (tab === 'logs') loadLog();
    if(panelView)restorePanelView($('pane'),panelView);else window.scrollTo({left:0,top:0,behavior:'instant'});
    if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
    if (tab === 'monitor') monitorTimer = setInterval(function () {
      if (tab !== 'monitor' || (document.activeElement && document.activeElement.closest('.modal'))) return;
      api('GET', '/im-bridge/messages').then(function (v) { if (tab === 'monitor') { monitor = v; renderPane(); } }).catch(function () {});
    }, 2000);
  }
  function enhanceCards() {
    if ($('igKey')) $('igKey').value = imagegenTypedKeys.siliconflow || '';
    if ($('rhKey')) $('rhKey').value = imagegenTypedKeys.runninghub || '';
    // Consistent labels for legacy forms; no element is replaced, so handlers stay attached.
    Array.prototype.forEach.call($('pane').querySelectorAll('input, textarea, select'), function (el) {
      if (!el.id || el.getAttribute('aria-label') || el.closest('label') || $('pane').querySelector('label[for="' + el.id + '"]')) return;
      var previous = el.previousElementSibling;
      if (previous && previous.tagName === 'LABEL' && !previous.getAttribute('for')) previous.setAttribute('for', el.id);
      else el.setAttribute('aria-label', el.placeholder || ({ mProvider: '模型服务商', mModel: '聊天模型', pvPersona: '试聊人设', sendSticker: '附带表情', sendTarget: '发送对象', igModel: '生图模型' }[el.id] || el.id));
    });
    if ($('accToken')) { $('accToken').type = 'password'; $('accToken').autocomplete = 'new-password'; }
    Array.prototype.forEach.call($('pane').querySelectorAll('button'), function (button) {
      var text = button.textContent.trim();
      if (['开', '关', '已开', '已关', '已开启', '已关闭'].indexOf(text) !== -1 && (button.id || button.hasAttribute('data-auto') || button.hasAttribute('data-toggle') || button.hasAttribute('data-ownerperm'))) {
        var on = text === '开' || text === '已开' || text === '已开启';
        button.classList.add('toggle-control');
        button.setAttribute('aria-pressed', String(on));
        var row = button.closest('.row');
        var description = row && row.querySelector('span');
        if (description) button.setAttribute('aria-label', description.textContent.split('\n')[0] + '：' + text);
      }
    });
  }

  function row(label, value) {
    return '<div class="row"><span>' + label + '</span><span class="muted">' + value + '</span></div>';
  }

  function viewSend() {
    var st = data.status;
    var targets = [];
    (st.chats || []).forEach(function (c) { targets.push(c.key); });
    (st.allowUsers || []).forEach(function (u) {
      var key = 'private:' + u;
      if (targets.indexOf(key) === -1) targets.push(key);
    });
    (st.allowGroups || []).forEach(function (g) {
      var key = 'group:' + g;
      if (targets.indexOf(key) === -1) targets.push(key);
    });
    var files = data.stickerFiles || [];
    var out = '<div class="card"><h2>以她的身份发一条</h2>' +
      '<div class="muted" style="margin-bottom:10px">直接调用 NapCat 发送，不经过模型——用来纠正她的话、补发提示、或者手动喂一张图。</div>';
    out += '<label class="field">发送对象</label><select id="sendTarget">' +
      targets.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') +
      '<option value="__custom">手动输入…</option></select>';
    out += '<input id="sendCustom" placeholder="private:QQ号 或 group:群号" style="margin-top:8px;display:none">';
    out += '</div>';

    out += '<div class="card"><h2>内容</h2>' +
      '<label class="field">文字</label><textarea id="sendText" placeholder="要发的文字，可留空"></textarea>' +
      '<label class="field" style="margin-top:8px">语音（填了就用这条合成语音）</label>' +
      '<input id="sendVoice" placeholder="例如：喂，我回来了">' +
      '<label class="field" style="margin-top:8px">附带表情</label>' +
      '<select id="sendSticker"><option value="">不发图</option>' +
      files.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<div class="btnrow" style="margin-top:12px"><button class="primary" id="sendGo">发送</button>' +
      '<span class="muted" id="sendOut"></span></div></div>';

    out += '<div class="card"><h2>快捷补救</h2><div class="btnrow">' +
      '<button class="small" id="sendFillSorry">「刚才说错了，别当真」</button>' +
      '<button class="small" id="sendFillBusy">「我去忙一会儿，回头找你」</button>' +
      '<button class="small" id="sendFillNight">「睡了，晚安」</button></div></div>';
    return out;
  }

  function viewOverview() {
    var st = data.status;
    var settings = data.settings;
    var cost = st.cost || {};
    var auto = st.autonomy || { config: {}, state: {} };
    var counts = auto.state.counts || {};
    var persona = st.personaName || st.preset || '未选择人设';
    var stateLabel = st.accountPaused ? '连接已暂停' : (st.connected ? '一切就绪，聊点什么吧。' : '连接你的第一个对话。');
    var day = new Date();
    var dayText = day.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    var out = '<div class="dashboard">';
    out += '<section class="welcome"><div class="eyebrow">YOUR EVERYDAY COMPANION<span>' + esc(dayText) + '</span></div>' +
      '<div class="welcome-body"><div><span class="welcome-status"><i class="status-dot ' + (st.connected ? 'online' : '') + '"></i>' + (st.connected ? '机器人在线' : '机器人未连接') + '</span>' +
      '<h2>' + stateLabel + '</h2><p>让每一次回应，都有自己的性格。</p>' +
      '<div class="btnrow"><button class="primary" data-go="' + (st.connected ? 'monitor' : 'connection') + '">' + icon(st.connected ? 'chat' : 'link') + (st.connected ? '查看对话' : '设置连接') + '</button>' +
      '<button class="hero-secondary" data-go="persona">调整角色 ' + icon('arrow') + '</button></div></div>' +
      '<div class="bridge-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>' +
      '<div class="float-bubble bubble-one">' + icon('chat') + '</div><div class="float-bubble bubble-two">' + icon('spark') + '</div>' +
      '<div class="bridge-mark"><svg viewBox="0 0 110 86" fill="none"><path d="M16 39C15 19 35 9 55 13c13 3 19 13 19 24 9 0 13-7 20-13 0 17-7 31-24 32-8 14-26 20-42 10C18 60 15 50 16 39Z" fill="currentColor"/><path d="M33 54c6 5 16 6 24 1" stroke="#dceee6" stroke-width="3" stroke-linecap="round"/><circle cx="37" cy="34" r="3.5" fill="#dceee6"/><path d="M47 6c2-5 8-5 10-1M61 8c6-4 11-1 10 4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>' +
      '<span class="art-caption">QQ ↔ DSH</span></div></div></section>';
    out += '<section class="card companion-card"><div class="section-heading"><span class="eyebrow">当前角色</span><span class="tag accent-tag">' + (st.connected ? '正在陪伴' : '已配置') + '</span></div>' +
      '<div class="companion-avatar">' + icon('whale') + '</div><h2>' + esc(persona) + '</h2><p>每个对话，都延续同一个她。</p>' +
      '<div class="companion-meta"><span>记忆 <b>' + (settings.memory && settings.memory.enabled ? '已开启' : '已关闭') + '</b></span><span>语音 <b>' + (settings.voice && settings.voice.enabled ? '已开启' : '已关闭') + '</b></span></div>' +
      '<button class="companion-edit" data-go="persona">管理角色设定 ' + icon('arrow') + '</button></section>';
    var metrics = [
      ['chat', (st.chats || []).length, '活跃会话', '独立上下文，持续聊天', 'sessions'],
      ['users', (st.allowUsers || []).length + (st.allowGroups || []).length, '可用联系人 / 群', '管理谁可以与她交流', 'whitelist'],
      ['wallet', '¥' + Number(cost.today || 0).toFixed(3), '今日预估花费', '本轮 ¥' + Number(cost.last || 0).toFixed(4), 'model'],
      ['image', (data.stickerFiles || []).length, '表情素材', '给对话多一点表情', 'sticker']
    ];
    out += '<div class="metric-grid">' + metrics.map(function (m) {
      return '<button class="metric" data-go="' + m[4] + '"><span class="metric-label">' + m[2] + icon(m[0]) + '</span><b>' + m[1] + '</b><span class="metric-caption">' + m[3] + icon('arrow') + '</span></button>';
    }).join('') + '</div>';
    out += '<section class="card quick-card"><div class="section-heading"><h2>从这里开始</h2><span class="muted">常用操作，一步直达</span></div><div class="quick-grid">';
    [
      ['send', 'send', '发送消息', '文字、语音或表情'],
      ['persona', 'spark', '编辑人设', '让她更像你想的样子'],
      ['sticker', 'image', '整理素材', '上传、分组与停用'],
      ['autonomy', 'sun', '主动互动', '主动日常与休息']
    ].forEach(function (item) {
      out += '<button class="quick-action" data-go="' + item[0] + '"><span class="quick-icon">' + icon(item[1]) + '</span><span><b>' + item[2] + '</b><small>' + item[3] + '</small></span>' + icon('arrow') + '</button>';
    });
    out += '</div></section>';
    var recent = ((monitor && monitor.messages) || []).slice(-4).reverse();
    out += '<section class="card recent-card"><div class="section-heading"><h2>最近对话</h2><button class="text-link" data-go="monitor">查看全部 ' + icon('arrow') + '</button></div>';
    if (!recent.length) out += '<div class="empty">' + icon('chat') + '<b>第一句，从这里开始</b><span>连接 QQ 后，聊天记录会出现在这里。</span><button class="small" data-go="connection">前往账号与连接</button></div>';
    recent.forEach(function (m) {
      out += '<div class="recent-item"><span class="message-avatar ' + (m.dir === 'out' ? 'from-bot' : '') + '">' + icon(m.dir === 'out' ? 'whale' : 'user') + '</span>' +
        '<div><b>' + esc(m.dir === 'out' ? persona : notesLabel(m.chat || '')) + '<time>' + esc(new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })) + '</time></b><p>' + esc(m.text || (m.file ? '[图片]' : '[附件]')) + '</p></div></div>';
    });
    out += '</section><section class="card activity-card"><div class="section-heading"><h2>今天的主动互动</h2><span class="state-label"><i class="status-dot ' + (auto.config.enabled ? 'online' : '') + '"></i>' + (auto.config.enabled ? '已开启' : '未开启') + '</span></div>' +
      '<div class="activity-numbers"><span><b>' + (counts.chats || 0) + '</b>主动找人</span><span><b>' + (counts.signature || 0) + '</b>更新签名</span><span><b>' + (counts.qzone || 0) + '</b>空间动态</span></div>' +
      '<p class="muted">主动聊天、追问与补充回复，都可以按你的节奏来。</p><button class="activity-link" data-go="autonomy">设置互动节奏 ' + icon('arrow') + '</button></section>';
    out += walletMarkup();
    out += '<div class="dashboard-note">' + viewUsageNote() + '<span>' + icon('shield') + '本地运行 · QQ / IM 桥接</span></div></div>';
    return out;
  }


  function localJson(response) {
    return response.text().then(function (text) {
      var body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
      if (!response.ok || !body) {
        var error = body && body.error;
        if (error && typeof error === 'object') error = error.message;
        throw new Error(response.status === 404 ? '插件后端还没加载这个页面，重启 DeepSeek Harness 后再刷新' : (error || ('HTTP ' + response.status)));
      }
      return body;
    });
  }
  function localPost(payload) {
    if(payload.action==='save')return api('POST','/im-bridge/local',payload);
    return fetch('/im-bridge/local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(localJson);
  }

  var localGateway = null;
  var localRunTimer=null,localRunBusy=false,localRunSnapshot=null,localTrialResult=null,localTrialBusy=false;
  function localRunMarkup(){
    return '<section class="card" id="localRunPanel" aria-live="polite"><div class="section-heading"><h2>本地运行状态</h2><span class="tag" id="localRunBadge">读取中…</span></div><p id="localRunCurrent" style="white-space:pre-wrap">正在连接网关…</p><p class="muted" id="localRunQueue"></p><p class="muted" id="localRunVersion"></p><div id="localRunLatest"></div><details><summary>最近任务（本次网关启动）</summary><div id="localRunHistory"></div></details><p class="muted">每 2 秒更新。生成完成和 QQ 送达分别显示；上下文整理保留人设与当前问题，历史记录不会删除。</p></section>';
  }
  function paintLocalRun(value){
    localRunSnapshot=value;if(!$('localRunPanel'))return;
    var execution=value.execution||{},active=execution.active||[],recent=execution.recent||[];
    if(!active.length&&value.hostPreparation?.length)active=value.hostPreparation;
    var labels={preparing:'准备 / 切换模型',transcription:'本机识别语音',waiting_gateway:'等待本地网关接收',waiting_gpu:'等待本地资源',waiting_comfy:'等待已有 ComfyUI 任务',model:'生成回复（含模型加载）',understanding:'理解前文、指代与口语',vision:'识别图片',image_prompt:'按人设和日程准备画面提示词',speech:'合成语音',tool:'执行工具',tool_done:'工具已返回',repair:'检测到复读，正在修正',repaired:'复读已修正',context:'调取资料 / 整理上下文',complete:'已结束'};
    var origins={qq:'QQ 消息',preview:'窗口试聊',api:'本机兼容接口',speech:'语音请求',analysis:'后台分析',initiative:'本地主动任务','initiative-helper':'主动任务辅助生成'},states={succeeded:'成功',partial:'部分完成',failed:'失败',cancelled:'已取消等待'};
    function featureText(row){var names={memory:'记忆',meme:'梗',learning:'学习经验',expression:'表达',mood:'情绪',intent:'相处方式',life:'生活与关系',pending:'待决定事项'};return Object.keys(names).filter(function(key){return row.features&&row.features[key]>0;}).map(function(key){return names[key];}).join('、');}
    function contextText(context){if(!context)return '';var node=context.node||{};return (node.context_limit?'上下文 '+node.used_tokens+' / '+node.context_limit+' token（节点估算）':context.limit?'输入约 '+context.inputEstimate+' token，窗口 '+context.limit+' token':'')+(context.continuity?' · 保留 '+Number(context.retainedMessages||0)+' 条近期对话':'')+(context.reset?' · 已自动重置旧上下文':context.droppedMessages?' · 已整理 '+context.droppedMessages+' 条旧消息':'')+(context.promptCompacted?' · 已精简本轮提示词':'')+(context.personaCompacted?' · 人设使用关键句摘录，原文未修改':'');}
    function mediaTaskText(row){var task=row.mediaTask;if(!task)return '';var names={image:'图片',speech:'语音',video:'视频'};return task.ambiguous?'媒体指代待确认（未开始生成）':task.requested&&task.requested.length?'本轮任务：'+task.requested.map(function(kind){return names[kind];}).join('、')+(task.source==='followup'?'（沿用最近人类请求）':task.source==='semantic'?'（本地模型判断）':''):'';}
    function summary(row){if(row.error)return row.error;var r=row.result||{},parts=[];if(r.textChars)parts.push('文字 '+r.textChars+' 字');if(r.speech)parts.push('语音 '+r.speech+' 条');if(r.images)parts.push('图片 '+r.images+' 张');if(r.videos)parts.push('视频 '+r.videos+' 个');if(r.toolsOk||r.toolsFailed)parts.push('工具成功 '+r.toolsOk+'、失败 '+r.toolsFailed);return parts.join('，')||'没有可发送内容';}
    function resultRow(row){return '<p><b>'+esc(states[row.status]||row.status)+' · '+esc(origins[row.origin]||row.origin)+'</b> · '+(Number(row.elapsedMs||0)/1000).toFixed(1)+' 秒 · '+esc(new Date(row.finishedAt||row.startedAt).toLocaleTimeString())+'<br>'+esc(summary(row))+(mediaTaskText(row)?'<br>'+esc(mediaTaskText(row)):'')+(row.repaired?' · 已修正复读':'')+(featureText(row)?'<br>本轮参考：'+esc(featureText(row)):'')+(row.context?'<br><span class="muted">'+esc(contextText(row.context))+'</span>':'')+'</p>';}
    $('localRunBadge').textContent=active.length?'运行中 · '+active.length+' 项':'空闲 / 等待消息';
    $('localRunBadge').className='tag'+(active.length?' accent-tag':'');
    $('localRunCurrent').textContent=active.length?active.slice(0,4).map(function(row){return (origins[row.origin]||row.origin)+' · '+(row.phase==='repair'&&row.repairReason==='unverified-media'?'核对真实任务状态':labels[row.phase]||row.phase)+' · 已运行 '+(Number(row.elapsedMs||0)/1000).toFixed(1)+' 秒'+(row.priority==='quality'?' · 连贯对话优先':row.mode==='dialogue'?' · 普通闲聊加速':'')+(row.outputTokens?' · 输出上限 '+row.outputTokens+' token':'')+(row.tool?' · '+row.tool:'')+(mediaTaskText(row)?'\n'+mediaTaskText(row):'')+(row.context?'\n'+contextText(row.context):'')+(featureText(row)?'\n本轮参考：'+featureText(row):'');}).join('\n\n'):'网关在线，当前没有由本网关跟踪的任务。'+(recent.length?' 最近一次结果见下方。':' 本次启动尚无任务。');
    var queue=value.comfyQueue,delivery=value.delivery,lines=[];
    (value.groupActivation||[]).forEach(function(row){lines.push('群 '+row.groupId+' · 关注剩余 '+Math.ceil(Number(row.remainingMs||0)/1000)+' 秒'+(row.paused?'（生成期间暂停）':''));});
    if(queue)lines.push(queue.reachable?'ComfyUI 队列（含手动任务）：运行 '+queue.running+'，等待 '+queue.pending:'ComfyUI 当前不可达');
    if(!active.length&&queue&&(queue.running||queue.pending))lines.push('ComfyUI 中还有手动任务或先前取消等待的任务，保留运行');
    if(delivery)lines.push('最近本地 QQ 消息：待发 '+delivery.queued+'，QQ已接收 '+delivery.sent+'，失败 '+delivery.failed+'，待核对 '+delivery.unknown);
    $('localRunQueue').textContent=lines.join(' · ');
    if($('localInitiativeStatus')){var initiative=value.localInitiative||{};$('localInitiativeStatus').textContent='主动聊天：'+(initiative.reason||'等待空闲检查')+(initiative.at?' · '+new Date(initiative.at).toLocaleTimeString():'');}
    var lastRoute=(value.modelRoutes||[]).slice(-1)[0];if(lastRoute)$('localRunCurrent').textContent+='\n最近处理：'+({local:'本地',unavailable:'本地暂不可用',api:'API'}[lastRoute.target]||lastRoute.target)+' · '+lastRoute.reason;
    $('localRunVersion').textContent='网关 '+(value.version||value.serviceVersion||'未知')+(value.hostVersion?' · 宿主 '+value.hostVersion:'')+(value.hostVersion&&value.version&&value.hostVersion!==value.version?' · 版本不同，重开宿主后加载新版收发逻辑':'');
    $('localRunLatest').innerHTML=recent.length?'<b>最后一次结果</b>'+resultRow(recent[0]):'';
    $('localRunHistory').innerHTML=recent.slice(1).map(resultRow).join('')||'<p class="muted">暂无更多任务。</p>';
  }
  function refreshLocalRun(){
    if(localRunBusy||!$('localRunPanel'))return Promise.resolve();localRunBusy=true;
    return fetch('/im-bridge/local/status',{cache:'no-store'}).then(function(response){
      if(response.status===404)return fetch('/im-bridge/local',{cache:'no-store'}).then(localJson).then(function(value){return {version:value.version,hostVersion:data?.status?.version,execution:value.execution,comfyQueue:value.queue};});
      return localJson(response);
    }).then(function(value){paintLocalRun(value);}).catch(function(error){if($('localRunBadge'))$('localRunBadge').textContent='离线 / 状态读取失败';if($('localRunCurrent'))$('localRunCurrent').textContent='未取得最新状态：'+error.message+'。下方保留的是上一次已读取结果。';}).finally(function(){localRunBusy=false;});
  }
  function stopLocalRunWatch(){if(localRunTimer)clearInterval(localRunTimer);localRunTimer=null;}
  function startLocalRunWatch(){stopLocalRunWatch();if(localRunSnapshot)paintLocalRun(localRunSnapshot);void refreshLocalRun();localRunTimer=setInterval(refreshLocalRun,2000);}
  function paintLocalTrial(){if(!localTrialResult||!$('localChatOut'))return;$('localChatOut').textContent=localTrialResult.text;if($('localReceipts'))$('localReceipts').textContent=localTrialResult.receipts||'';}
  var localWorkflowDraft = [];
  var localDefaultsDraft = { image: '', video: '' };
  var biliPanelState=null,biliPanelBusy=false,biliPollTimer=null,biliLastMaterial=null,biliPanelScope='',biliQrState=null;
  function biliScope(){return JSON.stringify([data?.settings?.activeAccountId,data?.settings?.contactProfiles?.['private:'+data?.settings?.owners?.[0]]?.personaId||data?.settings?.activePersonaId||data?.status?.persona?.id]);}
  function viewBilibili(){return biliPanelMarkup();}
  async function biliSelectedImages(){
    var files=Array.from($('biliImages')?.files||[]);if(files.length>3)throw Error('一次评论最多3张图片');var images=[];for(var file of files){if(file.size>12*1024*1024)throw Error('每张配图请小于12MB');images.push({data:await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(Error('配图读取失败'));};reader.readAsDataURL(file);})});}return images;
  }
  function bindBiliReplyTargets(){document.querySelectorAll('[data-bili-reply]').forEach(function(button){button.onclick=function(){$('biliReplyId').value=button.dataset.biliReply;$('biliReplyTarget').textContent=button.dataset.biliTarget;$('biliDraft').focus();};});}
  function biliPanelMarkup(){return '<section class="card" id="biliPanel"><div class="section-heading"><h2>B站账号与浏览</h2><span class="tag">当前 QQ 账号 · 当前角色</span></div><p class="muted">本地模型和 API 模型共用这份 B站登录、浏览记录与评论设置，无需启动本地网关。扫码登录后可找推荐、搜索、读取字幕与评论；评论先保存草稿，核对完整正文后再发布。</p><div class="btnrow"><button data-bili-action="login">扫码登录 / 换号</button><button data-bili-action="login-status">检查登录</button><button data-bili-action="status">刷新记录</button><button data-bili-action="logout">退出 B站账号</button></div><label class="check-field"><input id="biliPublishEnabled" type="checkbox">允许发布 B站评论</label><p class="muted">默认关闭，只浏览和保存草稿。开启后仍需核对正文并点击发布；开关按当前 QQ 账号和角色保存。</p><p id="biliStatus" class="muted" role="status">尚未读取状态</p><div id="biliQr"></div><label class="field">感兴趣的内容<input id="biliQuery" placeholder="留空刷推荐，也可输入搜索词"></label><div class="btnrow"><button data-bili-action="recommend">找推荐</button><button data-bili-action="search">搜索</button><button data-bili-action="browse">读两条新内容</button></div><div id="biliCandidates"></div><label class="field">视频 BV 号或链接<input id="biliVideo" placeholder="点击候选视频后自动填写"></label><div class="btnrow"><button data-bili-action="read">读取视频画面、字幕与评论</button></div><div id="biliMaterial"></div><label class="field">评论草稿<textarea id="biliDraft" rows="3" maxlength="1000" placeholder="按实际读到的内容写；保存草稿不会发布"></textarea></label><label class="field">回复目标（从已读评论选择）<input id="biliReplyId" placeholder="留空为新评论" readonly></label><p id="biliReplyTarget" class="muted"></p><button id="biliReplyClear" type="button">改为新评论</button><label class="field">评论配图（最多3张，保存草稿不上传）<input id="biliImages" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple></label><div id="biliImagePreview" class="btnrow"></div><button data-bili-action="draft">保存这条草稿</button><div id="biliDrafts"></div><details><summary>最近读取记录</summary><div id="biliHistory"></div></details></section>';}
  function biliPaintState(state){
    if(!$('biliPanel'))return;biliPanelState=state;
    if($('biliPublishEnabled'))$('biliPublishEnabled').checked=state.settings?.commentPublishEnabled===true;
    if($('biliStatus'))$('biliStatus').textContent=state.account?.loggedIn?'已保存登录：'+(state.account.name||'B站账号')+'（UID '+state.account.uid+'），可点击检查登录确认是否仍有效。':'尚未登录，公开热门视频仍可尝试读取。';
    biliPaintQr(state.login || null);
    if($('biliHistory'))$('biliHistory').innerHTML=(state.history||[]).map(function(item){return '<p><b>'+esc(item.title)+'</b><br><span class="muted">'+esc(item.coverage)+'</span> <button class="small" data-bili-read="'+esc(item.bvid)+'">再读这条</button></p>';}).join('')||'<p class="muted">还没有读取记录。</p>';
    if($('biliDrafts'))$('biliDrafts').innerHTML=(state.drafts||[]).map(function(draft){return '<article class="card"><b>'+esc(draft.title||draft.bvid)+'</b><p style="white-space:pre-wrap">'+esc(draft.text)+'</p>'+(draft.replyTo?'<blockquote>回复 '+esc(draft.replyTo.author)+'：'+esc(draft.replyTo.text)+'</blockquote>':'')+(draft.images?.length?'<p>配图 '+draft.images.length+' 张</p><div class="btnrow">'+draft.images.map(function(image,i){return '<button data-bili-preview="'+esc(draft.id)+'" data-image="'+esc(image.id)+'">查看配图 '+(i+1)+'</button>';}).join('')+'</div>':'')+'<p class="muted">'+esc((draft.accountMismatch?'属于其他 B站账号，请切回账号或重新保存草稿':({draft:'草稿，尚未发布',sending:'正在提交',sent:'已取得评论 ID：'+draft.rpid,unknown:'提交结果待核对，不会自动重试',failed:'提交失败：'+(draft.error||'')}[draft.status]))||draft.status)+'</p>'+(draft.status==='draft'&&!draft.accountMismatch&&state.settings?.commentPublishEnabled===true?'<button class="primary" data-bili-publish="'+esc(draft.id)+'">发布上面这条完整评论</button>':'')+'</article>';}).join('');
    biliBindRows();
  }
  function biliSchedulePoll(){
    clearTimeout(biliPollTimer);
    if(!$('biliPanel')||!biliQrState||!['waiting','scanned','verifying'].includes(biliQrState.status))return;
    biliPollTimer=setTimeout(function(){
      if(!$('biliPanel'))return;
      if(biliPanelBusy)biliSchedulePoll();else void biliRequest('login-status');
    },2500);
  }
  function biliPaintQr(value){
    if(!$('biliQr'))return;
    biliQrState=value ? Object.assign({},biliQrState||{},value) : null;
    if(biliPanelState)biliPanelState.login=biliQrState;
    if(!biliQrState){$('biliQr').innerHTML='';clearTimeout(biliPollTimer);return;}
    var expired=biliQrState.status==='expired'||biliQrState.status!=='verifying'&&Number(biliQrState.expiresAt||0)<=Date.now();
    if(expired||biliQrState.status==='failed'){
      $('biliQr').innerHTML='';$('biliStatus').textContent=expired?'二维码已失效，请点击扫码登录重新申请。':'扫码登录未完成，请点击扫码登录重新申请。';
      biliQrState.status=expired?'expired':'failed';clearTimeout(biliPollTimer);return;
    }
    if(biliQrState.qrImage&&/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(biliQrState.qrImage))$('biliQr').innerHTML='<p>用手机 B站扫码并确认登录，二维码约 3 分钟有效。</p><img style="width:260px;max-width:100%;image-rendering:pixelated;background:white;padding:8px" alt="B站登录二维码" src="'+esc(biliQrState.qrImage)+'">';
    $('biliStatus').textContent=({waiting:'等待手机 B站扫码。',scanned:'已扫码，请在手机 B站确认登录。',verifying:'手机已确认，正在校验登录状态…'})[biliQrState.status]||'等待扫码。';
    biliSchedulePoll();
  }
  function biliFramePreview(frames){
    var valid=(frames||[]).slice(0,8).filter(function(f){return f.part&&['image/jpeg','image/png'].includes(f.part.mediaType)&&typeof f.part.data==='string'&&f.part.data.length<4*1024*1024&&/^[A-Za-z0-9+/=]+$/.test(f.part.data);});
    if(!valid.length)return '';
    return '<details open><summary>当前连续时间窗画面 '+valid.length+' 张</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">'+valid.map(function(f){return '<figure style="margin:0"><img style="width:100%;border-radius:8px" loading="lazy" alt="视频抽样 '+esc(f.at)+' 秒" src="data:'+f.part.mediaType+';base64,'+f.part.data+'"><figcaption>'+esc(f.at)+' 秒</figcaption></figure>';}).join('')+'</div><p class="muted">画面按播放进度持续读取，每次展示最新窗口；后续继续读取，未观察的时间段不算已经看过。理解画面需要聊天API支持视觉。</p></details>';
  }
  function biliPaintMaterial(result){
    if(!$('biliMaterial'))return;biliLastMaterial=result;
    var materials=result.items&&result.items.some(function(item){return item.video||item.error;})?result.items:[result];
    $('biliMaterial').innerHTML=materials.map(function(item){return '<article class="card"><h3>'+esc(item.video?.title||item.title||item.bvid||'读取结果')+'</h3><p class="muted">'+esc(item.coverage||item.error||'')+'</p>'+(item.errors?.length?'<p class="muted">部分资料未取得：'+esc(item.errors.join('；'))+'</p>':'')+biliFramePreview(item.frames||(result.frames||[]).filter(function(f){return f.bvid===item.bvid;}))+(item.segments?.length?'<details open><summary>实际字幕'+(item.partial?'（已截短）':'')+'</summary><p style="white-space:pre-wrap;max-height:260px;overflow:auto">'+esc(item.segments.map(function(s){return '['+Math.floor(s.start)+'秒] '+s.text;}).join('\n'))+'</p></details>':'')+(item.comments?.length?'<details><summary>实际评论 '+item.comments.length+' 条</summary>'+item.comments.map(function(c){return '<article><p><b>'+esc(c.author)+'</b>：'+esc(c.text)+'</p><button data-bili-reply="'+esc(c.id)+'" data-bili-target="'+esc(c.author+'：'+c.text)+'">回复这条评论</button>'+(c.replies||[]).map(function(r){return '<blockquote>'+esc(r.author||'群友')+'：'+esc(r.text)+' <button data-bili-reply="'+esc(r.id)+'" data-bili-target="'+esc((r.author||'')+'：'+r.text)+'">回复</button></blockquote>';}).join('')+'</article>';}).join('')+'</details>':'')+'</article>';}).join('');bindBiliReplyTargets();
  }
  async function biliRequest(action,extra){
    if(biliPanelBusy)return;biliPanelBusy=true;var scope=biliScope();
    if($('biliStatus'))$('biliStatus').textContent='正在处理…';
    document.querySelectorAll('#biliPanel button,#biliPublishEnabled').forEach(function(b){b.disabled=true;});
    if(action==='login')biliPaintQr(null);
    try{
      var result=await api('POST','/im-bridge/features/bilibili',Object.assign({action:action,query:$('biliQuery')?.value||'',bvid:$('biliVideo')?.value||'',text:$('biliDraft')?.value||'',replyId:$('biliReplyId')?.value||'',...(action==='draft'?{images:await biliSelectedImages()}: {})},extra||{}));
      if(!$('biliPanel')||scope!==biliScope())return;
      if(result.account)biliPaintState(result);
      else if(['waiting','scanned','verifying','expired','failed'].includes(result.status))biliPaintQr(result);
      else if(result.status==='logged-in'||result.status==='logged-out'||action==='logout')biliPaintQr(null);
      else $('biliStatus').textContent=result.error||result.coverage||'操作已返回。';
      if(action==='login-status'&&result.status==='logged-in'&&$('biliStatus'))$('biliStatus').textContent='B站登录已核实，有效。'+(result.account?.name?' '+result.account.name:'');
      if(action==='login-status'&&result.status==='expired'&&$('biliStatus'))$('biliStatus').textContent='B站登录已过期，请重新扫码。';
      if(result.items&&!result.items.some(function(item){return item.video||item.error;})){
        $('biliCandidates').innerHTML='<p class="muted">'+esc(result.source==='popular-fallback'?'个性推荐暂不可用，显示公开热门':result.source==='popular'?'公开热门':'实际搜索或推荐结果')+'</p>'+result.items.map(function(item){return '<p><b>'+esc(item.title)+'</b> · '+esc(item.author)+' '+(item.read?'（已读过资料）':'')+' <button class="small" data-bili-read="'+esc(item.bvid)+'">读取内容</button></p>';}).join('');biliBindRows();
      }else if(result.video||result.items)biliPaintMaterial(result);
      if(result.draft){var snapshot=await api('POST','/im-bridge/features/bilibili',{action:'status'});if($('biliPanel')&&scope===biliScope())biliPaintState(snapshot);}
      if(action==='read'&&result.video?.bvid&&$('biliVideo'))$('biliVideo').value=result.video.bvid;
      if(action==='browse'&&result.items?.[0]?.bvid&&$('biliVideo'))$('biliVideo').value=result.items[0].bvid;
    }catch(error){if($('biliPanel')&&scope===biliScope()){if(/重新扫码|凭据|票据/.test(error.message))biliPaintQr({status:'failed',expiresAt:0});if($('biliStatus'))$('biliStatus').textContent='没有完成：'+error.message;if($('biliPublishEnabled'))$('biliPublishEnabled').checked=biliPanelState?.settings?.commentPublishEnabled===true;}}
    finally{biliPanelBusy=false;document.querySelectorAll('#biliPanel button,#biliPublishEnabled').forEach(function(b){b.disabled=false;});applyPreviewControls();biliSchedulePoll();if($('biliPanel')&&scope!==biliScope())void biliRequest('status');}
  }
  function biliBindRows(){
    document.querySelectorAll('[data-bili-read]').forEach(function(button){button.onclick=function(){if($('biliVideo'))$('biliVideo').value=button.dataset.biliRead;void biliRequest('read');};});
    bindBiliReplyTargets();
    if($('biliReplyClear'))$('biliReplyClear').onclick=function(){$('biliReplyId').value='';$('biliReplyTarget').textContent='';};
    document.querySelectorAll('[data-bili-preview]').forEach(function(button){button.onclick=async function(){try{var r=await api('POST','/im-bridge/features/bilibili',{action:'preview-image',draftId:button.dataset.biliPreview,imageId:button.dataset.image});var image=document.createElement('img');image.src=r.image;image.alt='本草稿的实际配图';image.style.maxWidth='100%';button.parentNode.appendChild(image);}catch(e){toast(e.message);}};});
    document.querySelectorAll('[data-bili-publish]').forEach(function(button){button.onclick=function(){void biliRequest('publish',{draftId:button.dataset.biliPublish,confirm:true});};});
  }
  function bindBiliPanel(){
    if(!$('biliPanel')){clearTimeout(biliPollTimer);return;}
    if(biliPanelScope!==biliScope()){biliPanelScope=biliScope();biliPanelState=null;biliLastMaterial=null;biliQrState=null;clearTimeout(biliPollTimer);}
    if($('biliPublishEnabled'))$('biliPublishEnabled').onchange=function(){void biliRequest('set-publish-enabled',{enabled:this.checked});};
    document.querySelectorAll('[data-bili-action]').forEach(function(button){button.onclick=function(){void biliRequest(button.dataset.biliAction,button.dataset.biliAction==='login'?{force:true}:{});};});
    if(biliPanelState)biliPaintState(biliPanelState);if(biliQrState)biliPaintQr(biliQrState);if(biliLastMaterial)biliPaintMaterial(biliLastMaterial);
    biliBindRows();if(!biliPanelBusy)void biliRequest('status');
  }

  var localConfigDraft = null;
  var localDraftEditing = false;
  var localImportState = null;
  var localModels = [];

  function localChatOptions(selected) {
    var custom=(localWorkflowDraft||[]).filter(function(x){return x.kind==='chat';});
    var entries=[{id:'',name:'请导入并选择聊天工作流'}].concat(custom);
    if(selected && !entries.some(function(x){return x.id===selected;})) entries.push({id:selected,name:selected});
    return entries.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.id===selected?' selected':'')+'>'+esc(x.name||x.id)+'</option>';}).join('');
  }
  function localCandidateSelect(key, mapping, candidates, attribute) {
    var value = mapping && mapping.node ? JSON.stringify({node:String(mapping.node),field:mapping.field}) : '';
    var choices = (candidates || []).slice();
    if(value && !choices.some(function(x){return String(x.node)===String(mapping.node)&&x.field===mapping.field;})) choices.push({node:mapping.node,field:mapping.field,label:'当前选择'});
    return '<select '+attribute+'><option value="">'+(key==='prompt'?'请选择提示词输入':'保持工作流原设置')+'</option>'+choices.map(function(x){
      var candidate=JSON.stringify({node:String(x.node),field:x.field});
      return '<option value="'+esc(candidate)+'"'+(candidate===value?' selected':'')+'>'+esc(x.label||x.field)+(x.reason?' · '+esc(x.reason):'')+'</option>';
    }).join('')+'</select>';
  }
  function localImportOutputs(a,kind) {
    var outputs=(a.outputs||[]).filter(function(x){return x.kind===kind;});
    if(kind==='chat')outputs=outputs.concat((a.manualOutputs||[]).filter(function(x){return !outputs.some(function(o){return o.node===x.node&&o.field===x.field;});}));
    return outputs;
  }
  async function applyLocalChatWorkflow(id) {
    var config=Object.assign({},captureLocalForm(),{backend:'comfyui',chatWorkflow:id}),result=await localPost({action:'save',gatewayUrl:$('localGatewayUrl').value.trim(),config:config,enabled:true,apiComplement:false,disableMixedRoutes:true});
    if(result.config?.chatWorkflow!==id)throw Error('网关未确认选中的聊天工作流，请检查运行版本');
    if(result.verified!==true||result.localChat?.enabled!==true||result.localChat?.apiComplement===true||result.routing?.routes?.enabled===true)throw Error('后台未确认纯本地模式，请重启 DSH 后刷新检查；没有把配置保存冒充模式切换成功');
    localConfigDraft=null;localDraftEditing=false;await localRefresh();renderPane();toast('已确认工作流并切换为纯本地，API 补全已关闭');
  }
  async function deleteLocalWorkflow(id,button){
    if(!id){toast('先选择要删除的工作流');return;}
    var draft=captureLocalForm(),item=localWorkflowDraft.find(function(x){return x.id===id;});
    if(!item){toast('该项不在工作流库中，请先刷新本地状态');return;}
    button.disabled=true;
    try{
      var saved=(localGateway?.config?.workflowLibrary||data.localChat?.workflowLibrary||[]).some(function(x){return x.id===id;});
      var result=saved?await localPost({action:'delete-workflow',workflowId:id}):null;
      localWorkflowDraft=localWorkflowDraft.filter(function(x){return x.id!==id;});
      if(draft.chatWorkflow===id)draft.chatWorkflow='';
      for(var kind of ['image','video'])if(localDefaultsDraft[kind]===id)localDefaultsDraft[kind]='';
      localConfigDraft=Object.assign({},draft,{workflowLibrary:localWorkflowDraft,defaultWorkflows:Object.assign({},localDefaultsDraft)});
      localDraftEditing=true;
      if(result?.config){if(localGateway)localGateway.config=result.config;data.localChat=Object.assign({},data.localChat,result.config);}
      renderPane();toast(saved?'已删除并保存；原工作流文件保留':'已移除尚未保存的条目');
    }catch(error){toast('没有删除：'+error.message);}finally{if(button.isConnected)button.disabled=false;}
  }
  function localImportMarkup() {
    var s=localImportState;
    var out='<div id="localWorkflowDrop" class="banner" style="margin:14px 0"><b>导入工作流，自动识别节点</b><p>选择或拖入 ComfyUI JSON 文件，普通工作流和 API 格式都可以。普通工作流需要连接 ComfyUI 读取节点定义。</p><input id="localWorkflowFile" type="file" accept=".json,application/json"></div>';
    if(!s)return out;
    out+='<div class="card" id="localImportPreview">';
    if(s.busy)return out+'<p role="status">正在读取工作流并识别节点…</p></div>';
    if(s.error)return out+'<p role="alert">'+esc(s.error)+'</p><button id="localImportCancel">关闭</button></div>';
    var a=s.analysis;
    out+='<h3>确认导入</h3><div class="form-two"><label class="field">名称<input id="localImportName" value="'+esc(s.name)+'"></label><label class="field">类型<select id="localImportKind">'+['image','video','chat'].filter(function(kind){return localImportOutputs(a,kind).length>0;}).map(function(kind){return '<option value="'+kind+'"'+(s.kind===kind?' selected':'')+'>'+({image:'图片',video:'视频',chat:'聊天模型'})[kind]+'</option>';}).join('')+'</select></label></div>';
    out+='<label class="field">用途（选填，帮助模型选择）<input id="localImportDescription" value="'+esc(s.description||'')+'" placeholder="例如：水彩插画、角色自拍、图生视频"></label>';
    (a.errors||[]).forEach(function(x){out+='<p role="alert">'+esc(x)+'</p>';});
    (a.warnings||[]).forEach(function(x){out+='<p class="muted">'+esc(x)+'</p>';});
    var pairs=[['prompt',s.kind==='chat'?'用户输入':'提示词'],['negativePrompt','反向提示词'],['seed','随机种子'],['image','输入图片']];
    if(s.kind==='chat')pairs=pairs.concat([['images','多模态图片列表'],['imageEnabled','本轮图片开关（布尔，可选）'],['system','人设 / 系统提示词'],['history','对话历史'],['requestId','请求编号'],['temperature','生成温度'],['maxTokens','回复长度']]);
    pairs.forEach(function(pair){var key=pair[0];if(key!=='prompt'&&!(a.candidates[key]||[]).length)return;
      out+='<label class="field">'+pair[1]+localCandidateSelect(key,s.inputs[key],a.candidates[key],'data-import-input="'+key+'"')+'</label>';
    });
    var selected=s.output?JSON.stringify(s.output):'';
    out+='<label class="field">返回哪个结果<select id="localImportOutput"><option value="">请选择输出结果</option>'+localImportOutputs(a,s.kind).map(function(x){var v=JSON.stringify(x);return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(x.label)+'</option>';}).join('')+'</select></label>';
    if(s.kind==='chat')out+='<label class="field">文本回执字段<input id="localImportTextField" value="'+esc(s.output?.field||'text')+'"><small class="muted">填写实际回传文本的字段，如 text、string、助手回复。自动识别不准确时，可手动选择节点并修改字段。</small></label><label class="check-field"><input id="localImportActivateChat" type="checkbox"'+(s.activateChat?' checked':'')+'>导入后用于本地聊天</label>';
    out+='<div class="btnrow"><button class="primary" id="localImportConfirm"'+((a.errors||[]).length||!s.inputs.prompt?.node||!s.output?' disabled':'')+'>导入并保存</button><button id="localImportCancel">取消</button></div></div>';
    return out;
  }
  function captureLocalImport() {
    var s=localImportState;if(!s||!s.analysis)return;
    if($('localImportName'))s.name=$('localImportName').value.trim();
    if($('localImportDescription'))s.description=$('localImportDescription').value.trim();
    document.querySelectorAll('[data-import-input]').forEach(function(el){s.inputs[el.dataset.importInput]=el.value?JSON.parse(el.value):{node:'',field:''};});
    if($('localImportOutput'))s.output=$('localImportOutput').value?JSON.parse($('localImportOutput').value):null;
    if(s.kind==='chat'&&s.output&&$('localImportTextField')){var field=$('localImportTextField').value.trim();if(field!==s.output.field)s.output={...s.output,field:field,manual:true};}
    if($('localImportActivateChat'))s.activateChat=$('localImportActivateChat').checked;
  }
  function analyzeLocalWorkflow(payload) {
    captureLocalForm();localDraftEditing=true;
    localImportState={busy:true};renderPane();
    localPost(Object.assign({action:'inspect-workflow'},payload)).then(function(result){
      var a=result.analysis,outputs=a.outputs.filter(function(x){return x.kind===a.kind;});if(!outputs.length)outputs=localImportOutputs(a,a.kind);
      localImportState={token:result.token,analysis:a,name:a.name,kind:a.kind,inputs:a.inputs,output:outputs.length===1?outputs[0]:null,description:'',activateChat:payload.kind==='chat'};
      renderPane();
    }).catch(function(error){localImportState={error:error.message};renderPane();});
  }
  function readLocalWorkflow(file,kind) {
    if(!file)return;if(file.size>20*1024*1024){toast('工作流超过 20MB，请精简后再导入');return;}
    file.text().then(function(raw){analyzeLocalWorkflow({workflow:raw,filename:file.name,kind:kind});}).catch(function(error){toast('读取文件失败：'+error.message);});
  }

  function localLibrary() {
    if (localDraftEditing) return localWorkflowDraft;
    return (localGateway && localGateway.config && Array.isArray(localGateway.config.workflowLibrary))
      ? localGateway.config.workflowLibrary
      : (localGateway && localGateway.capabilities && Array.isArray(localGateway.capabilities.workflowLibrary))
        ? localGateway.capabilities.workflowLibrary
        : localWorkflowDraft;
  }

  function localSetValue(id, value) {
    var el = $(id);
    if (!el || document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = value === true;
    else el.value = value == null ? '' : String(value);
  }

  function localBackendControls(){
    var backend=$('localBackend');if(!backend)return;
    var comfy=backend.value==='comfyui';
    ['localModelBaseUrl','localModelId'].forEach(function(id){var field=$(id);if(field)field.closest('label').style.display=comfy?'none':'';});
    if($('localModelsRefresh'))$('localModelsRefresh').style.display=comfy?'none':'';
    if($('localChatWorkflow'))$('localChatWorkflow').closest('label').style.display=comfy?'':'none';
    ['localApplyChat','localDeleteChat'].forEach(function(id){if($(id))$(id).style.display=comfy?'':'none';});
  }

  function localRender(v) {
    localGateway = v;if(v.localChat)data.localChat=Object.assign({},data.localChat,v.localChat);
    var badge = $('localBadge'), status = $('localStatus'), flows = $('localWorkflows');
    if (!badge || !status) return;
    var c = v.config || {};
    var workflowsChanged = false;
    if (!localDraftEditing && v && v.config) {
      if (Array.isArray(c.workflowLibrary)) {
        workflowsChanged = JSON.stringify(localWorkflowDraft) !== JSON.stringify(c.workflowLibrary);
        localWorkflowDraft = JSON.parse(JSON.stringify(c.workflowLibrary));
      }
      localDefaultsDraft = {
        image: String(c.defaultWorkflows && c.defaultWorkflows.image || ''),
        video: String(c.defaultWorkflows && c.defaultWorkflows.video || ''),
      };
      localSetValue('localBackend', c.backend || 'comfyui');
      localSetValue('localModelBaseUrl', c.modelBaseUrl || 'http://127.0.0.1:8000/v1');
      localSetValue('localModelId', c.modelId || (c.backend === 'openai' ? 'local-model' : c.chatWorkflow || ''));
      localSetValue('localChatWorkflow', c.chatWorkflow || '');
      localSetValue('localTemperature', c.temperature == null ? 0.7 : c.temperature);
      localSetValue('localMaxTokens', c.maxTokens || 512);
      localSetValue('localHistoryChars', c.historyChars || 12000);
      localSetValue('localVoiceEnabled', c.voiceEnabled !== false);
      localSetValue('localVoicePreset', c.voicePreset || '');
      Object.keys(localVoiceFields).forEach(function(key){if(key!=='apiKey')localSetValue('localVoice'+localVoiceFields[key],key==='timeoutMs'?Math.round((c.voiceService?.timeoutMs||600000)/1000):c.voiceService?.[key]||'');});
      localSetValue('localDialoguePriority',c.dialoguePriority||'quality');
      localSetValue('localFastDialogue',c.fastDialogue!==false);localSetValue('localStreamDialogue',c.streamDialogue!==false);
      localSetValue('localVisionMode', c.visionMode || 'auto');
      localSetValue('localMemoryProfile', c.memoryProfile || '8gb');
      localSetValue('localUrl', c.comfyUrl || c.baseUrl || 'http://127.0.0.1:8188');
      localSetValue('localIdle', c.idleUnloadMinutes || 10);
      localSetValue('localWarm', c.keepWarm !== false);
    }
    if (!localDraftEditing && v && v.localChat) {
      localSetValue('localGatewayUrl', v.localChat.baseUrl || 'http://127.0.0.1:8777');

    }
    var s = v.status || {};
    if (v.gateway && v.gateway.reachable && s.reachable) { badge.textContent = '网关与 ComfyUI 已连接'; badge.className = 'tag accent-tag'; }
    else if (v.gateway && v.gateway.reachable) { badge.textContent = '网关已连接'; badge.className = 'tag'; }
    else { badge.textContent = '连不上'; badge.className = 'tag'; }
    var lines = [];
    if(v.hostVersion&&v.hostVersion!=='1.61.9')lines.push('当前运行插件 '+v.hostVersion+'；此面板为 1.61.9。请重启 DSH 加载更新，旧进程无法启用新增参数与主动工具逻辑。');
    lines.push(v.localChat?.enabled?(v.localChat.apiComplement?'当前模式：本地，允许明确的 API 补全':'当前模式：纯本地，不使用 API 补全'):'当前模式：API；下方模型只是本地网关配置，尚未启用');
    lines.push('ComfyUI：' + (c.comfyUrl || s.baseUrl || ''));
    lines.push('聊天来源：' + (c.backend || 'comfyui') + ' · ' + (c.backend === 'openai' ? (c.modelId || '') : (c.chatWorkflow || '')));
    lines.push('看图：' + ({auto:'自动选择',native:'聊天模型直接看图',caption:'独立视觉模型观察',off:'已关闭'}[c.visionMode || 'auto']) + ' · 显存：' + (c.memoryProfile === 'workflow' ? '按工作流原参数' : '8GB 省显存方案'));
    var streaming=v.capabilities&&v.capabilities.streaming;if(streaming)lines.push('逐句输出：'+(!streaming.enabled?'已关闭':streaming.backend==='openai'?'使用模型服务流式能力':streaming.available?'ComfyUI 适配已就绪':'需重启 ComfyUI 加载流式适配，当前仍会完整返回文字'));
    var gpuInfo=v.capabilities && v.capabilities.memory && v.capabilities.memory.gpu || [];
    gpuInfo.forEach(function(gpu){lines.push('显卡：'+gpu.name+' · 总显存 '+gpu.totalMb+' MB · 可用 '+gpu.freeMb+' MB');});
    lines.push('ComfyUI 版本：' + (s.version || '未知') + (s.reachable ? '' : '（' + (s.error || '无法连接') + '）'));
    if (v.queue) lines.push('队列：运行 ' + v.queue.running + ' · 等待 ' + v.queue.pending);
    var detection=v.capabilities&&v.capabilities.detection;
    if(v.version&&v.version==='1.52.1')lines.push('本地网关仍是旧进程 '+v.version+'；空闲时重启本地网关以加载已安装更新。');
    lines.push('使用模式：'+(v.localChat&&v.localChat.enabled?(v.localChat.apiComplement?'本地优先，已开启 API 补全':'本地独立运行，不自动调用 API'):'API；本地页试聊仍仅测试本机'));
    if(detection){lines.push('能力检测：'+({pending:'待检测',ready:'已检测',unavailable:'服务未就绪'}[detection.status]||detection.status)+(detection.busy?' · 本机有任务，稍后再检测':''));var names={text:'文字',json:'结构化分析',tools:'工具协议',vision:'看图',image:'生图工作流',video:'视频工作流',speech:'语音服务',native:'原生终端任务',special:'特殊流程'};Object.keys(detection.features||{}).forEach(function(key){var item=detection.features[key];lines.push((names[key]||key)+'：'+(item.supported===true?'可用':item.supported===false?'未接入 / 未通过':'待检测')+' · '+item.reason);});lines.push('容量：上下文 '+detection.contextWindow+' token · 输出上限 '+detection.maxOutputTokens+' token');}
    status.textContent = lines.join('\n');
    if (flows) flows.textContent = '已登记媒体工作流：' + ((localLibrary() || []).map(function (item) { return item.name + '（' + item.kind + '）'; }).join('、') || '无');
    var model = $('localModelBadge');
    if (model) {
      var label = c.backend === 'openai' ? ('OpenAI 兼容 · ' + (c.modelId || '未命名')) : ((localWorkflowDraft||[]).find(function(x){return x.id===c.chatWorkflow;})?.name || c.chatWorkflow || '未配置');
      model.textContent = label + ' · 空闲 ' + Number(c.idleUnloadMinutes || 30) + ' 分释放';
    }
    var vb = $('localVoiceBadge'), vi = $('localVoiceInfo');
    if (vb && v.localVoice) {
      vb.textContent = v.localVoice.running ? '已连接' : (v.localVoice.state==='unknown'?'未验证（无状态接口）':'暂未连接');
      vb.className = 'tag' + (v.localVoice.running ? ' accent-tag' : '');
      vi.textContent = '协议：' + (v.localVoice.engine||'未配置') + '\n地址：' + (v.localVoice.baseUrl||'未配置') + '\n设备：' + (v.localVoice.device||'gpu') + (v.localVoice.dir?'\n启动目录：'+v.localVoice.dir:'') + (v.localVoice.state==='unknown'?'\n此服务没有只读状态接口，实际合成时检查连接。':'');
    }
    if (workflowsChanged) renderPane();
  }
  function localRefresh() {
    return fetch('/im-bridge/local', { cache: 'no-store' })
      .then(localJson)
      .then(localRender)
      .catch(function (e) { var s = $('localStatus'); if (s) s.textContent = '读取失败：' + e.message; throw e; })
      .then(function () { return localGateway; });
  }

  function localMapValue(item, key, part) {
    return esc((((item || {}).inputs || {})[key] || {})[part] || '');
  }
  function localWorkflowMarkup() {
    var defaults = localDefaultsDraft || {};
    var draft = localWorkflowDraft || [];
    var out = '<section class="card"><div class="section-heading"><h2>命名工作流库</h2><span class="tag">可增删</span></div>' +
      '<p class="muted">导入后自动识别输入和输出。图片、视频各手动指定一条当前工作流，聊天和生成时不会按画风切换；保留其他条目供你以后更换。聊天模型工作流也可以放在这里。</p>' + localImportMarkup() +
      '<div class="form-two"><label class="field">当前图片工作流<select id="localDefaultImage"><option value="">尚未选择</option>' + draft.filter(function (x) { return x.kind === 'image'; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (defaults.image === x.id ? ' selected' : '') + '>' + esc(x.name || x.id) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">当前视频工作流<select id="localDefaultVideo"><option value="">尚未选择</option>' + draft.filter(function (x) { return x.kind === 'video'; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (defaults.video === x.id ? ' selected' : '') + '>' + esc(x.name || x.id) + '</option>'; }).join('') + '</select></label></div><div id="localWorkflowRows">';
    if (!draft.length) out += '<p class="muted">还没有工作流。点击“新增工作流”后填写。</p>';
    draft.forEach(function (item, index) {
      out += '<div class="card" data-local-workflow="' + index + '" style="margin:12px 0;background:var(--bg)"><label class="field">名称<input data-wf="name" value="' + esc(item.name || '') + '" maxlength="100"></label>' +
        '<p class="muted">'+({image:'图片工作流',video:'视频工作流',chat:'聊天模型工作流'})[item.kind]+' · '+(item.autoDetection?'已自动识别节点':'可点“重新识别”自动填写')+'</p>';
      if (item.kind === 'image' || item.kind === 'video') out += '<label class="field">LoRA 触发词／固定追加词（可选，每行一条）<textarea data-wf="triggerWords" maxlength="4000" rows="2" placeholder="只填这个工作流确实需要的触发词">'+esc(item.triggerWords||'')+'</textarea></label><p class="muted">随这条工作流保存，生成时补进提示词；模型与 LoRA 文件仍由工作流自身加载。不会据此自动切换工作流，也不需要固定服装或日程。</p>';
      out += '<div class="btnrow"><button data-local-workflow-inspect="'+index+'">重新识别</button>'+(item.kind==='chat'?'<button data-local-use-chat="'+esc(item.id)+'">用于本地聊天</button>':'')+'</div>'+ 
        '<details><summary>高级：节点映射、文件和等待时间</summary><label class="field">内部 ID<input data-wf="id" value="'+esc(item.id||'')+'"></label>'+
        '<div class="form-two"><label class="field">类型<select data-wf="kind"><option value="image"' + (item.kind === 'image' ? ' selected' : '') + '>图片</option><option value="video"' + (item.kind === 'video' ? ' selected' : '') + '>视频</option><option value="chat"'+(item.kind==='chat'?' selected':'')+'>聊天模型</option></select></label><label class="field">已导入的文件<input data-wf="file" value="' + esc(item.file || '') + '" placeholder="assets/comfyui/...json"></label></div>' +
        '<label class="field">用途备注<textarea data-wf="description" maxlength="800" rows="2" placeholder="例如：日常角色自拍，需要一张人设参考图">' + esc(item.description || '') + '</textarea></label>' +
        '<p class="muted">填写 API JSON 中需要替换的节点编号和字段名。提示词必填；反向提示词、随机种子和输入图片可以留空，表示这个工作流不使用对应输入。</p>';
      [['prompt',item.kind==='chat'?'用户输入':'提示词'],['negativePrompt','反向提示词'],['seed','随机种子'],['image','输入图片']].concat(item.kind==='chat'?[['system','人设 / 系统'],['history','对话历史'],['requestId','请求编号'],['images','多模态图片列表'],['imageEnabled','本轮图片开关（布尔，可选）'],['temperature','温度'],['maxTokens','回复长度']]:[]).forEach(function (pair) {
        var key = pair[0];
        out += '<div class="form-two"><label class="field">' + pair[1] + '节点<input data-map="' + key + '.node" value="' + localMapValue(item, key, 'node') + '" placeholder="例如 6"></label><label class="field">' + pair[1] + '字段<input data-map="' + key + '.field" value="' + localMapValue(item, key, 'field') + '" placeholder="例如 text"></label></div>';
      });
      out += '<div class="form-two"><label class="field">输出节点<input data-wf="outputNode" value="'+esc(item.output?.node||'')+'"></label><label class="field">输出字段<input data-wf="outputField" value="'+esc(item.output?.field||'')+'"></label></div>';
      out += '<label class="field">等待上限（毫秒，5000–3600000）<input data-wf="timeoutMs" type="number" min="5000" max="3600000" step="1000" value="' + Number(item.timeoutMs || 600000) + '"></label></details>';
      out += '<div class="btnrow"><button class="danger" data-local-workflow-delete="' + index + '">删除并保存</button></div></div>';
    });
    out += '</div><div class="btnrow"><button class="primary" id="localWorkflowSave">保存工作流与当前选择</button></div><details><summary>高级：手动添加</summary><button id="localWorkflowAdd">手动填写工作流</button></details><div class="muted" id="localWorkflowHint" role="status"></div></section>';
    return out;
  }

  function captureLocalWorkflows() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('[data-local-workflow]'));
    return rows.map(function (row, index) {
      var value = function (name) { var el = row.querySelector('[data-wf="' + name + '"]'); return el ? el.value.trim() : ''; };
      var mapped = function (key) {
        var node = row.querySelector('[data-map="' + key + '.node"]');
        var field = row.querySelector('[data-map="' + key + '.field"]');
        return { node: node ? node.value.trim() : '', field: field ? field.value.trim() : '' };
      };
      var previous = localWorkflowDraft[index] || {};
      var kind = value('kind');
      var imageMetadata = {};
      if (kind === 'image') ['promptLanguage','promptModel','fixedPromptMode','note','discovery','extraNodes'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) imageMetadata[key] = previous[key];
      });
      return {
        ...imageMetadata,
        ...(kind === 'image' || kind === 'video' ? {triggerWords: value('triggerWords')} : {}),
        id: value('id'), name: value('name'), kind: kind, description: value('description'), file: value('file'),
        inputs: Object.fromEntries(['prompt','negativePrompt','seed','image','system','history','requestId','images','imageEnabled','temperature','maxTokens'].map(function(key){return [key,row.querySelector('[data-map="'+key+'.node"]')?mapped(key):(previous.inputs?.[key]||{node:'',field:''})];})),
        autoDetection: previous.autoDetection,
        parameterOverrides: previous.parameterOverrides || [],
        output:{kind:value('kind')==='chat'?'text':value('kind'),node:value('outputNode'),field:value('outputField')},
        timeoutMs: Number(value('timeoutMs') || previous.timeoutMs || 600000),
      };
    });
  }

  var localVoiceFields = {"timeoutMs":"Timeout", "type": "Protocol", "baseUrl": "Url", "model": "Model", "apiKey": "Key", "device": "Device", "ttsPath": "TtsPath", "statusPath": "StatusPath", "voicesPath": "VoicesPath", "unloadPath": "UnloadPath", "bodyTemplate": "Body", "responseMode": "Return", "responseField": "Field", "directory": "Directory", "startupExecutable": "StartupExecutable", "startupArguments": "StartupArguments", "startupDirectory": "StartupDirectory"};
  function captureLocalVoiceService() {
    var result=Object.assign({},localConfigDraft?.voiceService||localGateway?.config?.voiceService||data?.localChat?.voiceService||{});
    Object.keys(localVoiceFields).forEach(function(key){var field=$('localVoice'+localVoiceFields[key]);if(field)result[key]=field.value.trim();});
    if($('localVoiceTimeout'))result.timeoutMs=Number($('localVoiceTimeout').value)*1000;
    result.clearApiKey=!!$('localVoiceClearKey')?.checked;
    return result;
  }
  function localVoiceConfigMarkup(service) {
    var v=service||{},out='<div class="form-two"><label class="field">最长等待（秒）<input type="number" min="30" max="1800" step="1" id="localVoiceTimeout"></label><label class="field">语音协议<select id="localVoiceProtocol"><option value="voicelab">VoiceLab</option><option value="openai">OpenAI 兼容语音（本机服务）</option><option value="json">自定义 JSON 接口</option></select></label><label class="field">服务地址<input id="localVoiceUrl" placeholder="http://127.0.0.1:7870"></label><label class="field">语音模型<input id="localVoiceModel" placeholder="服务要求的模型 ID，不限模型名称"></label><label class="field">运行设备<select id="localVoiceDevice"><option value="gpu">GPU：8GB 模式需确认释放显存</option><option value="cpu">CPU：语音服务不占用显存</option></select></label></div><p class="muted">连接本机或局域网语音服务，无需固定软件或安装位置。OpenAI 兼容服务填含 /v1 的地址；音色可直接填写 ID，未提供列表接口时无需读取。服务需返回 WAV 音频。</p><details><summary>接口、请求模板与启动设置</summary><p class="muted">接口路径留空使用协议默认值。自定义 JSON 模板支持 {{text}}、{{voice}}、{{model}}、{{instruction}}；参数保持原有 JSON 类型。返回可以是 WAV 文件、JSON 中的 base64 或同站点音频 URL；字段可写 audio.url。不会执行返回内容里的命令，也不会转用云端。</p>';
    [['TtsPath','合成接口','例如 /tts'],['StatusPath','只读状态接口','例如 /health；无接口则生成时验证'],['VoicesPath','音色列表接口','例如 /voices；没有则直接填音色 ID'],['UnloadPath','释放 GPU 模型接口（POST）','非 VoiceLab 服务请按软件提供的接口填写'],['Field','音频返回字段','例如 data.audio'],['Directory','VoiceLab 安装目录（仅用于自动启动）','任选安装位置，已运行的服务无需填写'],['StartupExecutable','其他语音服务启动程序（可选）','例如 D:/MyTTS/python/python.exe'],['StartupArguments','启动参数','例如 "D:/MyTTS/server.py" --port 8001'],['StartupDirectory','启动工作目录','例如 D:/MyTTS']].forEach(function(row){out+='<label class="field">'+row[1]+'<input id="localVoice'+row[0]+'" placeholder="'+esc(row[2])+'"></label>';});
    out+='<label class="field">本地服务密钥（可选，留空保留）<input id="localVoiceKey" type="password" autocomplete="new-password" placeholder="'+(v.hasApiKey?'已保存密钥':'本地通常不需要')+'"></label><label class="check-field"><input id="localVoiceClearKey" type="checkbox">清除已保存的本地服务密钥</label><label class="field">自定义 JSON 请求模板<textarea id="localVoiceBody" rows="5"></textarea></label><label class="field">自定义接口返回类型<select id="localVoiceReturn"><option value="audio">直接返回 WAV 音频</option><option value="base64">JSON 音频 base64 字段</option><option value="url">JSON 同站点音频 URL 字段</option></select></label><p class="muted">自动启动只在你运行本地启动脚本时执行；留空则由你启动服务。自定义服务自动启动需提供只读状态接口。更换接口不会自动重启或停止现有任务。GPU 服务没有释放接口时，8GB 模式会暂停叠加加载并说明原因。</p></details>';
    // Fill defaults through escaped markup, so draft survives tab changes.
    var template=document.createElement('template');template.innerHTML=out;
    Object.keys(localVoiceFields).forEach(function(key){var field=template.content.querySelector('#localVoice'+localVoiceFields[key]);if(!field)return;var value=key==='apiKey'?(v.apiKey||''):(v[key]??({type:'voicelab',device:'gpu',responseMode:'audio',baseUrl:'http://127.0.0.1:7870',bodyTemplate:'{"text":"{{text}}","voice":"{{voice}}"}'}[key]||''));if(key==='timeoutMs')value=Math.round((Number(v.timeoutMs)||600000)/1000);if(field.tagName==='SELECT'){Array.from(field.options).forEach(function(o){o.toggleAttribute('selected',o.value===value);});}else if(field.tagName==='TEXTAREA')field.textContent=value;else field.setAttribute('value',value);});
    return template.innerHTML;
  }
  var localParameterViews={},localParameterSelected='',localParameterSerial=0,localParameterOpen=false;
  function localParameterLabel(field){return ({top_p:'累计概率 top_p',top_k:'候选数量 top_k',min_p:'最小概率 min_p',steps:'采样步数 steps',cfg:'提示词引导 cfg',denoise:'降噪幅度 denoise',width:'宽度 width',height:'高度 height',seed:'随机种子 seed',n_ctx:'上下文长度 n_ctx',n_gpu_layers:'GPU 层数 n_gpu_layers',temperature:'温度 temperature',max_tokens:'回复上限 max_tokens'})[field]||field;}
  function renderLocalParameters(){
    var target=$('localParameterFields'),hint=$('localParameterHint'),save=$('localParameterSave');if(!target)return;
    var view=localParameterViews[localParameterSelected];if(!view){target.innerHTML='';if(save)save.disabled=true;return;}
    target.innerHTML=view.parameters.map(function(p,i){
      var label=esc(localParameterLabel(p.field)),detail=esc(p.nodeLabel+' · 节点 '+p.node);
      if(p.managedBy)return '<div class="muted">'+label+'：由上方'+(p.managedBy==='temperature'?'回答随机度':'单次回复上限')+'控制</div>';
      var control=p.type==='enum'?'<select data-param-value="'+i+'">'+p.options.map(function(v){return '<option value="'+esc(v)+'"'+(v===p.value?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select>':p.type==='boolean'?'<select data-param-value="'+i+'"><option value="true"'+(p.value===true?' selected':'')+'>开启</option><option value="false"'+(p.value===false?' selected':'')+'>关闭</option></select>':'<input data-param-value="'+i+'" type="number"'+(p.min!==undefined?' min="'+p.min+'"':'')+(p.max!==undefined?' max="'+p.max+'"':'')+' step="'+(p.step||(p.type==='integer'?1:'any'))+'" value="'+esc(p.value)+'">';
      return '<div class="card" style="padding:12px;min-width:0"><label class="check-field"><input type="checkbox" data-param-enable="'+i+'"'+(p.overridden?' checked':'')+'>调整 '+label+'</label><small class="muted" style="overflow-wrap:anywhere">'+detail+'</small><label class="field">'+control+'</label><small class="muted">工作流默认：'+esc(p.defaultValue)+(p.limited?'；当前实际：'+esc(p.effectiveValue)+'（统一配置或显存保护）':'')+'</small></div>';
    }).join('');
    target.querySelectorAll('[data-param-value]').forEach(function(field){var p=view.parameters[Number(field.dataset.paramValue)];field.disabled=!p.overridden;field.oninput=field.onchange=function(){p.value=p.type==='boolean'?field.value==='true':p.type==='enum'?field.value:Number(field.value);view.dirty=true;if(hint)hint.textContent='参数有修改，尚未保存。';};});
    target.querySelectorAll('[data-param-enable]').forEach(function(field){field.onchange=function(){var i=Number(field.dataset.paramEnable),p=view.parameters[i];p.overridden=field.checked;target.querySelector('[data-param-value="'+i+'"]').disabled=!field.checked;view.dirty=true;if(hint)hint.textContent='参数有修改，尚未保存。';};});
    if(save)save.disabled=!!view.saving;
  }
  async function readLocalParameters(){
    var select=$('localParameterPicker'),hint=$('localParameterHint');if(!select||!select.value)return;
    localParameterSelected=select.value;var existing=localParameterViews[localParameterSelected];if(existing?.saving){if(hint)hint.textContent='正在保存核对，请稍候。';return;}if(existing?.dirty){renderLocalParameters();if(hint)hint.textContent='保留了未保存参数；请先保存，或点“放弃修改并重新读取”。';return;}
    var id=localParameterSelected,serial=++localParameterSerial;if(hint)hint.textContent='正在读取节点参数，不运行模型…';
    try{var v=await localPost({action:'workflow-parameters',parameterAction:'describe',workflowId:id});if(serial!==localParameterSerial||id!==localParameterSelected)return;if(localParameterViews[id]?.dirty){if(hint)hint.textContent='保留了读取期间的新修改，请先保存或放弃修改。';return;}if(!v.parameters||!v.fingerprint)throw Error('当前运行版本尚不支持参数编辑，请重启 DSH 加载更新');localParameterViews[id]=v;renderLocalParameters();if(hint)hint.textContent=v.parameters.length?'已读取。勾选需要调整的项目，单独保存后下一次任务生效。':'这个工作流没有识别到可调节的生成参数。';}
    catch(e){if(serial===localParameterSerial&&hint)hint.textContent='参数暂时没有读到：'+e.message;}
  }
  function localParameterRows(view){return view.parameters.filter(function(p){return !p.managedBy&&p.overridden;}).map(function(p){return {node:p.node,field:p.field,value:p.value};});}
  async function saveLocalParameters(){
    var id=localParameterSelected,view=localParameterViews[id],button=$('localParameterSave'),hint=$('localParameterHint');if(!view||!button)return;
    var fields=Array.from($('localParameterFields').querySelectorAll('[data-param-value]'));if(fields.some(function(f){return !f.disabled&&!f.reportValidity();}))return;
    var rows=localParameterRows(view),expected=JSON.stringify(rows),written=false;view.saving=true;delete view.saveError;button.disabled=true;if(hint)hint.textContent='正在保存并回读核对…';
    try{try{await localPost({action:'workflow-parameters',parameterAction:'save',workflowId:id,fingerprint:view.fingerprint,parameters:rows});written=true;}catch(e){view.saveError=e;}
      var v=await localPost({action:'workflow-parameters',parameterAction:'describe',workflowId:id}),actual=v.config?.workflowLibrary?.find(function(w){return w.id===id;})?.parameterOverrides||[];
      if(JSON.stringify(actual)!==expected)throw view.saveError||Error('保存回读不一致，修改仍保留在编辑区');
      var pending=JSON.stringify(localParameterRows(view))!==expected;if(pending){v.parameters.forEach(function(p){var old=view.parameters.find(function(x){return x.node===p.node&&x.field===p.field;});if(old&&!p.managedBy){p.value=old.value;p.overridden=old.overridden;}});v.dirty=true;}
      localParameterViews[id]=v;localWorkflowDraft.forEach(function(w){if(w.id===id)w.parameterOverrides=actual;});if(localConfigDraft)localConfigDraft.workflowLibrary=localWorkflowDraft;
      if(localParameterSelected===id){renderLocalParameters();if(hint)hint.textContent=pending?'已保存提交时的参数；保存期间的新修改仍保留，尚未保存。':'参数已保存并回读核对；下一次任务生效。'+(v.parameters.some(function(p){return p.limited&&!p.managedBy;})?'部分数值受显存保护限制，实际值已列出。':'');}
    }catch(e){if(hint)hint.textContent=(written?'保存结果尚未核对：':'参数未确认保存：')+e.message;}finally{view.saving=false;button.disabled=false;}
  }

  function captureLocalForm() {
    if (!$('localBackend')) return localConfigDraft;
    var library = captureLocalWorkflows();
    localWorkflowDraft = library;
    localDefaultsDraft = {
      image: $('localDefaultImage') ? $('localDefaultImage').value : (localDefaultsDraft.image || ''),
      video: $('localDefaultVideo') ? $('localDefaultVideo').value : (localDefaultsDraft.video || ''),
    };
    localConfigDraft = {
      backend: $('localBackend').value,
      modelBaseUrl: $('localModelBaseUrl').value.trim(),
      modelId: $('localModelId').value.trim(),
      comfyUrl: $('localUrl').value.trim(),
      chatWorkflow: $('localChatWorkflow').value,
      temperature: Number($('localTemperature').value),
      maxTokens: Number($('localMaxTokens').value),
      historyChars: Number($('localHistoryChars').value),
      idleUnloadMinutes: Number($('localIdle').value),
      voiceEnabled: $('localVoiceEnabled').checked,
      voicePreset: $('localVoicePreset').value.trim(),
      voiceService:captureLocalVoiceService(),
      dialoguePriority:$('localDialoguePriority').value,fastDialogue:$('localFastDialogue').checked,streamDialogue:$('localStreamDialogue').checked,
      visionMode: $('localVisionMode').value,
      memoryProfile: $('localMemoryProfile').value,
      keepWarm: $('localWarm').checked,
      workflowLibrary: library,
      defaultWorkflows: Object.assign({}, localDefaultsDraft),
      baseUrl: $('localGatewayUrl').value.trim(),

    };
    return localConfigDraft;
  }

  function refreshLocalDefaultOptions() {
    var draft = captureLocalWorkflows();
    localWorkflowDraft = draft;
    [['localDefaultImage', 'image'], ['localDefaultVideo', 'video']].forEach(function (pair) {
      var select = $(pair[0]);
      if (!select) return;
      var selected = localDefaultsDraft[pair[1]] || '';
      select.innerHTML = '<option value="">尚未选择</option>' + draft.filter(function (item) { return item.kind === pair[1] && item.id; }).map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
      }).join('');
      if (selected && Array.prototype.some.call(select.options, function (option) { return option.value === selected; })) select.value = selected;
      else { select.value = ''; localDefaultsDraft[pair[1]] = ''; }
    });
  }

  var websiteMcpPreview=null,websiteMcpTools=[],websiteMcpAccount=null;
  function viewWebsiteMcp(){
    return '<div class="card"><h2>自动识别网站功能</h2><p class="muted">填写网站首页或公开 OpenAPI JSON 地址。识别不会消耗语言模型额度，也不会启动生图或语音服务。当前支持页面读取、GET 搜索表单和公开 GET 接口；登录、验证码、发布与删除需要专用适配。</p><label class="field">网站地址<input id="websiteMcpUrl" type="url" placeholder="https://example.com"></label><div class="btnrow"><button id="websiteMcpInspect" class="primary">识别网站</button><button id="websiteMcpRefresh">刷新已保存网站</button><button id="websiteMcpExport">导出 MCP 配置</button></div><p id="websiteMcpStatus" role="status" class="muted"></p><div id="websiteMcpPreview"></div></div><div class="card"><h2>已保存网站</h2><p class="muted">启用后，本地与 API 的号主工具会话可通过 bridge_website_mcp 自动发现并调用；仍遵循现有工具权限。重新识别并保存可更新网站结构。</p><div id="websiteMcpSites">正在读取…</div><label class="field">选择工具试用<select id="websiteMcpTool"></select></label><div id="websiteMcpFields"></div><label class="field"><span><input id="websiteMcpSession" type="checkbox"> 使用桥接浏览器的登录状态</span><small>网站绑定后会默认复用会话。取消勾选可单次试用公开读取。</small></label><button id="websiteMcpCall">执行所选工具</button><pre id="websiteMcpResult" style="white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto" aria-live="polite"></pre></div><div class="card"><h2>MCP 配置与外部调用记录</h2><p class="muted">复制配置到支持 MCP 的客户端；网站清单与启停开关共用，外部 MCP 读取公开内容。插件聊天中的调用也会进入“提示词与调用记录”。</p><pre id="websiteMcpConfig" style="white-space:pre-wrap;word-break:break-word"></pre><pre id="websiteMcpExternal" style="white-space:pre-wrap;max-height:300px;overflow:auto"></pre></div>';
  }
  function websiteMcpFields(schema,container){
    var required=schema.required||[],properties=schema.properties||{};
    container.innerHTML=Object.keys(properties).map(function(key){var p=properties[key],label=esc(key+(required.indexOf(key)>=0?'（必填）':'（可选）')),attr=' data-website-param="'+esc(key)+'" data-website-type="'+esc(p.type)+'"';var field;
      if(p.enum)field='<select'+attr+'><option value="">请选择</option>'+p.enum.map(function(v){return '<option value="'+esc(String(v))+'">'+esc(String(v))+'</option>';}).join('')+'</select>';
      else if(p.type==='boolean')field='<select'+attr+'><option value="">不填写</option><option value="true">是</option><option value="false">否</option></select>';
      else field='<input'+attr+' type="'+(['number','integer'].indexOf(p.type)>=0?'number':'text')+'" maxlength="500" placeholder="'+esc(p.description||key)+'">';
      return '<label class="field">'+label+field+'</label>';
    }).join('')||'<p class="muted">此工具不需要参数。</p>';
  }
  function websiteMcpArguments(container){
    var out=Object.create(null);container.querySelectorAll('[data-website-param]').forEach(function(el){if(el.value==='')return;var type=el.getAttribute('data-website-type');out[el.getAttribute('data-website-param')]=type==='boolean'?el.value==='true':['number','integer'].indexOf(type)>=0?Number(el.value):el.value;});return out;
  }
  function paintWebsiteMcpPreview(){
    var container=$('websiteMcpPreview');if(!container)return;if(!websiteMcpPreview){container.innerHTML='';return;}
    var site=websiteMcpPreview.site;
    container.innerHTML='<h3>'+esc(site.title)+' · 识别到 '+site.tools.length+' 个工具</h3><p>'+esc(site.origin)+'</p><p class="muted">'+site.limitations.map(esc).join('<br>')+'</p><details><summary>查看识别依据与接口参数</summary><pre style="white-space:pre-wrap;word-break:break-word">'+esc(JSON.stringify(site.tools,null,2))+'</pre></details><label class="field">测试已识别功能<select id="websiteMcpPreviewTool">'+site.tools.map(function(t){return '<option value="'+esc(t.name)+'">'+esc(t.name+' · '+t.description)+'</option>';}).join('')+'</select></label><div id="websiteMcpPreviewFields"></div><div class="btnrow"><button id="websiteMcpPreviewTest">测试此功能</button><button id="websiteMcpSave" class="primary">保存并启用网站</button></div><pre id="websiteMcpPreviewResult" style="white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto"></pre>';
    function selected(){return site.tools.find(function(t){return t.name===$('websiteMcpPreviewTool').value;});}
    $('websiteMcpPreviewTool').onchange=function(){websiteMcpFields(selected().inputSchema,$('websiteMcpPreviewFields'));};$('websiteMcpPreviewTool').onchange();
    $('websiteMcpPreviewTest').onclick=async function(){var button=this;button.disabled=true;$('websiteMcpPreviewResult').textContent='正在实际读取网站…';try{var r=await api('POST','/im-bridge/website-mcp',{action:'test',previewId:websiteMcpPreview.previewId,name:selected().name,arguments:websiteMcpArguments($('websiteMcpPreviewFields'))});if($('websiteMcpPreviewResult'))$('websiteMcpPreviewResult').textContent=JSON.stringify(r,null,2);}catch(e){if($('websiteMcpPreviewResult'))$('websiteMcpPreviewResult').textContent=e.message;}finally{button.disabled=false;}};
    $('websiteMcpSave').onclick=async function(){this.disabled=true;try{await api('POST','/im-bridge/website-mcp',{action:'save',previewId:websiteMcpPreview.previewId});websiteMcpPreview=null;paintWebsiteMcpPreview();await refreshWebsiteMcp();toast('网站已启用，本地与 API 共用');}catch(e){toast(e.message);this.disabled=false;}};
  }
  async function refreshWebsiteMcp(){
    try{var r=await api('GET','/im-bridge/website-mcp');if(!$('websiteMcpSites'))return;if(websiteMcpAccount!==null&&websiteMcpAccount!==r.accountId){websiteMcpPreview=null;paintWebsiteMcpPreview();}websiteMcpAccount=r.accountId;websiteMcpTools=r.tools||[];
      $('websiteMcpSites').innerHTML=(r.sites||[]).map(function(s){return '<div class="card"><b>'+esc(s.title)+'</b><p>'+esc(s.url)+' · '+s.tools.length+' 个工具 · '+(s.enabled?'已启用':'已停用')+(s.loginBound?' · 已绑定会话':'')+'</p><div class="btnrow"><button data-website-toggle="'+esc(s.id)+'" data-enabled="'+String(!s.enabled)+'">'+(s.enabled?'停用':'启用')+'</button><button data-website-remove="'+esc(s.id)+'">移除</button>'+(s.enabled?'<button data-website-login="'+esc(s.id)+'">打开登录窗口</button><button data-website-bind="'+esc(s.id)+'">绑定登录会话</button>':'')+'</div><details><summary>适配范围与限制</summary><p>'+s.limitations.map(esc).join('<br>')+'</p></details></div>';}).join('')||'<p class="muted">尚未添加网站。先在上方填写网址并识别。</p>';
      $('websiteMcpTool').innerHTML=websiteMcpTools.map(function(t){return '<option value="'+esc(t.name)+'">'+esc(t.title||t.name)+'</option>';}).join('');
      $('websiteMcpTool').onchange=function(){var tool=websiteMcpTools.find(function(t){return t.name===$('websiteMcpTool').value;});websiteMcpFields(tool?tool.inputSchema:{},$('websiteMcpFields'));$('websiteMcpCall').disabled=!tool;var site=(r.sites||[]).find(function(s){return tool&&tool.name.startsWith(s.id+'__');});$('websiteMcpSession').checked=!!site?.loginBound;};$('websiteMcpTool').onchange();
      $('websiteMcpExternal').textContent=JSON.stringify(r.externalRecords||[],null,2);
      document.querySelectorAll('[data-website-toggle]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{await api('POST','/im-bridge/website-mcp',{action:'toggle',id:button.getAttribute('data-website-toggle'),enabled:button.getAttribute('data-enabled')==='true'});await refreshWebsiteMcp();}catch(e){toast(e.message);}finally{button.disabled=false;}};});
      document.querySelectorAll('[data-website-login],[data-website-bind]').forEach(function(button){button.onclick=async function(){
        button.disabled=true;var opening=button.hasAttribute('data-website-login');
        try{
          var response=await api('POST','/im-bridge/website-mcp',{action:opening?'open-login':'bind-login',id:button.getAttribute(opening?'data-website-login':'data-website-bind')});
          if(!opening)await refreshWebsiteMcp();
          toast(opening?'在桥接窗口登录后，回这里点“绑定登录会话”':response.loginVerified?'网站已确认登录，会话已绑定':'已保存会话，请试用需要登录的页面确认');
        }catch(e){toast(e.message);}finally{button.disabled=false;}
      };});
      document.querySelectorAll('[data-website-remove]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{await api('POST','/im-bridge/website-mcp',{action:'remove',id:button.getAttribute('data-website-remove')});await refreshWebsiteMcp();}catch(e){toast(e.message);}finally{button.disabled=false;}};});
    }catch(e){if($('websiteMcpStatus'))$('websiteMcpStatus').textContent='暂时无法读取网站工具：'+e.message+'。新安装后需要重载插件。';}
  }
  function bindWebsiteMcp(){
    paintWebsiteMcpPreview();void refreshWebsiteMcp();
    $('websiteMcpRefresh').onclick=refreshWebsiteMcp;
    $('websiteMcpInspect').onclick=async function(){var button=this,url=$('websiteMcpUrl').value.trim();button.disabled=true;$('websiteMcpStatus').textContent='正在读取页面并识别真实功能…';try{var r=await api('POST','/im-bridge/website-mcp',{action:'inspect',url:url});websiteMcpPreview=r;if($('websiteMcpStatus')){$('websiteMcpStatus').textContent='识别完成。请检查功能范围，可先测试再保存。';paintWebsiteMcpPreview();}}catch(e){if($('websiteMcpStatus'))$('websiteMcpStatus').textContent='识别未完成：'+e.message;}finally{button.disabled=false;}};
    $('websiteMcpCall').onclick=async function(){var button=this;button.disabled=true;$('websiteMcpResult').textContent='正在调用网站…';try{var result=await api('POST','/im-bridge/website-mcp',{action:'call',name:$('websiteMcpTool').value,arguments:websiteMcpArguments($('websiteMcpFields')),useBrowserSession:$('websiteMcpSession').checked});if($('websiteMcpResult'))$('websiteMcpResult').textContent=JSON.stringify(result,null,2);}catch(e){if($('websiteMcpResult'))$('websiteMcpResult').textContent=e.message;}finally{button.disabled=false;}};
    $('websiteMcpExport').onclick=async function(){try{var r=await api('POST','/im-bridge/website-mcp',{action:'export'});if($('websiteMcpConfig'))$('websiteMcpConfig').textContent=JSON.stringify(r.config,null,2);}catch(e){toast(e.message);}};
  }

  var connectionState=null,connectionDraft=null,connectionDetection=null;
  function viewServiceConnections(){
    var markup='<div class="card"><h2>当前实际配置来源</h2><p class="muted">按已生效的设置读取，编辑框里尚未应用的选择不会改变这里。单独会话的覆盖和实际执行模型见调用记录。</p><div id="connectionEffectiveSources">正在读取…</div></div>'+serviceModeMarkup()+'<div class="card"><h2>添加 API 或本地连接</h2><p class="muted">先填地址和密钥，点击检测。检测只读取状态、协议线索和模型列表，不启动推理或生成，不消耗生成额度。一个连接可以分别填写聊天、图片、视频和语音模型，模型名称不固定。聊天默认沿用 DeepSeek，也可以保存其他服务后点击“用于聊天”；图片、语音同样可独立选择其他 API。</p><div class="form-two"><label class="field">名称<input id="connectionName" placeholder="例如：我的 API、本机模型"></label><label class="field">服务地址<input id="connectionUrl" placeholder="https://example.com/v1 或 http://127.0.0.1:8188"></label></div><label class="field">API 密钥<input id="connectionKey" type="password" autocomplete="new-password" placeholder="本地通常无需填写；编辑时留空保留原密钥"></label><div class="btnrow"><button id="connectionDetect" class="primary">自动检测连接</button><button id="connectionNew">清空，新建连接</button></div><p id="connectionEvidence" class="muted" role="status"></p><label class="field">请求类型<select id="connectionType"><option value="auto">自动识别</option><option value="openai">通用 OpenAI 兼容协议（不限服务商）</option><option value="anthropic">Claude 原生 Messages：聊天</option><option value="responses">Responses：聊天</option><option value="comfyui">ComfyUI：需要导入工作流</option><option value="voicelab">VoiceLab：本地语音</option><option value="runninghub">RunningHub：沿用原工作流配置</option></select></label><datalist id="connectionModels"></datalist><div class="form-two"><label class="field">聊天模型<input id="connectionChat" list="connectionModels" placeholder="检测后可选，也可手动输入模型 ID"></label><label class="field">图片模型<input id="connectionImage" list="connectionModels" placeholder="按接口实际支持的图片模型填写"></label><label class="field">视频模型<input id="connectionVideo" list="connectionModels" placeholder="按服务支持的模型填写，不固定模型名"></label><label class="field">语音模型<input id="connectionSpeech" list="connectionModels" placeholder="按接口实际支持的语音模型填写"></label><label class="field">音色 ID<input id="connectionVoice" placeholder="由语音服务提供，不能仅凭模型列表确定"></label></div><label class="field">图片接口<select id="connectionImageMode"><option value="generations">文生图：POST /images/generations</option><option value="edits">参考图编辑：POST /images/edits</option></select></label><details><summary>自定义接口路径与语音格式（可选）</summary><p class="muted">留空使用所选协议的标准路径。可以填写同站点的完整接口地址或路径；更改路径不会改变请求和回执的数据格式。密钥只填在密钥栏。</p><label class="field">聊天接口<input id="connectionChatPath" placeholder="例如 /v1/chat/completions"></label><label class="field">图片接口<input id="connectionImagePath" placeholder="例如 /v1/images/edits"></label><label class="field">语音接口<input id="connectionSpeechPath" placeholder="例如 /v1/audio/speech"></label><label class="field">语音返回格式<select id="connectionAudioFormat"><option value="wav">WAV</option><option value="mp3">MP3</option></select></label></details><details><summary>余额查询（可选，按服务商文档填写）</summary><p class="muted">余额接口与生成协议相互独立，不会猜测接口地址。仅查询此连接同站点，复用此连接密钥。请使用只读取账户余额的接口，不能填写生成、充值或其他操作接口。没有接口时留空，显示暂不可查询。DeepSeek 官方连接可自动识别余额接口。</p><label class="field">余额接口路径<input id="connectionBalanceEndpoint" placeholder="例如 /account/balance"></label><label class="field">查询方式<select id="connectionBalanceMethod"><option value="GET">GET</option><option value="POST">POST</option></select></label><div class="form-two"><label class="field">金额或剩余额度字段<input id="connectionBalanceAmount" placeholder="例如 data.balance"></label><label class="field">币种/单位字段<input id="connectionBalanceCurrencyPath" placeholder="例如 data.currency"></label><label class="field">固定单位（接口不返回时，按文档填写）<input id="connectionBalanceCurrency" placeholder="例如 CNY、USD、积分"></label><label class="field">余额类型<select id="connectionBalanceKind"><option value="money">金额</option><option value="points">积分</option><option value="quota">配额</option></select></label><label class="field">余额列表字段（多钱包时）<input id="connectionBalanceRows" placeholder="例如 data.wallets；没有则留空"></label><label class="field">单位换算除数（默认1，不猜测）<input id="connectionBalanceDivisor" type="number" min="0.000000001" step="any" value="1"></label></div><label class="field">POST查询正文（可选JSON，密钥仍只填在密钥栏）<textarea id="connectionBalanceBody" placeholder="{}"></textarea></label></details><p class="muted">检测到模型列表不代表每个模型都能生图、说话或看图。无法识别时可手动选类型。保持人设图需要支持参考图的编辑接口；不会把人设图丢掉后悄悄改成文生图。ComfyUI 与 RunningHub 仍需要工作流，VoiceLab 使用本地页已配置的服务。</p><div class="btnrow"><button id="connectionSave" class="primary">保存连接</button><button data-go="local">本地服务与工作流</button></div><div id="connectionProfiles"></div></div><div class="card"><h2>分别选择聊天、图片、语音、视频的来源</h2><p class="muted">例如：现有 API 聊天 + 本地 ComfyUI 生图 + API 语音。也可以本地聊天 + API 生图 + 本地语音。开启后按这里指定的来源执行，失败不会偷偷切换；关闭后沿用当前聊天模式统一来源：本地聊天转纯本地，API 聊天转 API。更改搭配会取消旧会话中的未完成桥接任务，保留聊天记录。</p><label class="check-field"><input id="connectionRoutingEnabled" type="checkbox">启用按能力搭配</label><div class="form-two"><label class="field">聊天来源<select id="connectionRouteChat"></select></label><label class="field">图片来源<select id="connectionRouteImage"></select></label><label class="field">语音来源<select id="connectionRouteSpeech"></select></label><label class="field">视频来源<select id="connectionRouteVideo"></select></label></div><div class="btnrow"><button id="connectionRoutesSave" class="primary">应用搭配</button><button id="connectionRefresh">刷新连接</button></div><p id="connectionRouteStatus" class="muted" role="status"></p><p class="muted">“现有 API 聊天”沿用模型页选择；“原图片设置”沿用 RunningHub 等原来源；“原语音设置”沿用语音页引擎。本地选项使用本地页的 ComfyUI 工作流和语音服务。视频也按所选来源执行；“视频页设置”沿用视频生成页，选择本地时使用已导入的视频工作流。</p></div>';
    if(mobileApiOnly())markup=markup.replace(/<option value="(?:comfyui|voicelab)">[^<]*<\/option>/g,'').replace(/<button data-go="local">[^<]*<\/button>/g,'').replaceAll('添加 API 或本地连接','添加 API 连接').replaceAll('例如：我的 API、本机模型','例如：我的聊天 API').replaceAll('https://example.com/v1 或 http://127.0.0.1:8188','https://example.com/v1').replaceAll('本地通常无需填写；编辑时留空保留原密钥','编辑时留空保留原密钥').replaceAll('ComfyUI 与 RunningHub 仍需要工作流，VoiceLab 使用本地页已配置的服务。','RunningHub 仍沿用工作流配置。').replaceAll('例如：现有 API 聊天 + 本地 ComfyUI 生图 + API 语音。也可以本地聊天 + API 生图 + 本地语音。','聊天、图片和语音可分别选择不同 API 提供商。').replaceAll('本地选项使用本地页的 ComfyUI 工作流和语音服务。','手机版仅支持 API 来源。');
    return markup;
  }
  function serviceModeMarkup(){
    if(mobileApiOnly())return '<div class="card"><h2>API 模式</h2><p id="connectionModeStatus" role="status">正在读取当前来源…</p><div hidden><select id="connectionWholeMode" disabled><option value="api">API 模式</option></select><input id="connectionComplement" type="checkbox" disabled><button id="connectionModeSave" disabled>应用</button></div><p id="connectionModeNotice" class="muted">聊天、图片和语音可分别连接不同 API。手机版不启动本地模型或生成服务。</p><div class="btnrow"><button data-go="model">API 模型设置</button><button data-go="voice">语音参数</button><button data-go="invocations">调用记录</button></div></div>';
    return '<div class="card"><h2>运行方式与实际来源</h2><p id="connectionModeStatus" role="status">正在读取当前来源…</p><label class="field">整体模式<select id="connectionWholeMode" disabled><option value="api">API 模式</option><option value="local">纯本地（API 补全关闭时）</option></select></label><label class="check-field"><input type="checkbox" id="connectionComplement" disabled>本地能力不足时允许 API 补全</label><label class="check-field"><input type="checkbox" id="connectionTaskAssist" disabled>任务协作：API 做搜索、读网页和观察视频，本地负责理解与回复</label><p class="muted">任务协作默认关闭，需同时开启 API 补全。只发送本次任务和读取结果，不会自动附带整段私聊；API 不直接发 QQ。使用模型页选择的 API（不使用 DeepSeek），协作调用会产生相应 API 费用，并记录输入、步骤和结果。关闭后恢复原补全方式；两项都关闭为纯本地。</p><p class="muted">补全默认关闭。若要固定使用 API 聊天、本地图片等组合，请启用下方“按能力搭配”；搭配启用时由各项来源决定，不使用整体模式和自动补全。</p><button id="connectionModeSave" class="primary" disabled>应用整体模式</button><p id="connectionModeNotice" class="muted" role="status"></p><div class="btnrow"><button data-go="local">本地模型与工作流</button><button data-go="model">API 模型设置</button><button data-go="voice">语音参数</button><button data-go="invocations">调用记录</button></div></div>';
  }
  function describeServiceSources(state,local,voice){
    var routes=state.routes||{},mixed=routes.enabled===true;
    function label(kind){var value=routes[kind];if(value==='local')return '本地';if(value&&value.indexOf('profile:')===0){var p=(state.profiles||[]).find(function(p){return 'profile:'+p.id===value;});return p?p.name:'连接已失效';}return kind==='chat'?'模型页所选 API':kind==='image'?'图片页配置':kind==='video'?'视频页配置':'语音页配置（'+(voice.engine||'none')+'）';}
    if(mixed)return '按能力搭配 · 聊天：'+label('chat')+'；图片：'+label('image')+'；语音：'+label('speech')+'；视频：'+label('video')+'。失败不会自动换来源。';
    return local.enabled?'本地模式 · 聊天与图片、语音使用本地能力；API 补全'+(local.apiComplement?'已开启，仅在本轮能力不足时使用':'已关闭')+'。':'API 模式 · 聊天使用模型页选择，图片与语音使用各自页面配置。';
  }
  function connectionUseButtons(p){
    if(['comfyui','voicelab'].indexOf(p.type)>=0)return '<button data-go="local">配置本地服务与工作流</button>';
    if(p.type==='runninghub')return '<button data-go="imagegen">配置 RunningHub 工作流</button>';
    var buttons='';
    [['chat','聊天'],['image','图片'],['speech','语音'],['video','视频']].forEach(function(pair){var kind=pair[0],supported=kind==='chat'?connectionState?.adapterSupported!==false&&['openai','anthropic','responses'].indexOf(p.type)>=0&&p.chatModel:p.type==='openai'&&(kind==='image'?p.imageModel:kind==='video'?p.videoModel:p.speechModel&&p.voice);if(supported)buttons+='<button class="primary small" data-connection-use="'+esc(p.id)+'" data-kind="'+kind+'">用于'+pair[1]+'</button>';});
    return buttons;
  }
  function captureConnection(){
    if(!$('connectionUrl'))return connectionDraft||{};
    connectionDraft=Object.assign({},connectionDraft||{},{name:$('connectionName').value.trim(),baseUrl:$('connectionUrl').value.trim(),apiKey:$('connectionKey').value.trim(),type:$('connectionType').value,chatModel:$('connectionChat').value.trim(),imageModel:$('connectionImage').value.trim(),videoModel:$('connectionVideo').value.trim(),speechModel:$('connectionSpeech').value.trim(),voice:$('connectionVoice').value.trim(),imageMode:$('connectionImageMode').value,paths:Object.assign({},connectionDraft?.paths||{},{chat:$('connectionChatPath').value.trim(),image:$('connectionImagePath').value.trim(),speech:$('connectionSpeechPath').value.trim()}),audioFormat:$('connectionAudioFormat').value,balance:$('connectionBalanceEndpoint').value.trim()?{endpoint:$('connectionBalanceEndpoint').value.trim(),method:$('connectionBalanceMethod').value,amountPath:$('connectionBalanceAmount').value.trim(),currencyPath:$('connectionBalanceCurrencyPath').value.trim(),currency:$('connectionBalanceCurrency').value.trim(),kind:$('connectionBalanceKind').value,rowsPath:$('connectionBalanceRows').value.trim(),divisor:Number($('connectionBalanceDivisor').value||1),body:$('connectionBalanceBody').value.trim()}:null});return connectionDraft;
  }
  function paintConnectionDraft(){
    if(!$('connectionUrl'))return;var p=connectionDraft||{};
    [['connectionName','name'],['connectionUrl','baseUrl'],['connectionKey','apiKey'],['connectionChat','chatModel'],['connectionImage','imageModel'],['connectionVideo','videoModel'],['connectionSpeech','speechModel'],['connectionVoice','voice']].forEach(function(pair){$(pair[0]).value=p[pair[1]]||'';});$('connectionType').value=p.type||'auto';$('connectionImageMode').value=p.imageMode||'generations';[['connectionChatPath','chat'],['connectionImagePath','image'],['connectionSpeechPath','speech']].forEach(function(pair){$(pair[0]).value=p.paths?.[pair[1]]||'';});$('connectionAudioFormat').value=p.audioFormat||'wav';var balance=p.balance||{};[['connectionBalanceEndpoint','endpoint'],['connectionBalanceAmount','amountPath'],['connectionBalanceCurrencyPath','currencyPath'],['connectionBalanceCurrency','currency'],['connectionBalanceRows','rowsPath']].forEach(function(pair){$(pair[0]).value=balance[pair[1]]||'';});$('connectionBalanceKind').value=balance.kind||'money';$('connectionBalanceMethod').value=balance.method||'GET';$('connectionBalanceDivisor').value=balance.divisor||1;$('connectionBalanceBody').value=balance.body?JSON.stringify(balance.body):'';
    syncConnectionProtocolFields();
    $('connectionModels').innerHTML=(p.models||[]).map(function(m){return '<option value="'+esc(m)+'"></option>';}).join('');$('connectionEvidence').textContent=(p.evidence||[]).join('；')+(p.hasKey?'（已保存密钥，留空会保留）':'');
  }
  function syncConnectionProtocolFields(){
    var type=$('connectionType')?.value,apiMedia=type==='auto'||type==='openai';
    ['connectionImage','connectionVideo','connectionSpeech','connectionVoice','connectionImageMode','connectionImagePath','connectionSpeechPath','connectionAudioFormat'].forEach(function(id){var el=$(id);if(el){el.disabled=!apiMedia;el.closest('label')?.toggleAttribute('hidden',!apiMedia);}});
  }
  async function refreshConnections(){
    var originNode=$('connectionProfiles');
    try{var values=await Promise.all([api('GET','/im-bridge/service-connections'),api('GET','/im-bridge/settings')]),r=values[0],current=values[1];if(!originNode||$('connectionProfiles')!==originNode)return;rememberDraft('services');connectionState=r;if($('connectionEffectiveSources'))$('connectionEffectiveSources').innerHTML=renderServiceSources(r.effectiveSources);studioBalanceByProvider={};data.localChat=current.localChat;data.settings=current.settings;var lc=current.localChat||{},mixed=r.routes?.enabled===true;$('connectionWholeMode').value=lc.enabled?'local':'api';$('connectionComplement').checked=lc.apiComplement===true;if($('connectionTaskAssist')){$('connectionTaskAssist').checked=lc.apiTaskAssist===true;$('connectionTaskAssist').disabled=mobileApiOnly()||!lc.enabled||!lc.apiComplement;}$('connectionWholeMode').disabled=mobileApiOnly();$('connectionComplement').disabled=mobileApiOnly()||!lc.enabled;$('connectionModeSave').disabled=mobileApiOnly();$('connectionModeStatus').textContent=describeServiceSources(r,lc,current.settings?.voice||{});$('connectionModeNotice').textContent=mixed?'当前按能力搭配；应用整体模式会关闭搭配，并按整体模式统一来源。':'';
      $('connectionProfiles').innerHTML='<h3>已保存连接</h3>'+(r.profiles||[]).map(function(p){return '<div class="card"><b>'+esc(p.name)+'</b><p>'+esc(p.type)+' · '+esc(p.baseUrl)+' · '+(p.hasKey?'已保存密钥':'未设置密钥')+'</p><div class="btnrow">'+connectionUseButtons(p)+'<button data-connection-balance="'+esc(p.id)+'">查询余额</button><button data-connection-edit="'+esc(p.id)+'">编辑</button><button data-connection-remove="'+esc(p.id)+'">移除</button></div></div>';}).join('');
      var routes=r.routes||{};$('connectionRoutingEnabled').checked=routes.enabled===true;
      [['chat','connectionRouteChat'],['image','connectionRouteImage'],['speech','connectionRouteSpeech'],['video','connectionRouteVideo']].forEach(function(pair){var kind=pair[0],select=$(pair[1]),initial=kind==='chat'?[['host','现有 API 聊天'],['local','本地聊天模型']]:kind==='image'?[['legacy','原图片设置（API / RunningHub 等）'],['local','本地 ComfyUI 工作流']]:kind==='video'?[['legacy','视频页设置（RunningHub / 兼容 API）'],['local','本地视频工作流']]:[['legacy','原语音设置'],['local','本地语音服务'],['runninghub','RunningHub 语音工作流']];
        if(mobileApiOnly())initial=initial.filter(function(o){return o[0]!=='local';});var options=initial.concat((r.profiles||[]).filter(function(p){return kind==='chat'?r.adapterSupported!==false&&['openai','anthropic','responses'].indexOf(p.type)>=0&&p.chatModel:p.type==='openai'&&(kind==='image'?p.imageModel:kind==='video'?p.videoModel:p.speechModel&&p.voice);}).map(function(p){return ['profile:'+p.id,p.name+' · '+p[kind==='chat'?'chatModel':kind==='image'?'imageModel':kind==='video'?'videoModel':'speechModel']];}));select.innerHTML=options.map(function(x){return '<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>';}).join('');select.value=routes[kind]||initial[0][0];
      });$('connectionRouteStatus').textContent=r.adapterSupported===false?'当前宿主无法注册新聊天连接；原聊天模型仍可使用。':routes.enabled?'当前按上方四项分别执行。':'当前保持原有整体模式。';
      document.querySelectorAll('[data-connection-use]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{await api('POST','/im-bridge/service-connections',{action:'use',id:button.getAttribute('data-connection-use'),kind:button.getAttribute('data-kind')});await refreshConnections();toast('来源已切换；其他项目保持当前选择');}catch(e){toast('未切换：'+e.message);}finally{if(button.isConnected)button.disabled=false;}};});
      document.querySelectorAll('[data-connection-balance]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{var result=await api('POST','/im-bridge/service-connections',{action:'balance',id:button.getAttribute('data-connection-balance')});toast(result.balance.status==='ok'?result.balance.entries.map(function(e){return e.amount+' '+e.currency;}).join(' / '):result.balance.reason||'余额未知');}catch(e){toast('查询失败：'+e.message);}finally{if(button.isConnected)button.disabled=false;}};});
      document.querySelectorAll('[data-connection-edit]').forEach(function(button){button.onclick=function(){var p=r.profiles.find(function(x){return x.id===button.getAttribute('data-connection-edit');});connectionDraft=Object.assign({},p,{apiKey:''});paintConnectionDraft();};});
      document.querySelectorAll('[data-connection-remove]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{await api('POST','/im-bridge/service-connections',{action:'remove',id:button.getAttribute('data-connection-remove')});await refreshConnections();}catch(e){toast(e.message);}finally{button.disabled=false;}};});
      if(renderedTab==='services')startFormTracking();
      applyPreviewControls();
    }catch(e){if($('connectionModeNotice'))$('connectionModeNotice').textContent='当前来源未读取，请刷新后再操作。';if($('connectionRouteStatus'))$('connectionRouteStatus').textContent='连接配置暂未读取：'+e.message+'。安装更新后需要重载插件。';}
  }
  function bindServiceConnections(){
    paintConnectionDraft();void refreshConnections();$('connectionType').onchange=syncConnectionProtocolFields;
    $('connectionWholeMode').onchange=function(){$('connectionRoutingEnabled').checked=false;$('connectionRoutingEnabled').dispatchEvent(new Event('input',{bubbles:true}));var local=this.value==='local';$('connectionComplement').disabled=!local;if(!local)$('connectionComplement').checked=false;if($('connectionTaskAssist'))$('connectionTaskAssist').disabled=!local||!$('connectionComplement').checked;$('connectionModeNotice').textContent='模式尚未应用，点击“应用整体模式”后生效。';};
    if($('connectionTaskAssist'))$('connectionTaskAssist').onchange=function(){$('connectionModeNotice').textContent='任务协作设置尚未应用，请点击“应用整体模式”。';};
    $('connectionComplement').onchange=function(){if($('connectionTaskAssist'))$('connectionTaskAssist').disabled=!this.checked;$('connectionModeNotice').textContent='API 补充设置尚未应用，请点击“应用整体模式”。';};
    $('connectionModeSave').onclick=async function(){var button=this;button.disabled=true;try{await api('POST','/im-bridge/settings',{localChat:{apiTaskAssist:!!$('connectionTaskAssist')?.checked}});await api('POST','/im-bridge/service-connections',{action:'mode',mode:$('connectionWholeMode').value,apiComplement:$('connectionWholeMode').value==='local'&&$('connectionComplement').checked});await refreshConnections();toast('整体模式已应用');}catch(e){$('connectionModeNotice').textContent='未应用：'+e.message;}finally{if(button.isConnected)button.disabled=mobileApiOnly();}};

    ['connectionName','connectionUrl','connectionKey','connectionChat','connectionImage','connectionVideo','connectionSpeech','connectionVoice','connectionType','connectionImageMode','connectionChatPath','connectionImagePath','connectionSpeechPath','connectionAudioFormat','connectionBalanceEndpoint','connectionBalanceMethod','connectionBalanceAmount','connectionBalanceCurrencyPath','connectionBalanceCurrency','connectionBalanceKind','connectionBalanceRows','connectionBalanceDivisor','connectionBalanceBody'].forEach(function(id){$(id).oninput=captureConnection;});
    $('connectionRefresh').onclick=refreshConnections;
    $('connectionNew').onclick=function(){connectionDraft=null;connectionDetection=null;paintConnectionDraft();};
    $('connectionDetect').onclick=async function(){var button=this,draft=captureConnection();button.disabled=true;$('connectionEvidence').textContent='正在读取服务状态与模型列表，不会试生成…';try{var r=await api('POST','/im-bridge/service-connections',Object.assign({},draft,{action:'detect'}));connectionDetection=r.detection;connectionDraft=Object.assign({},draft,r.detection);if(r.detection.type==='unknown')connectionDraft.type='auto';if(!connectionDraft.name)try{connectionDraft.name=new URL(draft.baseUrl).hostname;}catch{}if(!connectionDraft.chatModel&&r.detection.capabilities?.chat==='listed')connectionDraft.chatModel=(r.detection.models||[]).find(function(id){return !/embedding|rerank|whisper|tts|flux|image/i.test(id);})||'';paintConnectionDraft();}catch(e){if($('connectionEvidence'))$('connectionEvidence').textContent=e.message;}finally{button.disabled=false;}};
    $('connectionSave').onclick=async function(){var button=this,draft=captureConnection();button.disabled=true;try{var r=await api('POST','/im-bridge/service-connections',Object.assign({},draft,{action:'save'}));connectionDraft=Object.assign({},r.profile,{apiKey:''});paintConnectionDraft();await refreshConnections();toast('连接已保存，按需在下方选择用途');}catch(e){toast(e.message);}finally{button.disabled=false;}};
    ['connectionRouteChat','connectionRouteImage','connectionRouteSpeech','connectionRouteVideo'].forEach(function(id){$(id).onchange=function(){$('connectionRoutingEnabled').checked=true;$('connectionRoutingEnabled').dispatchEvent(new Event('input',{bubbles:true}));$('connectionRouteStatus').textContent='已选择按能力搭配，保存后生效。';};});
    $('connectionRoutesSave').onclick=async function(){var button=this,enabled=$('connectionRoutingEnabled').checked;button.disabled=true;try{if(Object.hasOwn(pageDrafts.services||{},'connectionTaskAssist'))await api('POST','/im-bridge/settings',{localChat:{apiTaskAssist:!!$('connectionTaskAssist')?.checked}});var result=await api('POST','/im-bridge/service-connections',{action:'routes',routes:{enabled:enabled,chat:$('connectionRouteChat').value,image:$('connectionRouteImage').value,speech:$('connectionRouteSpeech').value,video:$('connectionRouteVideo').value}});if(result.routes?.enabled!==enabled)throw Error('返回的搭配状态与保存要求不一致');await refreshConnections();toast(enabled?'搭配已启用；后续请求按各自来源执行':'搭配已关闭；沿用当前聊天模式统一来源');}catch(e){if($('connectionRouteStatus'))$('connectionRouteStatus').textContent='未应用：'+e.message;}finally{button.disabled=false;}};
  }

  function viewLocal() {
    var c = (data && data.comfyui) || {};
    var lc = (data && data.localChat) || {};
    if (!localDraftEditing) {
      var gatewayConfig = localGateway && localGateway.config || {};
      localWorkflowDraft = Array.isArray(gatewayConfig.workflowLibrary) ? gatewayConfig.workflowLibrary : Array.isArray(lc.workflowLibrary) ? lc.workflowLibrary : (Array.isArray(c.workflowLibrary) ? c.workflowLibrary : []);
      localDefaultsDraft = gatewayConfig.defaultWorkflows || lc.defaultWorkflows || c.defaultWorkflows || {image:'',video:''};
    }
    var form = localDraftEditing && localConfigDraft ? localConfigDraft : Object.assign({}, lc, c, {baseUrl: lc.baseUrl || '', enabled: lc.enabled === true});
    var backend = form.backend || 'comfyui';
    var out = '';
    out += '<section class="card"><h2>提示词与调用记录</h2><p class="muted">生图、生视频的实际提交提示词和工具参数统一记录，API 补全会显示实际来源与原因。</p><button data-go="invocations">调用记录</button></section>';
    out += localRunMarkup();
    out += '<section class="card"><h2>本地主动聊天</h2><label class="check-field"><input id="localInitiativeEnabled" type="checkbox"'+(lc.initiativeEnabled!==false?' checked':'')+'>允许空闲时主动私聊号主</label><p class="muted">不设每天次数或固定间隔。日程休息时不主动打扰；空闲时由模型判断有没有想说的话，没有就安静。收到 QQ 消息立即让路。当前只主动发文字，不自动生图或合成语音。</p><button id="localInitiativeSave">保存主动聊天设置</button><p class="muted" id="localInitiativeStatus">等待状态更新…</p></section>';
    out += '<section class="card"><div class="section-heading"><h2>本地模型网关</h2><span class="tag" id="localBadge">检查中…</span></div>';
    out += '<p class="muted">让本地语言模型理解你的要求，选择工作流生成语音、图片或视频。这里试聊只生成本地文件，不发 QQ。</p>';
    out += '<p class="muted">运行模式与 API 补全统一在“连接与搭配”管理。保存本页只更新本地模型与工作流参数。</p><button data-go="services">管理运行来源</button>';
    out += '<div class="form-two"><label class="field">回复由谁生成<select id="localBackend"><option value="comfyui"' + (backend === 'comfyui' ? ' selected' : '') + '>本机 ComfyUI 聊天工作流</option><option value="openai"' + (backend === 'openai' ? ' selected' : '') + '>本机 OpenAI 兼容服务</option></select></label><label class="field">OpenAI 兼容服务地址<input id="localModelBaseUrl" value="' + esc(form.modelBaseUrl || 'http://127.0.0.1:8000/v1') + '" placeholder="http://127.0.0.1:8000/v1"></label></div>';
    out += '<div class="form-two"><label class="field">服务中的模型（可任选或手填）<input id="localModelId" list="localModelList" value="' + esc(form.modelId || '') + '" placeholder="填写服务实际提供的模型名"><datalist id="localModelList">'+localModels.map(function(x){return '<option value="'+esc(x.id)+'">';}).join('')+'</datalist></label><label class="field">ComfyUI 聊天工作流<select id="localChatWorkflow">'+localChatOptions(form.chatWorkflow || '')+'</select></label></div><div class="btnrow"><button id="localImportChat">导入自己的聊天工作流</button><input id="localChatWorkflowFile" type="file" accept=".json,application/json" hidden><button id="localApplyChat">切换纯本地并使用此工作流</button><button id="localDeleteChat" class="danger">删除选中的工作流</button><button id="localModelsRefresh">读取本机服务的模型列表</button></div><p class="muted" id="localModelsHint">可连接任意本机 OpenAI 兼容服务；导入任意 ComfyUI 聊天工作流并确认输入输出，模型和服务地址沿用工作流原设置。</p>';
    out += '<div class="form-two"><label class="field">回答随机度（0 稳定，数值越高越发散）<input id="localTemperature" type="number" min="0" max="3" step="0.1" value="' + Number(form.temperature == null ? 0.7 : form.temperature) + '"></label><label class="field">单次回复上限（token）<input id="localMaxTokens" type="number" min="32" max="32768" step="1" value="' + Number(form.maxTokens || 512) + '"></label></div>';
    out += '<details class="card" id="localParameterPanel"'+(localParameterOpen?' open':'')+'><summary>调节工作流生成参数</summary><p class="muted">从实际节点识别，不预设模型。温度、回复上限沿用上方统一设置；勾选其他参数才覆盖工作流默认。保留原工作流文件，下一次任务生效。</p><label class="field">选择工作流<select id="localParameterPicker">'+(localWorkflowDraft||[]).map(function(w){return '<option value="'+esc(w.id)+'"'+(w.id===(localParameterSelected||form.chatWorkflow)?' selected':'')+'>'+esc(w.name||w.id)+'</option>';}).join('')+'</select></label><div class="btnrow"><button id="localParameterRead">读取节点参数</button><button id="localParameterSave" class="primary" disabled>保存工作流参数</button><button id="localParameterReset">恢复工作流默认</button><button id="localParameterDiscard">放弃修改并重新读取</button></div><p class="muted" id="localParameterHint" role="status">展开后读取节点参数；读取不会运行模型。</p><div id="localParameterFields" class="form-two" style="max-height:480px;overflow:auto;min-width:0;align-items:start"></div></details>';
    out += '<div class="form-two"><label class="field">最多携带多少历史文字<input id="localHistoryChars" type="number" min="512" max="100000" step="128" value="' + Number(form.historyChars || 12000) + '"></label><label class="check-field"><input id="localVoiceEnabled" type="checkbox"' + (form.voiceEnabled !== false ? ' checked' : '') + '>允许本轮使用本地语音工具</label></div>';
    out += '<label class="check-field"><input id="localFastDialogue" type="checkbox"'+(form.fastDialogue!==false?' checked':'')+'>普通闲聊加速：按需减少工具说明，控制冗长回复</label><label class="check-field"><input id="localStreamDialogue" type="checkbox"'+(form.streamDialogue!==false?' checked':'')+'>逐句回传普通文字（ComfyUI 需加载流式适配）</label>';
    out += '<label class="field">对话策略<select id="localDialoguePriority"><option value="quality"'+(form.dialoguePriority!=='speed'?' selected':'')+'>质量优先（默认，保留连贯对话）</option><option value="speed"'+(form.dialoguePriority==='speed'?' selected':'')+'>速度优先</option></select></label><p class="muted">质量优先为近期连续对话预留容量，不再把闲聊历史提前压到 1800 字符；连续聊天会先在本机做一次简短语义理解，原话与权限依据保持原样；允许完整自然段、结合语境理解谐音和错字。尽量把日常回复控制在约 20 秒，加载模型、复杂任务和媒体生成不保证时限。8GB 容量保护仍启用，必要时整理较早资料。</p>';
    out += '<div class="form-two"><label class="field">看图方式<select id="localVisionMode">'+[['auto','自动（按模型和显存选择）'],['native','聊天模型直接看图'],['caption','独立视觉模型逐张观察'],['off','关闭看图']].map(function(x){return '<option value="'+x[0]+'"'+((form.visionMode||'auto')===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label><label class="field">显存方案<select id="localMemoryProfile"><option value="8gb"'+(form.memoryProfile!=='workflow'?' selected':'')+'>8GB 省显存（默认）</option><option value="workflow"'+(form.memoryProfile==='workflow'?' selected':'')+'>按工作流原参数</option></select></label></div><p class="muted">8GB 方案串行运行看图、聊天和语音，限制已识别 Qwen 节点的上下文与图片尺寸；大模型由 CPU 分担，速度取决于内存和 CPU。日常速度优先可选 4B。自动看图优先让小模型直接看，多图或大模型采用独立视觉观察。自定义生图、视频工作流及外部模型服务仍需使用适合显存的参数。</p>';
    out += '<div class="form-two"><label class="field">ComfyUI 地址<input id="localUrl" value="' + esc(form.comfyUrl || c.baseUrl || 'http://127.0.0.1:8188') + '" placeholder="http://127.0.0.1:8188"></label><label class="field">本地网关地址<input id="localGatewayUrl" value="' + esc(form.baseUrl || 'http://127.0.0.1:8777') + '" placeholder="http://127.0.0.1:8777"></label></div>';
    out += '<label class="check-field"><input id="localWarm" type="checkbox"' + (form.keepWarm !== false ? ' checked' : '') + '>连续使用时保持模型热态（更快，占显存）</label>';
    out += '<label class="field" style="max-width:240px">闲置多少分钟后释放显存<input id="localIdle" type="number" min="1" max="720" value="' + Number(form.idleUnloadMinutes || 10) + '"></label>';
    out += '<div class="btnrow"><button class="primary" id="localSave">保存配置</button><button id="localPing">刷新状态</button><button id="localProbe">检测当前模型能力</button><button id="localRelease">立即释放显存</button></div>';
    out += '<div id="localStatus" class="muted" style="margin-top:10px;white-space:pre-wrap">正在读取状态…</div>';
    out += '<div id="localWorkflows" class="muted" style="margin-top:6px"></div></section>';

    out += '<section class="card"><div class="section-heading"><h2>当前实际模型</h2><span class="tag" id="localModelBadge">读取中</span></div><p class="muted">标签取自网关真实配置，直接显示 ComfyUI 聊天工作流或 OpenAI modelId。</p></section>';
    out += '<section class="card"><h2>B站功能</h2><p class="muted">本地与 API 模型共用，账号和浏览设置已移到独立 B站页。</p><button data-go="bilibili">打开 B站账号与浏览</button></section>';
    out += localWorkflowMarkup();

    out += '<section class="card"><div class="section-heading"><h2>试聊</h2><span class="muted">只生成本地结果，不发 QQ</span></div>';
    out += '<label class="field">可选源图片<input id="localImage" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="muted">图片只随本次试聊上传到本地网关，不允许填写任意本机路径。</p>';
    out += '<label class="field">聊天<textarea id="localText" rows="2" placeholder="问它一句话；需要媒体可直接说明"></textarea></label>';
    out += '<div class="btnrow"><button id="localChat"'+(localTrialBusy?' disabled':'')+'>开始试聊</button></div>';
    out += '<pre id="localChatOut" class="muted" style="white-space:pre-wrap;margin:6px 0 0"></pre><pre id="localReceipts" class="muted" style="white-space:pre-wrap;margin:6px 0 0"></pre></section>';

    out += '<section class="card"><div class="section-heading"><h2>本地语音服务</h2><span class="tag" id="localVoiceBadge">检查中…</span></div>';
    out += localVoiceConfigMarkup(form.voiceService);
    out += '<label class="field">本地音色<input id="localVoicePreset" list="localVoicePresets" value="' + esc(form.voicePreset || '') + '" placeholder="留空：自动使用已有默认音色"><datalist id="localVoicePresets"></datalist></label><button id="localLoadVoices">读取音色列表</button><p id="localVoicePresetHint" class="muted">可选择音色名称或 ID；不会使用 API / Windows 的音色设置。修改后保存配置。</p>';
    out += '<div id="localVoiceInfo" class="muted" style="white-space:pre-wrap">正在读取…</div></section>';
    return out;
  }

  function viewConnection() {
    var st = data.status;
    var l = login || {};
    var out = '<div class="card"><h2>空间登录状态</h2><p>QQ 桥接：'+(st.connected?'已连接':'未连接')+' · 空间：'+esc(qzoneStateLabel(st.qzone))+'</p><p class="muted">'+esc(st.qzone?.reason||'QQ 登录后会自动检查空间')+'</p><button data-go="qzone">查看与检查空间登录</button></div>';
    out += '<div class="card"><h2>登录 QQ</h2><p class="muted">启动 NapCat 后，QQ 有有效的本地历史登录记录时会尝试复用；凭据失效或需要验证时，请使用手机 QQ 扫码确认。启动请求不代表登录成功。</p>';
    if (l.qqLoggedIn === true) {
      out += '<div class="row"><span>账号 ' + esc(st.selfId || l.qq) + ' 已登录</span><span class="tag accent-tag">' + (l.connected?'桥接已连接':l.requiresDeviceSwitch?'桥接待机':'等待桥接连接') + '</span></div>';
      if(l.requiresDeviceSwitch)out += '<p class="muted">本机 QQ 登录正常，桥接尚未在本机启用。点击“在本机启用桥接”即可连接，无需重复扫码。</p>';
      out += '<div class="btnrow"><button id="btnRestartNapCat">重启本机 QQ / NapCat</button></div><div class="muted" id="loginHint" role="status" style="margin-top:10px"></div>'; 
    } else {
      if (l.connected) out += '<p class="muted">' + (l.qqLoggedIn === false ? 'NapCat 桥接已连接，但 QQ 账号尚未登录，请扫码或等待登录结果。' : 'NapCat 桥接已连接，QQ 登录状态尚未确认；扫码入口会保留。') + '</p>';
      out += '<div class="btnrow"><button class="primary" id="btnStart">启动 NapCat / 扫码登录</button><button id="btnQrRefresh">换一个二维码</button><button id="btnRestartNapCat">重启 NapCat</button></div><div class="muted" id="loginHint" role="status" style="margin-top:10px"></div><div id="qrBox" style="margin-top:12px"></div><div class="muted" id="qrAge" style="margin-top:8px">正在读取二维码状态…</div><div class="muted" id="loginDiag" style="margin-top:4px">正在检查进程…</div>';
    }
    out += '</div>';
    out += '<div class="card"><div class="btnrow">' +
      '<button id="btnReconnect">重连 NapCat</button>' +
      '<button id="btnTest">发测试消息</button>' +
      '<button id="btnPause" class="' + (st.accountPaused ? 'primary' : 'danger') + '">' +
      (l.requiresDeviceSwitch ? '在本机启用桥接' : st.accountPaused ? '恢复连接' : '停用连接（保留配置）') + '</button>' +
      '<a class="button-link" href="/" target="_blank" rel="noopener">打开 DeepSeek Harness</a>' +
      '</div><div class="muted" style="margin-top:8px">停用只是断开这个账号的连接，配置、白名单、人设都保留；恢复后自动重连。</div>' +
      '<div class="row" style="margin-top:10px"><span>开机自动启动 NapCat<br><span class="muted">当前设备加载插件后启动本机QQ服务</span></span>' +
      '<button class="small ' + (st.autoStart ? 'primary' : '') + '" id="autoStartToggle">' + (st.autoStart ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="muted">' + (st.autoStart
        ? (st.autoStartInstalled ? '本机启动设置已保存；是否需要扫码由QQ登录状态决定' : '已开启，等待保存本机启动设置')
        : '开启后随当前设备的插件启动本机QQ服务，必要时仍需扫码') + '</div>' +
      '<div class="kv" style="margin-top:10px"><span>日志文件</span><code class="path">' + esc(st.logFile) + '</code></div></div>';

    out += '<div class="card"><h2>机器人账号</h2>' +
      '<div class="muted" style="margin-bottom:8px">每个账号对应一个 NapCat 的 WebSocket 地址；切换后立刻重连。同一时间只连一个。</div>';
    var accounts = data.settings.accounts || [];
    if (!accounts.length) out += '<div class="empty">还没有额外账号，当前用配置文件里的地址</div>';
    accounts.forEach(function (a) {
      var on = data.settings.activeAccountId === a.id;
      out += '<div class="row"><span>' + esc(a.name) + ' <span class="muted mono">' + esc(a.wsUrl) + '</span>' +
        (on ? ' <span class="tag">使用中</span>' : '') + '</span>' +
        '<span class="btnrow">' + (on ? '' : '<button class="small" data-accuse="' + esc(a.id) + '">切换</button>') +
        '<button class="danger small" data-accdel="' + esc(a.id) + '">删除</button></span></div>';
    });
    out += '<div style="display:grid;gap:8px;margin-top:10px">' +
      '<input id="accName" placeholder="名字，例如：小号">' +
      '<input id="accUrl" placeholder="ws://127.0.0.1:3101">' +
      '<input id="accToken" placeholder="token（可空）">' +
      '<button class="primary" id="accAdd">添加账号</button></div></div>';
    out += '<div class="card logout-card"><div class="section-heading"><h2>手动登出</h2><span class="tag">' + (st.manuallyLoggedOut ? '已登出' : (st.accountPaused ? '桥接已暂停' : '登录管理')) + '</span></div><p class="muted">停止本机当前机器人对应的 NapCat / QQ 进程，并暂停自动重连。本地登录凭据、插件设置和聊天记录会保留；之后可用「启动 NapCat / 扫码登录」重新上线。</p><div class="btnrow"><button class="danger" id="btnLogout"' + (st.manuallyLoggedOut ? ' disabled' : '') + '>' + (st.manuallyLoggedOut ? '已手动登出' : '手动登出') + '</button><span id="logoutHint" class="muted" role="status">' + (st.manuallyLoggedOut ? '等待你手动重新登录。' : '') + '</span></div></div>';
    return out;
  }

  function viewSessions() {
    var st = data.status;
    var out = '<div class="card"><div class="section-heading"><h2>会话管理</h2><span class="tag">' + st.chats.length + ' 个会话</span></div><p class="muted">为每个对话单独指定模型，也可以重置并在下一条消息开启新会话。</p>';
    if (!st.chats.length) out += '<div class="empty">还没有活跃会话</div>';
    st.chats.forEach(function (c) {
      out += '<div class="row"><span class="mono">' + esc(c.key) + '</span>' +
        '<span class="btnrow"><select class="chatModel" data-key="' + esc(c.key) + '" style="width:190px">' + chatModelOptions(c.key) + '</select>' +
        '<button class="danger small" data-reset="' + esc(c.key) + '">重置</button></span></div>';
    });
    out += '</div>';

    return out;
  }

  function viewLogs() {
    return '<div class="card"><div class="section-heading"><h2>运行日志</h2><button class="small" id="logRefresh">刷新日志</button></div><pre class="log" id="logBox">正在读取…</pre><div class="kv"><span>日志文件</span><code class="path">' + esc(data.status.logFile || '') + '</code></div></div>';
  }

  function viewUsageNote() {
    var warned = false;
    try { warned = window.localStorage.getItem('qqb-warn') === '1'; } catch (e) {}
    var out = warned ? '' : '<div class="card warncard"><div class="row"><span><b>⚠ 使用前必读</b>' +
      '<div class="muted" style="margin-top:6px;line-height:1.75">' +
      '这套插件通过 NapCat 接管真实 QQ 账号，属于<b>非官方自动化</b>，存在<b>被风控、限制甚至封号</b>的风险。' +
      '<br>风险随行为强度上升：频繁改资料、自动发说说、主动给多人发消息属于高危操作。' +
      '<br>建议：小号先试；打开「自主」时把每日额度调到很低；出现验证码或异常登录提示就立刻停用。' +
      '<br>账号被封、内容发错、被他人投诉等后果由使用者自行承担。' +
      '</div></span><button class="small ghost" id="warnHide">知道了</button></div></div>';

    return out ? '<details class="usage-note"><summary>使用说明与账号风险</summary>' + out + '</details>' : '';
  }

  function viewPersonaContent() {
    var s = data.settings;
    var hidden = s.hiddenPresets || [];
    var base = (data.status && data.status.basePersona) || '';
    var baseDefault = (data.status && data.status.basePersonaDefault) || '';
    var cardActive = (data.status && data.status.persona && data.status.persona.id) ? data.status.persona.id !== 'config' : !!(data.settings.activePersonaId && data.settings.activePersonaId !== 'self');
    var currentName = (data.status && data.status.personaName) || '';
    var out = '<div class="card persona-self"><h2>自我卡（空人设卡）</h2>' +
      '<div class="muted" style="margin-bottom:8px">这是她本人，不随人设卡改变。' + (cardActive ? '现在穿着「' + esc(currentName || '人设卡') + '」，卡片只叠加在这张卡外面。' : '现在没有穿人设卡，所有会话都按这张卡说话。') + '留空表示使用默认自我——她会好奇、会高兴或失落，也会有想让人陪、想分享、想弄明白的事；写进去的性格、价值观和说话底线在任何 cosplay 下都保留。</div>' +
      '<textarea id="basePersona" style="min-height:140px">' + esc(base !== '' ? base : baseDefault) + '</textarea>' +
      '<div class="btnrow" style="margin-top:8px"><button class="primary" id="baseSave">保存（下条消息生效）</button>' +
      '<button id="baseReset">恢复默认</button>' +
      (cardActive ? '<button id="baseSelf" data-self="1">脱下角色卡，回到自我</button>' : '') +
      '</div>' +
      '<p class="muted" style="margin:8px 0 0">当前：' + esc(cardActive ? '穿着「' + currentName + '」' : '自我（未穿人设卡）') + '</p></div>';
    // 预设和自定义合成一个列表：都能改名、编辑、试聊，不再区分来源。
    var custom = (s.personae || []).slice();
    var presetItems = presets.filter(function (p) { return hidden.indexOf(p.id) === -1; }).map(function (p) {
      return { id: p.id, name: (s.presetNames && s.presetNames[p.id]) || p.name || p.id, prompt: p.prompt || '', isPreset: true };
    });
    var customIds = custom.map(function (p) { return p.id; });
    var items = presetItems.filter(function (p) { return customIds.indexOf(p.id) === -1; }).concat(custom.map(function (p) {
      return { id: p.id, name: p.name, prompt: p.prompt, isPreset: false };
    }));

    out += '<div class="card"><h2>人设卡（cosplay）</h2>' +
      '<div class="muted" style="margin-bottom:8px">穿上哪张卡，就用那张卡的外形、背景、语气和喜好说话；卡片只叠加在自我卡外面，摘下后回到自我。点「穿上」切换。</div>';
    if (!items.length) out += '<div class="empty">还没有人设卡</div>';
    items.forEach(function (p) {
      var on = s.activePersonaId === p.id;
      out += '<div class="persona' + (on ? ' on' : '') + '"><h3>' + esc(p.name) +
        (on ? '<span class="tag">穿着中</span>' : '') + '</h3>' +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="primary small" data-use="' + esc(p.id) + '">' + (on ? '已穿上' : '穿上') + '</button>' +
        '<button class="small" data-edit="' + esc(p.id) + '">改名 / 编辑</button>' +
        '<button class="small" data-pv="' + esc(p.id) + '">试聊</button>' +
        (p.isPreset
          ? '<button class="small ghost" data-copy="' + esc(p.id) + '">复制一份</button>'
          : '<button class="danger small" data-del="' + esc(p.id) + '">删除</button>') +
        '</div></div>';
    });
    out += '</div>';

    var editing = items.filter(function (p) { return p.id === editingId; })[0];
    out += '<div class="card" id="personaForm"><h2>' + (editing ? '编辑人设卡：' + esc(editing.name) : '新建人设卡') + '</h2>';
    if (editing) {
      out += '<div class="banner" style="margin-bottom:10px">正在编辑「' + esc(editing.name) + '」，改完点「保存修改」。' +
        (editing.isPreset ? '这是内置人设卡，保存会直接改写它的文件。' : '') + '</div>';
    }
    out += '<div style="display:grid;gap:8px">' +
      '<input id="pName" placeholder="人设卡名字，例如：暴躁学霸" value="' + (editing ? esc(editing.name) : '') + '">' +
      '<textarea id="pPrompt" placeholder="人设卡提示词：这张卡的外形、口头禅、忌讳、爱吃什么……会被当成 cosplay 设定叠在自我卡上">' + (editing ? esc(editing.prompt) : '') + '</textarea>' +
      '<div class="btnrow"><button class="primary" id="pAdd">' + (editing ? '保存修改' : '新建人设卡') + '</button>' +
      '<button id="pCancel" style="display:' + (editing ? '' : 'none') + '">取消编辑</button></div></div></div>';

    out += '<div class="card"><h2>导入 / 导出</h2><div class="muted">导出成 JSON 保存或分享；导入会追加到列表。</div>' +
      '<div class="btnrow" style="margin-top:8px"><button id="pExport">导出 JSON</button></div>' +
      '<textarea id="pImport" style="margin-top:8px" placeholder="把人设 JSON 粘在这里"></textarea>' +
      '<button class="primary" id="pImportBtn" style="margin-top:8px">导入</button></div>';

    out += '<div class="card"><h2>AI 生成人设</h2><div class="muted" style="margin-bottom:8px">用 DSH 同一个模型和登录态，不另配 key。</div>' +
      '<input id="aiPersonaDesc" placeholder="例如：一个嘴很毒的健身教练，说话短，爱催人练">' +
      '<button class="primary" id="aiPersonaBtn" style="margin-top:8px">生成人设</button>' +
      '<div id="aiPersonaOut" class="muted" style="margin-top:10px;white-space:pre-wrap"></div></div>';

    out += '<div class="card"><h2>试聊预览</h2>' +
      '<div class="muted" style="margin-bottom:8px">用这个人设的提示词直接问模型：不经过 QQ，也不影响真实会话。改完人设先在这儿试一句。</div>' +
      '<select id="pvPersona">' +
      '<option value="self"' + (!s.activePersonaId || s.activePersonaId === 'self' ? ' selected' : '') + '>自我（空卡）</option>' +
      items.map(function (p) { return '<option value="' + esc(p.id) + '"' + (s.activePersonaId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' +
      '<textarea id="pvText" placeholder="说一句，比如：今天好累" style="margin-top:8px;min-height:72px"></textarea>' +
      '<div class="btnrow" style="margin-top:8px"><button class="primary" id="pvGo">让她回一句</button>' +
      '<span class="muted" id="pvMeta"></span></div>' +
      '<div id="pvOut" style="margin-top:12px"></div></div>';

    return out;
  }

  function viewWhitelist() {
    var users = data.settings.whitelist || [];
    var owners = (data.status && (data.status.owners || [])) || [];
    var perms = (data.status && data.status.ownerPerms) || { send: true, broadcast: true, schedule: true };
    var access = data.status && data.status.ownerAccess;
    var accessText = access ? (access.unavailableSessions ? '部分会话授权失败，请查看最近日志。' : '全局工具已启用；已有 ' + (Number(access.activeSessions) || 0) + ' 个号主会话完成授权，新对话首次接收指令时授权。') : '当前后端尚未加载全局权限版本，请完整退出并重新打开 DSH。';
    var out = '<div class="card"><h2>号主与 DSH 全局权限</h2>' +
      '<div class="muted" style="margin-bottom:8px">号主私聊使用 DSH 完整工具与全文件访问权限，可以直接指令她操作全局。下方三个开关只控制 QQ 代发、群发和定时功能。普通联系人不会获得全局权限。可填多个 QQ 号，一行一个或用逗号隔开。</div>' +
      '<div class="muted" role="status" style="margin-bottom:8px">' + esc(accessText) + '</div>' +
      '<textarea id="ownersInput" placeholder="例如 123456789" style="min-height:70px">' + esc(owners.join('\n')) + '</textarea>' +
      '<div style="margin-top:10px;display:grid;gap:6px">' +
      '<div class="row"><span>允许代发消息 <code>[发送:QQ|内容]</code></span><button class="small" data-ownerperm="send">' + (perms.send ? '已开' : '已关') + '</button></div>' +
      '<div class="row"><span>允许群发 <code>[群发:内容]</code></span><button class="small" data-ownerperm="broadcast">' + (perms.broadcast ? '已开' : '已关') + '</button></div>' +
      '<div class="row"><span>允许定时发送 <code>[定时:分钟|QQ|内容]</code></span><button class="small" data-ownerperm="schedule">' + (perms.schedule ? '已开' : '已关') + '</button></div>' +
      '</div>' +
      '<div class="btnrow" style="margin-top:10px"><button class="primary" id="ownerSave">保存</button>' +
      '<button class="small ghost" id="ownerUseFirst">用白名单第一个</button></div></div>';

    out+='<section class="card"><h2>她怎么称呼你</h2><p class="muted">先核对真实QQ号，再使用这个账号的备注。聊天和日记共用；昵称相同不会认成同一个人。</p>'+owners.map(id=>'<div class="row owner-address-row"><span class="mono">QQ '+esc(id)+'</span><input id="ownerAddress_'+esc(id)+'" data-owner-note="'+esc(id)+'" value="'+esc(data.settings.userNotes?.[id]||'')+'" maxlength="24" placeholder="例如：老爸、阿辰" aria-label="QQ '+esc(id)+' 的日常称呼"><button data-owner-note-save="'+esc(id)+'">保存称呼</button></div>').join('')+(!owners.length?'<p class="muted">先在上方保存你的QQ号。</p>':'')+'</section>';
    out += '<div class="card"><h2>允许私聊的 QQ</h2>' +
      '<div class="row" style="padding-top:0"><span class="muted">号码默认打码，备注只有你看得到；她看到的也只是备注 + 尾号。</span>' +
      '<button class="small" id="qqReveal">' + (showFullQQ ? '隐藏号码' : '显示完整号码') + '</button></div>';
    if (!users.length) out += '<div class="muted" style="margin-bottom:8px">为空时使用配置文件里的白名单：' + esc((data.allowUsers || []).join('、') || '无') + '</div>';
    var notes = data.settings.userNotes || {};
    users.forEach(function (u) {
      var off = (data.settings.disabledUsers || []).indexOf(u) !== -1;
      var note = notes[u] || '';
      out += '<div class="row" style="opacity:' + (off ? '.5' : '1') + '">' +
        '<span class="btnrow" style="flex:1;min-width:0">' +
        '<input class="noteInput" data-note="' + esc(u) + '" placeholder="备注，例如：本人" value="' + esc(note) + '" style="max-width:170px;padding:6px 10px">' +
        '<span class="mono">' + esc(showFullQQ ? u : '****' + u.slice(-4)) + '</span>' +
        (off ? '<span class="tag">已停用</span>' : '') + '</span>' +
        '<span class="btnrow"><button class="small" data-disuser="' + esc(u) + '">' + (off ? '启用' : '停用') + '</button>' +
        '<button class="danger small" data-delqq="' + esc(u) + '">移除</button></span></div>';
    });
    out += '<div class="row start" style="border-top:1px solid var(--line);padding-top:12px">' +
      '<input id="qqInput" placeholder="输入 QQ 号，回车添加" style="flex:1">' +
      '<button class="primary" id="qqAdd">添加</button></div></div>';

    var groups = (data.settings.groups || []).length ? data.settings.groups : data.status.configuredGroups || data.status.allowGroups || [];
    out += '<div class="card"><h2>允许的群</h2><div class="muted" style="margin-bottom:8px">群聊参与由日程里的群时段开启：到点后她会在 groupIds 指定的群里旁听、接话，也可以在群里自己起话头；时段结束或她判断该走了就关闭。没有开启时段时只回应 @。为空时不响应任何群。</div>';
    if (!groups.length) out += '<div class="empty">没有配置群</div>';
    groups.forEach(function (g) {
      var off=(data.settings.disabledGroups||[]).indexOf(g)!==-1;
      out += '<div class="row" style="opacity:'+(off?'.5':'1')+'"><span class="mono">' + esc(g) + '</span>'+(off?'<span class="tag">已停用</span>':'')+'<span class="btnrow"><button class="small" data-disgroup="'+esc(g)+'">'+(off?'启用':'停用')+'</button><button class="danger small" data-delgroup="' + esc(g) + '">移除</button></span></div>';
    });
    out += '<div class="row start" style="border-top:1px solid var(--line);padding-top:12px">' +
      '<input id="groupInput" placeholder="输入群号，回车添加" style="flex:1">' +
      '<button class="primary" id="groupAdd">添加</button></div>' +
      '<p class="muted">停用某个群会停止接话、主动消息及尚未发出的回复，保留群号、设置和历史；重新启用后继续使用。</p><label class="check-field"><input id="groupRequireAt" type="checkbox"'+(data.settings.groupRequireAt!==false?' checked':'')+'>没有日程群时段时，仅被 @ 才参与</label>' +
      '<div class="btnrow"><button class="primary" id="groupSave">保存群聊规则</button></div>' +
      '<p class="muted">日程里的群时段会写明参与哪些群、什么情况离开；到点自动开启和结束，不需要固定停用窗口或冷却。本地模式被 @ 后会开启 2 分钟关注窗口；生成回复、语音或图片时暂停倒计时，再次 @ 重新计满 2 分钟。窗口内的群消息先用最小额度判断“和她有没有关系 / 她是否感兴趣”，不启用聊天上下文和记忆；判断为是才进入正常回复，否则不回。模型可以选择 [skip] 不发言。</p></div>';
    return out;
  }

  function viewSticker() {
    var files = data.stickerFiles || [];
    var enabled = data.settings.stickers.enabled;
    var classification=data.stickerClassification||{};
    var out = '<div class="card"><div class="row"><span><b>表情包</b> <span class="muted">' + files.length + ' 张</span></span>' +
      '<button id="sToggle" class="' + (enabled ? '' : 'primary') + '">' + (enabled ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="muted">收藏后会在后台看图，识别情绪与适用场景，再放进合适的分组；不会额外发聊天回执。手动分组优先保留。</div>' +
      '<div class="row" style="margin-top:10px"><span id="sClassifyStatus" role="status">'+(classification.running?'正在看图整理':('待整理 '+Number(classification.pending||0)+' 张'))+(classification.failed?' · '+Number(classification.failed)+' 张暂未识别成功':'')+'</span><button id="sClassify" class="small">整理待分类图片</button></div>'+
      '<div class="muted">开启后她才能发图。停用的单张不会被抽到，也不能被指定。</div>' +
      '<div class="muted" style="margin-top:6px">内置 85 张鲸鱼娘预设随插件发布，首次启用时自动铺进来；删掉的不会再回来。</div></div>';

    out += '<div class="card"><h2>手动添加</h2><div style="display:grid;gap:8px">' +
      '<input id="sName" placeholder="名字（她发图时用的指令名，例如：无语）">' +
      '<input id="sFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp">' +
      '<button class="primary" id="sUpload">上传（≤8MB）</button></div></div>';

    out += '<div class="card"><h2>全部表情</h2>';
    var declared = data.settings.stickerGroups || [];
    var assigned = Object.keys(data.settings.stickerGroup || {}).map(function (k) { return data.settings.stickerGroup[k]; });
    var groups = [];
    declared.concat(assigned).forEach(function (g) {
      if (g && groups.indexOf(g) === -1) groups.push(g);
    });
    var pickedCount = Object.keys(pickedStickers).filter(function (k) { return pickedStickers[k]; }).length;
    out += '<div class="btnrow" style="margin-bottom:10px">' +
      '<button class="small ' + (sFilter === '' ? 'primary' : 'ghost') + '" data-sfilter="">全部</button>' +
      '<button class="small ' + (sFilter === '__none' ? 'primary' : 'ghost') + '" data-sfilter="__none">未分组</button>' +
      groups.map(function (g) {
        return '<span class="btnrow" style="gap:2px"><button class="small ' + (sFilter === g ? 'primary' : 'ghost') + '" data-sfilter="' + esc(g) + '">' + esc(g) + '</button>' +
          '<button class="small ghost" data-sdelgroup="' + esc(g) + '" title="删除分组">×</button></span>';
      }).join('') +
      '<button class="small" data-newgroup="1">＋ 新建分组</button></div>';
    out += '<div class="card" style="background:var(--soft);box-shadow:none;margin-bottom:12px">' +
      '<div class="row"><span>已选 <b id="pickCount">' + pickedCount + '</b> 张</span>' +
      '<span class="btnrow"><select id="pickGroup" style="width:170px">' +
      '<option value="">未分组</option>' +
      groups.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('') +
      '<option value="__new">＋新建分组…</option></select>' +
      '<button class="primary small" id="pickApply">分到该组</button>' +
      '<button class="small ghost" id="pickClear">清空选择</button></span></div></div>';
    out += '<div class="grid">';
    var shown = files.filter(function (name) {
      if (!sFilter) return true;
      var g = (data.settings.stickerGroup || {})[name] || '';
      if (sFilter === '__none') return g === '';
      return g === sFilter;
    });
    if (!shown.length) out += '<div class="empty" style="grid-column:1/-1">这个分组还没有表情</div>';
    shown.forEach(function (name) {
      var off = (data.settings.stickerDisabled || []).indexOf(name) !== -1;
      var group = (data.settings.stickerGroup || {})[name] || '';
      out += '<div class="sticker" style="opacity:' + (off ? '.45' : '1') + '">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;justify-content:center">' +
        '<input type="checkbox" data-pick="' + esc(name) + '"' + (pickedStickers[name] ? ' checked' : '') + ' style="width:auto">选择</label>' +
        '<img src="/im-bridge/sticker?name=' + encodeURIComponent(name) + '" alt="' + esc(name) + '">' +
        '<div class="name">' + esc(name) + (group ? ' <span class="tag">' + esc(group) + '</span>' : '') + '</div>' +
        (data.stickerNotes?.[name]?'<div class="muted" style="font-size:11px;padding:6px;line-height:1.5">'+esc(data.stickerNotes[name])+'</div>':'')+
        '<div class="acts"><button class="small ghost" data-stoggle="' + esc(name) + '">' + (off ? '启用' : '停用') + '</button>' +
        '<button class="small danger" data-delsticker="' + esc(name) + '">删</button></div></div>';
    });
    out += '</div></div>';

    return out;
  }

  var personaImageSelection='';
  var personaImageBusy=false;
  function personaImageMarkup(){
    var entries=[{id:'whale',name:(data.settings.presetNames||{}).whale||'大米鲸鱼娘'}, {id:'config',name:'自我（空卡）'}].concat(data.settings.personae||[]);
    var selected=personaImageSelection||data.settings.activePersonaId||'config';
    if(!entries.some(function(p){return p.id===selected;}))selected=entries[0].id;
    personaImageSelection=selected;
    var image=featureData?.personaImages?.[selected];
    return '<div class="card"><h2>人设参考图</h2><p class="muted">每个人设独立保存一张人物图。画角色本人时，有兼容图片输入就使用设定图进行图生图；文生图按人设中的外貌描述生成。脸部和身份特征保持一致，衣服、发型与可摘戴配饰根据当前要求和近期聊天变化，不照搬设定图；只拍眼前景物时不带入人物。一致程度取决于工作流的角色参考能力。</p>'+
      '<label class="field">管理哪个人设<select id="piPersona">'+entries.map(function(p){return '<option value="'+esc(p.id)+'"'+(selected===p.id?' selected':'')+'>'+esc(p.name)+'</option>';}).join('')+'</select></label>'+
      (image?'<img alt="已保存的人设参考图" src="/im-bridge/persona-image?persona='+encodeURIComponent(selected)+'&v='+image.updatedAt+'" style="display:block;max-width:100%;width:200px;max-height:260px;object-fit:contain;border-radius:12px;margin:10px 0">':'<p class="muted">此人设还没有参考图。建议选脸部清晰、发色与标志饰品明确的单人图。</p>')+
      '<label class="field">选择人物图<input id="piFile" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted">PNG / JPG / WebP，最多 8MB；点击保存后保存在本机私有数据目录，生图时才上传。不会进入普通配置导出。</small></label><div class="btnrow"><button class="primary" id="piSave">保存人设图</button><button id="piClear"'+(!image?' disabled':'')+'>移除人设图</button></div>'+
      '<p class="muted" id="piStatus" role="status">'+(featureData?.personaImageRevision==='20261024-persona-v1'?'当前聊天使用其联系人所选人设；这里切换仅管理图片，不切换聊天人设。':'添加前请完整退出并重新打开 DSH，以载入人设图功能。')+'</p></div>';
  }
  function bindPersonaImages(){
    if($('piPersona'))$('piPersona').onchange=function(){personaImageSelection=this.value;renderPane();};
    ['piSave','piClear'].forEach(function(id){if(!$(id))return;$(id).onclick=async function(){
      var button=this,personaId=$('piPersona').value,file=$('piFile').files[0],clear=id==='piClear';
      if(personaImageBusy)return;if(!clear&&!file)return toast('先选择一张人物图');if(file?.size>8*1024*1024)return toast('人设图最多 8MB');
      personaImageBusy=true;['piSave','piClear','piPersona','piFile'].forEach(function(key){if($(key))$(key).disabled=true;});var status=$('piStatus');status.textContent=clear?'正在移除…':'正在保存人设图…';
      try{var data64='';if(!clear)data64=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.onerror=function(){reject(Error('无法读取图片'));};reader.readAsDataURL(file);});
        await api('POST','/im-bridge/imagegen/persona-reference',{personaId:personaId,action:clear?'clear':'save',data:data64});
        studioInvalidate();delete pageDrafts[tab]?.piFile;await load();toast(clear?'人设图已移除':'人设图已保存');
      }catch(error){if(status.isConnected)status.textContent='保存失败：'+error.message;toast(error.message);}finally{personaImageBusy=false;if($('piPersona'))$('piPersona').disabled=false;if($('piFile'))$('piFile').disabled=false;if($('piSave'))$('piSave').disabled=false;if($('piClear'))$('piClear').disabled=!featureData?.personaImages?.[$('piPersona')?.value];}
    };});
  }
  function rhRoutingMarkup(rh){
    var images=(rh.discovery?.fields||[]).filter(function(f){return f.type==='IMAGE';});
    var current=rh.referenceMode==='off'?'off':rh.referenceTarget?studioFieldKey(rh.referenceTarget):'auto';
    return '<label class="field">人设图输入<select id="rhReference"><option value="auto"'+(current==='auto'?' selected':'')+'>自动（角色参考 / 第一张图片）</option><option value="off"'+(current==='off'?' selected':'')+'>不用人设图</option>'+images.map(function(f){var key=studioFieldKey(f);return '<option value="'+esc(key)+'"'+(current===key?' selected':'')+'>'+esc(f.label+' · '+key)+'</option>';}).join('')+'</select></label><p class="muted">人设图默认只放第一张身份参考输入，其他图片位不再自动复制；需要另一张素材时可单独上传。生图只用上方手动选择的当前工作流，画风写进提示词，不改选工作流。</p>';
  }
  function studioRoutingText(routing){
    if(!routing)return '';
    return ' · 使用 '+(routing.workflowName||'当前服务')+' · '+({front:'前置自拍',rear:'后置第一人称',mirror:'对镜自拍',external:'按要求他拍',scene:'场景构图'}[routing.camera]||'场景构图')+(routing.reference?' · 设定图参考（衣服与发型随聊天变化）':routing.identitySource==='persona-description'?' · 按人设外貌文生图':'');
  }
  function rhModelMarkup(rh){
    var models=[['auto','自动识别（优先模型节点，其次名称提示）'],['anima','Anima（版本未确认）'],['anima-base','Anima Base'],['anima-aesthetic','Anima Aesthetic'],['anima-turbo','Anima Turbo'],['z-image','Z-Image（版本未确认）'],['z-image-turbo','Z-Image Turbo'],['z-image-base','Z-Image Base'],['flux','FLUX'],['flux2-klein','FLUX.2 Klein'],['qwen-image-edit','Qwen Image 图像编辑'],['generic','通用 / 未确认模型']];
    return '<div class="form-two"><label class="field">底层模型 / 提示词策略<select id="rhPromptModel">'+models.map(function(m){return '<option value="'+m[0]+'"'+((rh.promptModel||'auto')===m[0]?' selected':'')+'>'+m[1]+'</option>';}).join('')+'</select></label><label class="field">固定正向词<select id="rhFixedMode"><option value="refine"'+(rh.fixedPromptMode!=='preserve'?' selected':'')+'>按模型精修（保留触发词）</option><option value="preserve"'+(rh.fixedPromptMode==='preserve'?' selected':'')+'>原样保留</option></select></label></div><label class="field">本工作流提示词语言<select id="rhPromptLanguage"><option value=""'+(!rh.promptLanguage?' selected':'')+'>跟随通用设置</option><option value="zh"'+(rh.promptLanguage==='zh'?' selected':'')+'>中文编辑指令</option><option value="en"'+(rh.promptLanguage==='en'?' selected':'')+'>英语编辑指令</option></select></label><p class="muted">请求示例可能隐藏模型；无法确认时使用通用写法，可手动选择具体型号。精修固定词的光线、线条、色彩和材质，不固定服装或发型；原有画师权重和 LoRA 标记会保留。润色预览会显示实际策略与本次固定词。</p>';
  }
  function rhTriggerMarkup(rh){
    return '<label class="field">LoRA 触发词／固定追加词（可选，每行一条）<textarea id="rhTriggers" maxlength="500" rows="2" placeholder="只填这个工作流确实需要的触发词">'+esc(rh.triggerWords||'')+'</textarea></label><p class="muted">随当前图片工作流保存，生成时补进提示词；LoRA 文件仍须在 RunningHub 工作流里加载。不会据此自动切换工作流，也不需要固定服装或日程。</p>';
  }

  function viewPhoto() {
    var out = "";
    var ph = data.settings.photo || {};
    out += '<div class="card"><h2>照片来源</h2>' +
      '<div class="muted" style="margin-bottom:8px">她发 [图:画面描述] 时按这里的规则找图。生成会参考当前对话的人设画风和本次图片要求；自拍才使用角色外观。自备图库（photos/library）永远优先。</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<label class="field">来源<select id="phSource">' +
      '<option value="search"' + ((ph.source || 'search') === 'search' ? ' selected' : '') + '>只搜真实照片</option>' +
      '<option value="gen"' + (ph.source === 'gen' ? ' selected' : '') + '>只生成</option>' +
      '<option value="auto"' + (ph.source === 'auto' ? ' selected' : '') + '>搜不到再生成</option>' +
      '</select></label>' +
      '<label class="field">人像性别<select id="phGender">' +
      '<option value="女"' + ((ph.gender || '女') === '女' ? ' selected' : '') + '>女</option>' +
      '<option value="男"' + (ph.gender === '男' ? ' selected' : '') + '>男</option>' +
      '</select></label></div>' +
      '<label class="field" style="margin-top:8px">角色外观（人设未写外观时，自拍采用这里）' +
      '<input id="phLook" value="' + esc(ph.appearance || '蓝黑色长发的年轻女生，鲸鱼发饰') + '"></label>' +
      '<label class="field" style="margin-top:8px">最小宽度（搜图阈值）' +
      '<input id="phMinWidth" type="number" min="400" max="2000" value="' + Number(ph.minWidth || 800) + '"></label>' +
      '<div class="muted" style="margin-top:6px">生成使用「图像生成」页所选服务，失败时可能回退到 Pollinations。画风优先采用本次请求，再参考当前人设中的画风；搜图和自备图片保持原图风格。</div>' +
      '<div class="btnrow" style="margin-top:10px"><button class="primary" id="phSave">保存</button>' +
      '<input id="phTestKw" placeholder="试一个关键词" style="flex:1;min-width:140px">' +
      '<button id="phTest">试一张</button></div>' +
      '<div id="phTestOut" class="muted" style="margin-top:8px;white-space:pre-wrap"></div></div>';

    return out;
  }

  function viewCollect() {
    var out = "";
    out += '<div class="card"><h2>从网页收一整套</h2>' +
      '<div class="muted" style="margin-bottom:8px">把表情包合集页／相册页的链接贴进来，它会把这个页面上所有够大的图都收下来。比搜图准得多——同一套图通常就在同一页。</div>' +
      '<input id="pageUrl" placeholder="https://… 表情包合集 / 相册页">' +
      '<div class="btnrow" style="margin-top:8px"><label class="field">名字前缀<input id="pageName" placeholder="鲸鱼娘" style="width:130px"></label>' +
      '<label class="field">数量<input id="pageLimit" type="number" min="1" max="30" value="15" style="width:80px"></label>' +
      '<button class="primary" id="pageGo" style="align-self:flex-end">收下来</button></div>' +
      '<div id="pageOut" class="muted" style="margin-top:10px;white-space:pre-wrap"></div></div>';

    out += '<div class="card"><h2>批量收集（质量优先）</h2>' +
      '<div class="muted" style="margin-bottom:8px">同时用几个近义查询词搜，按「像素 + 文件体积 + 无损格式」打分，只留评分最高的几张。比单关键词精准得多。</div>' +
      '<input id="harvestQueries" placeholder="多个关键词用逗号隔开，例如：蓝色鲸鱼娘,蓝鲸 娘,鲸鱼 可爱 表情包">' +
      '<div class="btnrow" style="margin-top:8px"><label class="field">名字前缀<input id="harvestName" placeholder="鲸鱼娘" style="width:130px"></label>' +
      '<label class="field">数量<input id="harvestLimit" type="number" min="1" max="30" value="12" style="width:80px"></label>' +
      '<button class="primary" id="harvestGo" style="align-self:flex-end">开始收集</button></div>' +
      '<div id="harvestOut" class="muted" style="margin-top:10px;white-space:pre-wrap"></div></div>';

    out += '<div class="card"><h2>表情含义</h2>' +
      '<div class="muted" style="margin-bottom:8px">她原本只认得表情包的名字。识别一遍之后，她知道每张图「长什么样、表达什么」，聊天时就能对得上。</div>' +
      '<div class="btnrow"><button class="primary" id="noteFill">识别一批（每次 6 张）</button>' +
      '<span class="muted" id="noteMeta"></span></div>' +
      '<div id="noteOut" class="muted" style="margin-top:10px;white-space:pre-wrap;max-height:180px;overflow:auto"></div></div>';

    out += '<div class="card"><h2>AI 搜表情包</h2><div class="muted" style="margin-bottom:8px">联网搜图并直接入库；会过滤 logo 和小图，但质量随机，建议用具体词。</div>' +
      '<input id="aiStickerQuery" placeholder="例如：蓝色大肥鱼 表情包">' +
      '<button class="primary" id="aiStickerBtn" style="margin-top:8px">搜索并添加</button>' +
      '<div id="aiStickerOut" class="muted" style="margin-top:10px;white-space:pre-wrap"></div></div>';

    out += '<div class="card"><h2>以图搜同款</h2>' +
      '<div class="muted" style="margin-bottom:8px">传一张表情包，她先看懂它表达什么情绪，再用判断出来的关键词去搜同类图。</div>' +
      '<input type="file" id="visFile" accept="image/*" style="padding:8px;background:var(--panel-2);border-radius:10px">' +
      '<div class="btnrow" style="margin-top:8px"><button class="primary" id="visGo">看图搜同类</button>' +
      '<span class="muted" id="visMeta"></span></div>' +
      '<div id="visOut" class="muted" style="margin-top:10px;white-space:pre-wrap"></div></div>';

    return out;
  }

  function monitorFiles(m) { return Array.from(new Set([...(Array.isArray(m.files)?m.files:[]),m.file].filter(function(file){return typeof file==='string'&&/^[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/i.test(file);}))); }
  function viewMonitor() {
    var all = (monitor && monitor.messages) || [];
    var chats = [];
    all.forEach(function (m) {
      var key = m.chat || '未知';
      if (chats.indexOf(key) === -1) chats.push(key);
    });
    var list = all.filter(function (m) {
      if (msgChat !== 'all' && (m.chat || '未知') !== msgChat) return false;
      if (msgFilter !== 'all' && m.dir !== msgFilter) return false;
      if (monQuery !== '') {
        var hay = String(m.text || '') + ' ' + notesLabel(m.chat || '');
        if (hay.indexOf(monQuery) === -1) return false;
      }
      return true;
    });
    var out = '<div class="card"><div class="banner"><b>免责声明</b><br>' + esc((monitor && monitor.disclaimer) || '') + '</div></div>';
    out += '<div class="card"><div class="row"><span><b>消息记录</b> <span class="muted">' + list.length + ' / ' + all.length + ' 条</span></span>' +
      '<input id="monSearch" placeholder="搜内容或备注" value="' + esc(monQuery) + '" style="max-width:180px;padding:7px 10px">' +
      '<span class="seg" id="msgSeg"><button data-filter="all" class="' + (msgFilter === 'all' ? 'on' : '') + '">全部</button>' +
      '<button data-filter="in" class="' + (msgFilter === 'in' ? 'on' : '') + '">收到</button>' +
      '<button data-filter="out" class="' + (msgFilter === 'out' ? 'on' : '') + '">发出</button></span></div>';

    if (chats.length > 0) {
      out += '<div class="btnrow" style="margin-top:10px">' +
        '<button class="small ' + (msgChat === 'all' ? 'primary' : 'ghost') + '" data-chat="all">全部对话</button>' +
        chats.map(function (c) {
          return '<button class="small ' + (msgChat === c ? 'primary' : 'ghost') + '" data-chat="' + esc(c) + '">' +
            esc(notesLabel(c)) + '</button>';
        }).join('') + '</div>';
    }
    out += '<div class="btnrow" style="margin-top:10px"><button class="danger small" id="mClear">清空记录</button>' +
      '<span class="muted" style="align-self:center">仅保存白名单对话 · 每 2 秒自动刷新</span></div>';

    out += '<div class="msgs" style="margin-top:12px">';
    if (!list.length) out += '<div class="empty">这个分组还没有消息</div>';
    list.slice().reverse().forEach(function (m) {
      out += '<div class="msg ' + m.dir + '"><div class="meta"><span>' + (m.dir === 'in' ? '收到' : ({queued:'等待发送',sending:'等待回执',sent:'已发出',unknown:'送达待确认',failed:'发送失败',cancelled:'已取消'})[m.delivery] || '发出') +
        '</span><span class="mono">' + esc(notesLabel(m.chat || '')) + '</span><span>' + new Date(m.time).toLocaleTimeString() + '</span></div>' +
        '<div class="body">' + esc(m.text || '') + '</div>' +
        monitorFiles(m).map(function(file){return '<a href="/im-bridge/msg-image?file=' + encodeURIComponent(file) + '" target="_blank" rel="noopener"><img loading="lazy" src="/im-bridge/msg-image?file=' + encodeURIComponent(file) + '" alt="' + (m.dir === 'out' ? '机器人发出的图片' : '收到的图片') + '"></a>';}).join('') +
        '</div>';
    });
    out += '</div></div>';
    return out;
  }

  function viewAutonomy() {
    var a = (data.status && data.status.autonomy) || { config: {}, state: {} };
    var c = a.config || {};
    var st = a.state || {};
    var counts = st.counts || {};
    var cap = c.maxPerDay || {};
    var on = !!c.enabled;
    function swRow(key, label, desc) {
      return '<div class="row"><span>' + label + '<br><span class="muted">' + desc + '</span></span>' +
        '<button class="small ' + (c[key] ? 'primary' : '') + '" data-auto="' + key + '">' + (c[key] ? '已开' : '已关') + '</button></div>';
    }
    var out = '';
    if (st.lastError) {
      out += '<div class="card"><div class="banner"><b>上次自主动作失败</b><br>' + esc(st.lastError.message) +
        '<br><span class="muted">' + esc(st.lastError.action || '') + ' · ' + esc(new Date(st.lastError.at).toLocaleString()) +
        '。空间接口的 cookie 会过期，重新登录 NapCat 通常能恢复。</span></div></div>';
    }
    out += '<div class="card"><div class="row"><span><b>自主模式</b><br><span class="muted">让她自己决定要不要做点什么；事件和空闲检查触发，是否调用模型由待办与新信息决定</span></span>' +
      '<button class="' + (on ? 'primary' : '') + '" id="autoMaster">' + (on ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="btnrow" style="margin-top:8px"><button id="autoTick">现在想一次</button>' +
      '<button class="danger" id="autoStop">紧急停止</button></div>' +
      '<div class="muted" style="margin-top:8px">今天：签名 ' + (counts.signature || 0) +
      ' · 空间 ' + (counts.qzone || 0) +
      ' · 主动找人 ' + (counts.chats || 0) + '（拟真模式关闭时会按内部默认额度限制）</div>' +
      '<div class="muted">'+(data.settings.life?.enabled!==false&&data.settings.life?.sleep!==false?'活动与睡眠跟随日程':'主动时段按当前作息设置决定')+'</div>' +
      '<div class="muted" style="margin-top:6px">后台主动消息与账号动作遵守当前运行方式；聊天与分享只面向已允许的联系人，手动指令仍按号主权限执行。</div></div>';

    out += '<div class="card"><h2>允许她做什么</h2>' +
      swRow('signature', '改个性签名', '一句话，20 字内') +
      swRow('qzone', '发 QQ 空间说说', '走 cookie 接口，非官方；发出去是公开的') +
      swRow('initiate', '主动找人聊天', '只找白名单里的人') + '</div>';

    out += '<div class="card"><h2>主动互动设置</h2><details id="autoFallbackHours"'+(data.settings.life?.enabled===false||data.settings.life?.sleep===false?' open':'')+'><summary>备用时段（只在日程作息关闭时生效）</summary><div class="form-two">' +
      '<label class="field">醒着从<input id="autoWakeA" type="number" min="0" max="23" value="' + (c.wakeStart ?? 9) + '"></label>' +
      '<label class="field">到<input id="autoWakeB" type="number" min="1" max="24" value="' + (c.wakeEnd || 23) + '"></label>' +
      '</div></details><label class="field" style="margin-top:10px">闲多久可主动找人（分钟）<input id="autoIdle" type="number" min="5" max="1440" value="'+Number(c.chatIdleMinutes??30)+'"></label><label class="field">主动私聊最短间隔（分钟，0 为不限）<input id="autoPrivateGap" type="number" min="0" max="1440" value="'+Number(c.privateMinGapMinutes??0)+'"></label><p class="muted">开放工具权限不等于一直在线。设定间隔后，全账号按此频率发送主动私聊，每次最多一条；近期聊天后会留出安静时间。自动签名每天最多尝试一次。正常回复和本人明确要求的操作不受此主动间隔限制，并遵守自己选择的日程休息，也可以旁听或不说话。</p><label class="check-field"><input id="autoExplore" type="checkbox"'+(c.explore!==false?' checked':'')+'>允许按兴趣浏览、学习和创作，再判断是否分享</label><label class="check-field"><input id="autoQzoneImages" type="checkbox"'+(c.qzoneImages!==false?' checked':'')+'>空间动态可配图（她自己选搜图、截图、生成或画作）</label><label class="check-field"><input id="autoQzoneReplies" type="checkbox"'+(c.qzoneReplies===true?' checked':'')+'>允许逛空间时评论与回复（仅针对实际读到的内容）</label><p class="muted">后台检查与实际模型调用分开，各类活动分别计时，不用聊天挤占空间动态。没有新内容可以不做；图片来源由她按内容选择，生成图沿用当前生图设置与人设风格。空间总开关独立控制全部空间专用功能；日程每天仅提醒一次，可放弃，每次主动访问最多尝试一条评论或回复。好友仍须在允许名单内。B站评论另有独立发布开关。</p><button class="primary" id="autoSave" style="margin-top:10px">保存</button></div>';

    out += proactiveCards();
    out+='<div class="card"><h2>能力是否可用</h2>'+(featureData?.capabilityHealth||[]).map(x=>'<div class="row"><span><b>'+esc(x.label)+'</b><small class="muted" style="display:block">'+esc(x.reason)+'</small></span><span class="tag">'+esc(({ready:'可用',setup:'待配置',disabled:'已关闭'})[x.state]||x.state)+'</span></div>').join('')+'</div>';
    out += phoneMarkup();out += viewMediaSharing(c,a.mediaSharing||{});
    out += learningMarkup(true)+lifeMarkup();

    out += '<div class="card"><h2>最近做的事</h2>';
    var log = st.log || [];
    if (!log.length) out += '<div class="empty">还没做过什么</div>';
    log.forEach(function (item) {
      out += '<div class="row"><span class="mono">' + esc(new Date(item.at).toLocaleString()) + '</span><span class="muted">' +
        esc(item.action + (item.target ? ' → ' + item.target : '') + '：' + (item.text || '')) + '</span></div>';
    });
    out += '</div>';
    return out;
  }
  var growthSelection='';
  function growthMarkup(){
    var g=featureData?.personaGrowth||{},scopes=g.scopes||[],c=data.settings.personaGrowth||{},chosen=scopes.filter(function(s){return (s.meta.key||'')+'|'+s.meta.personaId===growthSelection;})[0]||scopes.filter(function(s){return s.history?.length;})[0]||scopes[0];
    if(chosen)growthSelection=(chosen.meta.key||'')+'|'+chosen.meta.personaId;
    var out='<div class="card"><h2>人设成长（日常观察 + 按月固化）</h2><p class="muted">每天结束且交流足够时，先做一次短期观察，最多留一条小变化，按保留天数自行消退；自然月归档后再固化为长期设定。手写核心人设保留，联系人的相处设定分别积累，改动有依据且可回退。</p><label class="check-field"><input type="checkbox" id="grEnabled"'+(c.enabled!==false?' checked':'')+'>根据日/月记忆自动成长</label><label class="check-field"><input type="checkbox" id="grDaily"'+(c.daily!==false?' checked':'')+'>每天做一次短期观察</label><div class="form-two"><label class="field">小变化保留天数<input id="grDailyDays" type="number" min="1" max="60" value="'+Number(c.dailyDays??14)+'"></label><label class="field">当天至少几条你的发言才观察<input id="grDailyMinUser" type="number" min="1" max="50" value="'+Number(c.dailyMinUser??4)+'"></label></div><div class="btnrow"><button id="grSave" class="primary">保存成长设置</button><button id="grProcess">检查已归档日/月</button></div><label class="field">查看范围<select id="grScope">'+scopes.map(function(s){var id=(s.meta.key||'')+'|'+s.meta.personaId;return '<option value="'+esc(id)+'"'+(id===growthSelection?' selected':'')+'>'+esc(personaLabel(s.meta.personaId)+' · '+(s.meta.key?notesLabel(s.meta.key):'角色自身日常'))+'</option>';}).join('')+'</select></label>';
    var stable=chosen?.effective||[],recent=chosen?.recent||[];
    if(!stable.length&&!recent.length&&!chosen?.history?.length)out+='<p class="muted">还没有成长记录。日观察会在一天结束、交流足够后出现；月度设定要等自然月归档，不会拿几天聊天冒充整个月。</p>';
    else{
      if(stable.length)out+='<h3>长期生效（按月固化）</h3>'+stable.map(function(x){return '<p>'+esc(x.text)+'</p>';}).join('');
      if(recent.length)out+='<h3>最近的小变化</h3>'+recent.map(function(x){return '<p>'+esc(x.text)+' <small class="muted">（'+esc(new Date(x.expiresAt).toLocaleDateString())+' 前有效）</small></p>';}).join('');
      var levelOf=function(h){return h.level||(String(h.id||'').indexOf('day:')===0?'day':'month');},hist=chosen?.history||[],renderHist=function(h){var day=levelOf(h)==='day',label=day?((h.start||'')+' · 日观察'):((h.month||'')+' · 月成长');return '<div class="row"><span>'+esc(label)+(h.reverted?' · 已回退':' · '+h.changes.length+'项变化')+'</span>'+(!h.reverted?'<button class="small" data-growth-revert="'+esc(h.id)+'">回退这次</button>':'')+'</div>';};
      out+=hist.filter(function(h){return levelOf(h)==='day';}).slice(-3).reverse().map(renderHist).join('')+hist.filter(function(h){return levelOf(h)==='month';}).slice(-3).reverse().map(renderHist).join('');
    }
    if(chosen?.status?.reason)out+='<p class="muted">'+esc(chosen.status.reason)+'</p>';return out+'</div>';
  }
  var visualPanelTimer=null,visualFloatKey='';
  function mobileVisualPanelMarkup(){
    var owners=(data.settings.owners||[]).map(id=>'<option value="private:'+esc(id)+'">'+esc(id)+'</option>').join('');
    return `<div class="card">
      <h2>手机识屏陪伴 · API</h2>
      <p class="muted">开始后切到想看的应用。只处理最新画面，优先回应你的提问。视觉理解按实际调用计费。</p>
      <label class="field">接收反馈的私聊<select id="vsKey">${owners}</select></label>
      <label class="field">观察模式<select id="vsPhoneProfile"><option value="saver">省流 · 低频观察</option><option value="balanced" selected>均衡 · 推荐</option><option value="detail">细看 · 更多细节</option></select></label>
      <input id="vsTarget" type="hidden" value="phone"><input id="vsMode" type="hidden" value="watch">
      <div class="btnrow"><button id="vsStart" class="primary">开始手机识屏陪伴</button><button id="vsPause">暂停</button><button id="vsResume">继续</button><button id="vsStop" class="danger">结束</button><button id="vsRefresh">刷新状态</button><button id="vsFloat">打开页内悬浮球</button></div>
      <p id="vsSource" class="muted">本机屏幕 · 尚未开始</p>
      <p id="vsResult" role="status">尚未读取状态</p>
      <p class="muted">跨应用悬浮球由 Android 共享你选择的画面。语音输入可使用已配置的识别 API。</p>
      <div class="btnrow">
        <a class="btn" id="vsInstallNative" target="_top" rel="noreferrer" aria-disabled="true">安装屏幕陪伴组件</a>
        <button id="vsNative" class="primary">连接跨应用悬浮球</button>
        <a class="btn" id="vsLaunchNative" target="_top" rel="noreferrer" hidden>在浏览器打开连接</a>
        <button id="vsCopyNative" hidden>复制连接信息</button>
      </div>
      <p id="vsNativeState" class="muted" aria-live="polite">正在检查安装入口…</p>
      <p id="vsNativeResult" class="muted" role="status"></p>
      <textarea id="vsNativeValue" class="field" readonly hidden aria-label="组件连接信息"></textarea>
    </div>`;
  }
  function visualPanelMarkup(){if(mobileApiOnly())return mobileVisualPanelMarkup();return '<div class="card"><h2>持续视听陪伴</h2><p class="muted">直接观察当前电脑屏幕，或选一个可见窗口；原生采集不依赖 FFmpeg，也不要求浏览器共享选择器。开始后使用当前选择的模型，API 会产生用量；本地降低画面尺寸和分析频率，聊天优先。</p><div class="form-two"><label class="field">接收反馈的私聊<select id="vsKey">'+(data.settings.owners||[]).map(function(id){return '<option value="private:'+esc(id)+'">'+esc(id)+'</option>';}).join('')+'</select></label><label class="field">观察来源<select id="vsTarget">'+(mobileApiOnly()?'':'<option value="screen">当前电脑屏幕（原生取图）</option><option value="window">选择可见窗口</option><option value="shared">浏览器共享选择器（可选）</option>')+'<option value="browser">通过链接打开独立浏览器（可选）</option></select></label><label class="field" id="vsWindowField" hidden>观察窗口<select id="vsWindow"><option value="">先点刷新窗口列表</option></select><button id="vsWindows" type="button">刷新窗口列表</button><small style="display:block;line-height:1.6">直接读取选定窗口；最小化或受保护的窗口可能无法捕获，不会截取其他应用代替</small></label><label class="field">互动方式<select id="vsMode"><option value="watch">一起看</option><option value="game">陪我玩游戏</option></select></label><label class="field" id="vsUrlField">视频或游戏网址<input id="vsUrl" type="url" placeholder="仅链接方式需要填写"></label></div><div class="btnrow"><label class="check-field"><input id="vsAudio" type="checkbox" checked>同时共享声音（来源支持时）</label><label class="check-field" id="vsControlField"><input id="vsControl" type="checkbox">允许操作独立浏览器游戏</label></div><p class="muted">原生识屏与独立悬浮球可在离开插件后继续；本轮仅观察画面，不声称听到系统声音。可选的浏览器共享方式才使用系统选择器与共享音轨。屏幕／窗口陪玩提供观察和交流，自动按键仅限独立浏览器游戏。</p><div class="btnrow"><button id="vsStart" class="primary">选择画面并开始</button><button id="vsProbe">检测取图（不调用模型）</button><button id="vsPause">暂停</button><button id="vsResume">继续</button><button id="vsStop" class="danger">结束</button><button id="vsRefresh">刷新状态</button><button id="vsFloat">打开桌面悬浮球</button></div><img id="vsPreview" alt="本次实际取图预览" hidden style="max-width:100%;max-height:320px;border-radius:12px"><p id="vsSource" class="muted">尚未选择共享来源</p><p id="vsResult" role="status">尚未读取状态</p><p id="vsCaptureHelp" class="muted" hidden></p></div>';}
  function bindVisualPanel(){
    clearInterval(visualPanelTimer);visualPanelTimer=null;if(!$('vsStart'))return;
    var currentSession=null;if(visualFloatKey&&[...$('vsKey').options].some(o=>o.value===visualFloatKey))$('vsKey').value=visualFloatKey;var floatUi=mobileApiOnly()?globalThis.DSHMobileCompanionFloat:globalThis.DSHCompanionFloat;floatUi?.configure({api,device:mobileApiOnly()?'phone':'desktop',getKey:()=>{const value=$('vsKey')?.value;if(value)visualFloatKey=value;return visualFloatKey;}});if($('vsFloat'))$('vsFloat').onclick=()=>{if(mobileApiOnly())floatUi?.show();else void floatUi?.openPinned();};
    var installer=$('vsInstallNative'),nativeButton=$('vsNative'),nativeLink=$('vsLaunchNative'),nativeCopy=$('vsCopyNative'),nativeValue=$('vsNativeValue'),nativeNote=$('vsNativeResult');
    var nativePair=null,pairExpires=0;
    function clearNativePair(){
      nativePair=null;pairExpires=0;
      if(nativeLink){nativeLink.hidden=true;nativeLink.removeAttribute('href');nativeCopy.hidden=true;nativeValue.hidden=true;nativeValue.value='';nativeNote.textContent='';}
    }
    function nativePairCurrent(){
      if(nativePair&&Date.now()<pairExpires)return true;
      clearNativePair();
      nativeNote.textContent='连接已过期，请再次点「连接跨应用悬浮球」。';
      return false;
    }
    if(installer)installer.onclick=function(event){
      if(!installer.hasAttribute('href')){event.preventDefault();nativeNote.textContent='安装入口尚未就绪，请刷新状态。';return;}
      nativeNote.textContent='请在浏览器点「下载组件 APK」，再从下载列表打开安装包。';
    };
    if(nativeButton)nativeButton.onclick=async function(){
      var key=$('vsKey').value;
      nativeButton.disabled=true;
      clearNativePair();
      try{
        var value=await api('POST','/im-bridge/visual-session',{action:'pair-native',key});
        if($('vsNative')!==nativeButton||$('vsKey').value!==key)return;
        if(!value.handoffUrl)throw Error('手机引擎需要加载新版后才能打开连接页。');
        nativePair=value;
        pairExpires=Number(value.expiresAt);
        nativeLink.href=value.handoffUrl;
        nativeLink.hidden=false;
        nativeCopy.hidden=false;
        nativeNote.textContent='请点「在浏览器打开连接」，再打开组件。连接信息 2 分钟内有效。';
      }catch(error){nativeNote.textContent=error.message;}finally{nativeButton.disabled=false;}
    };
    if(nativeLink)nativeLink.onclick=function(event){if(!nativePairCurrent())event.preventDefault();};
    if(nativeCopy)nativeCopy.onclick=async function(){
      if(!nativePairCurrent())return;
      try{await navigator.clipboard.writeText(nativePair.url);nativeNote.textContent='已复制，请在屏幕陪伴组件里粘贴连接信息。';}
      catch{nativeValue.value=nativePair.url;nativeValue.hidden=false;nativeValue.focus();nativeValue.select();}
    };

    function source(){if(!$('vsSource'))return;if(mobileApiOnly()){$('vsSource').textContent=(currentSession?.captureSource==='native'?'观察来源：系统持续屏幕共享 · 跨应用悬浮球':'观察来源：本机屏幕 · DSH Go 原生截图');return;}if(currentSession&&['screen','window'].includes(currentSession.target)){$('vsSource').textContent='观察来源：'+(currentSession.sourceLabel||'当前电脑屏幕')+' · Windows 原生取图';return;}if(['screen','window'].includes($('vsTarget').value)){$('vsSource').textContent='观察来源：'+($('vsTarget').value==='window'?'选定窗口':'当前电脑屏幕')+' · 尚未开始持续观察';return;}var value=globalThis.DSHVisualShare?.info();$('vsSource').textContent=value?'当前共享：'+value.label+(value.audio?' · 已取得音轨':' · 未取得音轨'):'尚未共享画面';}
    function issue(error){toast(error.message);if($('vsResult'))$('vsResult').textContent=error.message;if(/不支持系统共享选择器/.test(error.message)&&$('vsCaptureHelp')){$('vsCaptureHelp').hidden=false;$('vsCaptureHelp').textContent='可在 Microsoft Edge 打开当前本地面板地址：'+location.href;}}
    async function status(){
      try{
        var value=await api('GET','/im-bridge/visual-session');
        if(!$('vsResult')||installer&&$('vsInstallNative')!==installer)return;
        var key=$('vsKey').value,session=(value.sessions||[]).find(s=>s.key===key);
        currentSession=session;
        if(installer){
          var download=value.installer?.available&&value.installer.url;
          if(download){installer.href=download;installer.removeAttribute('aria-disabled');}
          else{installer.removeAttribute('href');installer.setAttribute('aria-disabled','true');}
          var overlay=session?.nativeCapture;
          $('vsNativeState').textContent=overlay?.ready?'跨应用悬浮球已收到共享画面。':overlay?.connected?(session.status==='paused'?'组件已连接，画面共享已暂停。':session.sourceWait||'组件已连接，等待共享画面。'):download?'安装包可下载，悬浮球尚未连接。':'此版本未提供可用的组件下载入口。';
        }
        var share=globalThis.DSHVisualShare?.info();
        if(share&&(!session||session.id!==share.id))await globalThis.DSHVisualShare.stop(true);
        else if(share&&session.status!=='running')await globalThis.DSHVisualShare.stop(false);
        var labels={running:session?.captures?'正在观察':'等待画面',paused:'已暂停',stopped:'已结束',ended:'视频已结束',error:'已因错误暂停'};
        $('vsResult').textContent=session?[(labels[session.status]||session.status),session.sourceLabel||'',session.backend==='local'?'本地模型':'API 模型',session.priorityWait?'正在优先处理聊天':'','已取画面 '+session.captures+' 次，分析 '+session.analyses+' 次，互动 '+session.reactions+' 次'+(installer?'':'，操作 '+session.actions+' 次'),session.sourceWait||session.coverage||'',session.error||''].filter(Boolean).join(' · '):'尚未开始';
        source();
      }catch(e){if($('vsResult'))$('vsResult').textContent=e.message;}
    }
    async function start(){if(mobileApiOnly()){await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:'start',target:'phone',sourceLabel:'本机屏幕',mode:'watch',audio:false,control:false,profile:$('vsPhoneProfile')?.value||'balanced'});floatUi?.show();}else if(['screen','window'].includes($('vsTarget').value)){var target=$('vsTarget').value,windowId=$('vsWindow')?.value||'';if(target==='window'&&!windowId)throw Error('请刷新窗口列表并选择窗口');await globalThis.DSHVisualShare?.stop(true);await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:'start',target,windowId,mode:'watch',audio:false,control:false,sourceLabel:target==='window'?$('vsWindow').selectedOptions[0]?.textContent:'当前电脑屏幕'});try{await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:'open-window'});}catch(error){if($('vsCaptureHelp')){$('vsCaptureHelp').hidden=false;$('vsCaptureHelp').textContent='识屏已启动，但桌面悬浮球没有打开：'+error.message;}}}else if($('vsTarget').value==='shared'){if(!globalThis.DSHVisualShare)throw Error('共享界面组件尚未加载，请刷新面板');await globalThis.DSHVisualShare.start({api,key:$('vsKey').value,mode:$('vsMode').value,audio:$('vsAudio').checked,onStatus:function(text){if($('vsSource'))$('vsSource').textContent=text;}});}else{await globalThis.DSHVisualShare?.stop(true);await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:'start',target:'browser',mode:$('vsMode').value,url:$('vsUrl').value.trim(),audio:$('vsAudio').checked,control:$('vsControl').checked});}await status();}
    $('vsStart').onclick=async function(){this.disabled=true;try{
      if(currentSession?.nativeCapture?.connected){
        if(currentSession.status==='paused')await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:'resume',id:currentSession.id});
        await status();
      }else await start();
    }catch(e){issue(e);}finally{this.disabled=false;}};
    ['Pause','Resume','Stop'].forEach(function(name){$('vs'+name).onclick=async function(){this.disabled=true;try{if(name==='Resume'&&currentSession?.target==='shared'){$('vsTarget').value='shared';target();await start();}else{if(name!=='Resume')await globalThis.DSHVisualShare?.stop(false);await api('POST','/im-bridge/visual-session',{key:$('vsKey').value,action:name.toLowerCase(),id:currentSession?.id});await status();}}catch(e){issue(e);}finally{this.disabled=false;}};});
    $('vsRefresh').onclick=status;$('vsKey').onchange=function(){clearNativePair();currentSession=null;void status();};
    if($('vsProbe'))$('vsProbe').onclick=async function(){this.disabled=true;try{var windowId=$('vsTarget').value==='window'?$('vsWindow').value:'';if($('vsTarget').value==='window'&&!windowId)throw Error('先刷新窗口列表并选择窗口');var result=await api('POST','/im-bridge/visual-session',{action:'probe',key:$('vsKey').value,windowId});$('vsPreview').src=result.preview;$('vsPreview').hidden=false;$('vsResult').textContent='原生取图成功 · '+result.capture.width+'×'+result.capture.height+' · 本次没有调用模型或发送QQ';}catch(e){issue(e);}finally{this.disabled=false;}};
    if($('vsWindows'))$('vsWindows').onclick=async function(){this.disabled=true;try{var result=await api('POST','/im-bridge/visual-session',{action:'sources',key:$('vsKey').value});$('vsWindow').replaceChildren(...(result.windows||[]).map(function(row){var option=document.createElement('option');option.value=row.windowId;option.textContent=row.title;return option;}));if(!(result.windows||[]).length)throw Error('没有可见窗口，请恢复要观察的窗口后重试');}catch(e){issue(e);}finally{this.disabled=false;}};
    function target(){if(mobileApiOnly()){$('vsStart').textContent='开始手机识屏陪伴';return;}var shared=$('vsTarget').value!=='browser',native=['screen','window'].includes($('vsTarget').value);$('vsAudio').disabled=native;$('vsAudio').parentElement.hidden=native;$('vsAudio').parentElement.style.display=native?'none':'';if($('vsProbe'))$('vsProbe').hidden=!native;if($('vsWindowField')){$('vsWindowField').hidden=$('vsTarget').value!=='window';$('vsWindowField').style.display=$('vsTarget').value==='window'?'':'none';}$('vsUrlField').hidden=shared;$('vsUrlField').style.display=shared?'none':'';$('vsControlField').hidden=shared||$('vsMode').value!=='game';$('vsControlField').style.display=shared||$('vsMode').value!=='game'?'none':'';$('vsControl').disabled=shared||$('vsMode').value!=='game';$('vsStart').textContent=$('vsTarget').value==='shared'?'选择画面并开始':shared?'开始原生识屏':'通过链接开始';} $('vsTarget').onchange=target;$('vsMode').onchange=target;target();status();visualPanelTimer=setInterval(function(){if(!$('vsResult')){clearInterval(visualPanelTimer);visualPanelTimer=null;return;}status();},5000);
  }
  function agencyMarkup(){
    var a=featureData?.agency||{},c=data.settings.agency||a.config||{},i=featureData?.imageInput||{},activity=(featureData?.deviceActivity||[]).slice(-6).reverse();
    function toggle(id,label,value){return '<label class="check-field"><input id="'+id+'" type="checkbox"'+(value!==false?' checked':'')+'>'+label+'</label>';}
    var browserEngines=(a.browser?.engines||[{id:'edge',name:'Microsoft Edge',available:a.browser?.available===true}]).filter(function(e){return e.available;});
    var browserChoice=mobileApiOnly()||!browserEngines.length?'':('<label class="field">浏览器引擎<select id="agBrowserEngine">'+browserEngines.map(function(e){return '<option value="'+esc(e.id)+'"'+((c.browserEngine||'edge')===e.id?' selected':'')+'>'+esc(e.name)+'</option>';}).join('')+'</select><small class="muted">仅提供 DSH 内置浏览器与 Edge；只列出当前可运行的引擎。内置运行环境缺失时可选择 Edge，不再尝试 Chrome 或 Firefox。更改后点击保存生效。</small></label>');

    var out='<div class="card"><div class="section-heading"><h2>自主操作设备</h2><span class="tag">'+(a.registered?'DSH 工具已接入':'工具待加载')+'</span></div><p class="muted">由她结合当前想法选择工具，观察、操作，再核对实际反馈。可以进入网页具体内容、播放、截图、滚动和看评论；手机调用 DSH Go 原生手机工具，电脑使用浏览器或桌面工具。日程和网页标题不会被当成已经执行或看过的证据。</p><div class="form-two">'+toggle('agEnabled','允许号主使用设备工具',c.enabled)+toggle('agAutonomous','允许自主轮次浏览和操作',c.autonomous)+toggle('agBrowser','允许操作真实浏览器',c.browser)+(mobileApiOnly()?'':toggle('agDesktop','允许观察和操作电脑',c.desktop))+toggle('agPhone',mobileApiOnly()?'允许使用手机原生工具':'允许操作已配对手机（数据线）',c.phone)+(mobileApiOnly()?'':toggle('agBackground','能在后台完成就优先后台操作',c.preferBackground!==false))+'</div><p class="muted">'+(mobileApiOnly()?'手机端使用 DSH Go 原生工具操作本机浏览器与应用。':a.browser?.available?'浏览器已就绪，可在后台运行。':'尚未发现可用浏览器，请检查 Edge 路径或 DSH 浏览器环境。')+' 系统要求的无障碍或截图授权仍以设备显示的状态为准。</p><label class="field">默认运行环境<select id="agWorkspace"><option value="internal"'+(c.workspace!=='desktop'?' selected':'')+'>内部独立窗口（不占桌面）</option><option value="desktop"'+(c.workspace==='desktop'?' selected':'')+'>桌面应用</option></select><small class="muted">单次明确要求可临时使用桌面；后台优先开启时，浏览器仍默认隐藏运行；需要桌面交互或本人要求展示时才显示。</small></label>'+browserChoice+(mobileApiOnly()?'':'<label class="field">Edge 程序路径<input id="agBrowserExecutable" value="'+esc(c.browserExecutable||'')+'" placeholder="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"><small class="muted">填写 .exe 完整路径，不是网址。仅接受 msedge.exe；留空只检测 Edge 的标准安装位置。DSH 引擎不使用此路径。API 与本地模型共用。更换路径后，下次浏览会重开插件自己的浏览器会话并保留登录资料，不退出你手动打开的浏览器。</small></label>')+'<button id="agSave" class="primary">保存浏览器与设备设置</button><h3>最近实际操作</h3>';
    out+=activity.length?activity.map(function(v){return '<p class="muted">'+esc(new Date(v.at).toLocaleString()+' · '+v.name+' / '+v.action+' · '+(v.ok?'返回了实际结果':'未完成'))+'</p>';}).join(''):'<p class="muted">还没有操作记录。可在号主私聊里让她打开网页或按自己的兴趣浏览。</p>';
    out+='<h3>QQ 来图</h3><p class="muted">本次运行已读 '+Number(i.received||0)+' 张，失败 '+Number(i.failed||0)+' 张；支持从 QQ 图片标识重新取得原图。</p>'+(i.lastError?'<p class="err">'+esc(i.lastError)+'</p>':'');
    return visualPanelMarkup()+out+'</div>';
  }
  function phoneMarkup(){
    var status=featureData?.phone?.status||{},tools=status.nativeTools||[],mobile=mobileApiOnly();
    if(!mobile&&!status.connected)return agencyMarkup()+'<div class="card"><h2>已配对手机</h2><p class="muted">电脑可通过数据线操作已配对的 DSH Go 手机。当前未连接。</p><button data-go="devices">查看连接与同步</button></div>';
    return agencyMarkup()+`<div class="card">
      <h2>手机操作 · DSH Go</h2>
      <p class="muted">${esc(status.inputNote||'在 DSH Go 开启手机操控后，可在这里检查原生能力。')}</p>
      <div class="btnrow"><button id="phStatus">检查本机能力</button><button id="phObserve"${status.connected?'':' hidden'}>读取 DSH Go 操作画面</button>${mobile?'<button id="phObserveShared">读取陪伴共享画面</button>':''}</div>
      <p id="phResult" role="status"></p>
      ${mobile?'<img id="phPreview" alt="组件实际共享的手机画面" hidden style="max-width:100%;max-height:380px;border-radius:12px">':''}
      <p class="muted">${tools.length?tools.map(t=>esc(t.name)).join(' · '):'原生能力尚未加载'}</p>
    </div>`;
  }

  function viewMediaSharing(config,ledger){
    var s=config.shareMedia||{},counts=ledger.counts||{};
    function toggle(id,label,checked){return '<div class="row"><label for="'+id+'" style="margin:0">'+label+'</label><input class="sharing-switch" role="switch" type="checkbox" id="'+id+'"'+(checked?' checked':'')+'></div>';}
    var out='<div class="card"><h2>语音与图片发送</h2><p class="muted">控制她能否发语音和图片，以及主动搭话时是否分享声音或画面。早中晚每个时段对同一个人最多主动分享一次日程场景；不会把离线活动补发成刷屏。主动搭话和定时分享需开启上方自主模式；聊天里的直接回复由她按语境判断。只对白名单私聊分享，遵守日程睡眠、联系人设置和暂停要求。</p>'+(featureData?.mediaSharingRevision==='20261026-sharing-v2'?'':'<div class="banner">新分享功能需要完整退出并重新打开DSH后生效。</div>')+toggle('shEnabled','开启主动媒体分享',s.enabled)+toggle('shVoice','允许主动语音',s.voice!==false)+toggle('shImages','允许主动图片',s.images!==false)+toggle('shDuring','聊天中自然选择语音或图片',s.duringChat!==false)+toggle('shIdle','空闲时主动分享（使用现有自主调度）',s.idle!==false)+toggle('shSchedule','结合早中晚日程主动分享',s.schedule!==false)+'<button class="primary" id="shSave">保存分享设置</button><p class="muted">开放模式下允许按内容选择媒体；实际发送仍遵守日程作息和明确暂停。自然表达也能点播：“想看看你在干嘛”会发图片，“想听你说晚安”会发语音；明确点播不占主动分享次数。语音沿用语音页的音色与总开关；图片沿用生图工作流、设定图和动态造型。调用已有计费接口可能产生费用。当前账号今天：语音 '+Number(counts.voice||0)+'，图片 '+Number(counts.image||0)+'。</p>';
    out+='<details><summary>试一句话，看她的表达判断</summary><p class="muted">让模型结合最近对话判断这一轮更适合文字、语音、图片还是组合。只预览，不发 QQ 消息，也不生成图片或语音。</p><label class="field">参考对话<select id="shTestContext">'+featureOptions('')+'</select></label><label class="field">你想说的话<input id="shTestText" placeholder="例如：好呀，我喜欢听你的声音 / 今天穿什么"></label><button id="shTest">看她的判断</button><p id="shTestResult" role="status" class="muted"></p></details>';
    out+=(ledger.log||[]).slice(-5).reverse().map(function(item){return '<div class="row"><span>'+esc((item.kind==='image'?'图片':'语音')+' · '+new Date(item.at).toLocaleTimeString())+'</span><span class="muted">'+esc(({generating:'生成中',queued:'已进入发送队列',failed:'生成失败',cancelled:'已停止'}[item.status]||item.status)+(item.error?' · '+item.error:''))+'</span></div>';}).join('');return out+'</div>';
  }

  var renderedRhWorkflow = '';
  function rhParseExtraNodes(value) {
    var text=String(value||'').trim();if(!text)return [];
    var nodes;
    if(text[0]==='['){try{nodes=JSON.parse(text);}catch{throw Error('额外节点 JSON 格式不完整，请检查引号和逗号');}}
    else {
      nodes=[];
      text.split(/\r?\n/).forEach(function(line){
        var match=line.match(/^\s*([-\w:.]+)\s*,\s*([-\w:.]+)\s*,(.*)$/);
        if(match)nodes.push({nodeId:match[1],fieldName:match[2],fieldValue:match[3]});
        else if(nodes.length)nodes[nodes.length-1].fieldValue+='\n'+line;
        else throw Error('额外节点请使用 JSON 数组，或 nodeId,fieldName,fieldValue 格式');
      });
    }
    if(!Array.isArray(nodes)||nodes.length>64||nodes.some(function(n){return !n||!/^[-\w:.]{1,100}$/.test(String(n.nodeId||''))||!/^[-\w:.]{1,100}$/.test(String(n.fieldName||''))||!['string','number','boolean'].includes(typeof n.fieldValue);}))throw Error('额外节点需要包含有效的 nodeId、fieldName 和文字、数字或布尔值 fieldValue');
    return nodes.map(function(n){return{nodeId:String(n.nodeId),fieldName:String(n.fieldName),fieldValue:n.fieldValue};});
  }
  function recommendedQwenWorkflow(){
    var prompt={nodeId:'489',fieldName:'value'};
    var images=[{nodeId:'470',fieldName:'image',label:'image1 · 参考图 1',nodeName:'LoadImage',type:'IMAGE',value:'',required:true,options:[]},{nodeId:'475',fieldName:'image',label:'image2 · 参考图 2',nodeName:'LoadImage',type:'IMAGE',value:'',required:true,options:[]}];
    return {id:'recommended-qwen21',name:'Qwen2.1 图像编辑 · 作者同款',note:'作者同款图生图应用；先准备参考图，再描述想怎样修改。',promptLanguage:'en',promptModel:'auto',fixedPromptMode:'refine',style:'auto',referenceMode:'auto',referenceTarget:null,referenceReuseMissing:false,mode:'app',workflowId:'',webappId:'2102644452430008321',autoDetect:true,promptTargets:[prompt],negativeTargets:[],promptNodeId:'',promptField:'text',instanceType:'default',usePersonalQueue:'false',extraNodes:[{nodeId:'13',fieldName:'megapixels',fieldValue:'2'},{nodeId:'480',fieldName:'batch_size',fieldValue:'1'},{nodeId:'13',fieldName:'aspect_ratio',fieldValue:'9:16 (Portrait Widescreen)'}],discovery:{version:1,source:'metadata',targetId:'2102644452430008321',mode:'app',title:'Qwen2.1图像编辑应用',status:'ready',message:'作者推荐的 Qwen2.1 预设；来自已核对的配置，未替你运行测试。应用更新后可重新读取参数。',promptTargets:[prompt],negativeTargets:[],prefixTargets:[],fields:images.concat([{nodeId:'489',fieldName:'value',label:'画面修改描述',nodeName:'PrimitiveStringMultiline',type:'STRING',value:'',required:false,options:[]}]),requiredFields:images,choices:[{nodeId:'489',fieldName:'value',label:'画面修改描述',targets:[prompt]}]}};
  }
  function useRecommendedQwenWorkflow(){
    if(!data)throw Error('设置还在加载，请稍后再试。');
    if($('rhKey'))rhCapture();
    var current=imagegenDraft||data.settings.imagegen||{},rh=rhLibrary(current.runninghub),entry=rh.workflows.find(function(w){return w.mode==='app'&&w.webappId==='2102644452430008321';});
    if(!entry){if(rh.workflows.length>=40)throw Error('配置库已满，请先整理一条配置再载入。');entry=rhEntry(recommendedQwenWorkflow(),rh.workflows.length);rh.workflows.push(entry);}
    rh.activeWorkflowId=entry.id;rh.manualSelectionRequired=false;imagegenDraft=Object.assign({},current,{provider:'runninghub',runninghub:rhLibrary(rh)});
    if(tab==='imagegen')renderPane();
    toast('已载入 Qwen2.1，尚未保存；填密钥和参考图后点“保存配置库”。');
  }
  function rhEntry(value, index) {
    var r=value||{};return Object.assign({},r,{id:r.id||('workflow-'+index),name:r.name||('工作流 '+(index+1)),note:r.note||'',style:r.style||'auto',referenceMode:r.referenceMode==='off'?'off':'auto',referenceTarget:r.referenceTarget||null,referenceReuseMissing:false,mode:r.mode==='app'?'app':r.mode==='workflow'?'workflow':r.mode==='auto'||!r.promptNodeId?'auto':'workflow',workflowId:r.workflowId||'',webappId:r.webappId||'',promptNodeId:r.promptNodeId||'',promptField:r.promptField||'text',instanceType:r.instanceType||'lite',usePersonalQueue:r.usePersonalQueue===true||r.usePersonalQueue==='true'?'true':'false',extraNodes:Array.isArray(r.extraNodes)?r.extraNodes:[],autoDetect:r.autoDetect!==undefined?r.autoDetect:!r.promptNodeId});
  }
  function rhLibrary(value) {
    var rh=Object.assign({},value||{});var list=Array.isArray(rh.workflows)?rh.workflows.map(rhEntry):((rh.workflowId||rh.webappId||rh.promptNodeId)?[rhEntry(Object.assign({},rh,{id:'legacy',name:'原有配置'}),0)]:[]);
    var selected=list.find(function(entry){return entry.id===rh.activeWorkflowId;})||(!rh.manualSelectionRequired&&!rh.activeWorkflowId&&list.length===1?list[0]:null);
    return Object.assign(rh,selected||{name:'',note:'',style:'auto',referenceMode:'auto',referenceTarget:null,mode:'auto',workflowId:'',webappId:'',promptNodeId:'',promptField:'text',instanceType:'lite',extraNodes:[],usePersonalQueue:'false',discovery:null,promptTargets:[],negativeTargets:[],autoDetect:true},{workflows:list,activeWorkflowId:selected?selected.id:''});
  }
  function rhCapture() {
    var current=imagegenDraft||data.settings.imagegen||{};var rh=rhLibrary(current.runninghub);
    var previous=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});var oldTarget=previous&&(previous.mode==='app'?previous.webappId:previous.workflowId);var oldMode=previous?.mode;
    if($('rhKey')) imagegenTypedKeys.runninghub=$('rhKey').value;
    if($('rhId')&&!rh.activeWorkflowId&&$('rhId').value.trim()){var fresh=rhEntry({id:'workflow-'+Date.now().toString(36),name:$('rhName').value.trim()||'工作流 1'},0);rh.workflows.push(fresh);rh.activeWorkflowId=fresh.id;}
    if($('rhId')&&rh.activeWorkflowId){var item=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(item)Object.assign(item,{
      style:item.style||'auto',referenceReuseMissing:false,referenceMode:$('rhReference')?.value==='off'?'off':'auto',referenceTarget:$('rhReference')?.value&&!['off','auto'].includes($('rhReference').value)?{nodeId:$('rhReference').value.split(':')[0],fieldName:$('rhReference').value.split(':').slice(1).join(':')}:null,
      promptLanguage:$('rhPromptLanguage')?.value||'',promptModel:$('rhPromptModel')?.value||'auto',fixedPromptMode:$('rhFixedMode')?.value||'refine',triggerWords:$('rhTriggers')?.value||'',
      name:$('rhName').value.trim()||'未命名工作流',note:$('rhNote').value.trim(),mode:$('rhMode').value,
      workflowId:$('rhMode').value!=='app'?$('rhId').value.trim():'',webappId:$('rhMode').value==='app'?$('rhId').value.trim():'',
      autoDetect:$('rhAuto')?$('rhAuto').checked:!!item.autoDetect,promptNodeId:$('rhNode').value.trim(),promptField:$('rhField').value.trim()||'text',instanceType:$('rhInstance').value,usePersonalQueue:$('rhQueue')?.checked?'true':'false',
      extraNodes:rhParseExtraNodes($('rhExtra').value)
    });}
    var changed=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(changed&&(oldTarget!==(changed.mode==='app'?changed.webappId:changed.workflowId)||oldMode!==changed.mode)){changed.discovery=null;changed.referenceTarget=null;changed.promptTargets=[];changed.negativeTargets=[];changed.promptNodeId='';changed.autoDetect=true;}
    rh=studioCaptureInputs(rh);imagegenDraft=Object.assign({},current,{runninghub:rh});if($('igDir'))imagegenDraft.saveDir=$('igDir').value.trim();if($('igPromptLanguage'))imagegenDraft.promptLanguage=$('igPromptLanguage').value==='zh'?'zh':'en';return rh;
  }
  function rhLibraryMarkup(rh) {
    return '<div class="card" style="margin:8px 0;background:var(--bg)"><h3>工作流配置库</h3><p class="muted">可以保存多条工作流供以后更换，但每次生图只用下方手动选中的当前工作流。新建的是本地配置；请先在 RunningHub 建好对应工作流。编辑后点击“保存配置库”。</p><label class="field">当前图片工作流<select id="rhChoice"><option value=""'+(!rh.activeWorkflowId?' selected':'')+'>尚未选择</option>'+rh.workflows.map(function(w){return '<option value="'+esc(w.id)+'"'+(rh.activeWorkflowId===w.id?' selected':'')+'>'+esc(w.name)+'</option>';}).join('')+'</select></label><div class="btnrow"><button id="rhSave" class="primary">保存配置库</button><button id="rhRecommended">载入作者同款 Qwen2.1</button><button id="rhAdd">新建配置</button><button id="rhCopy"'+(!rh.activeWorkflowId?' disabled':'')+'>复制当前配置</button><button id="rhDelete" class="danger"'+(!rh.activeWorkflowId?' disabled':'')+'>删除当前配置</button></div><label class="field">名称<input id="rhName" maxlength="80" value="'+esc(rh.name||'')+'" placeholder="例如：日常自拍、水彩风景"></label>'+rhTriggerMarkup(rh)+'<label class="field">备注<textarea id="rhNote" maxlength="500" style="min-height:70px" placeholder="例如：需要人设参考图，适合角色自拍">'+esc(rh.note||'')+'</textarea></label>'+rhRoutingMarkup(rh)+rhModelMarkup(rh)+'<p class="muted">名称和备注仅供你识别配置，不用于聊天时自动选择。更换后请保存；缺少所需输入时会明确报错，不会偷换别的工作流。</p></div>';
  }
  function bindWorkflowLibrary() {
    if($('rhSave'))$('rhSave').onclick=function(){return saveImagegenWithFeedback('工作流配置库已保存');};
    if($('rhRecommended'))$('rhRecommended').onclick=function(){try{useRecommendedQwenWorkflow();}catch(e){toast(e.message);}};
    if($('rhChoice'))$('rhChoice').onchange=function(){var selected=this.value;rhCapture();var rh=imagegenDraft.runninghub;rh.activeWorkflowId=selected;rh.manualSelectionRequired=!selected;imagegenDraft.runninghub=rhLibrary(rh);renderPane();};
    if($('rhAdd'))$('rhAdd').onclick=function(){var rh=rhCapture();if(rh.workflows.length>=40)return toast('最多保存 40 条工作流配置');var id='workflow-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);rh.workflows.push(rhEntry({id:id,name:'工作流 '+(rh.workflows.length+1)},rh.workflows.length));rh.activeWorkflowId=id;rh.manualSelectionRequired=false;imagegenDraft.runninghub=rhLibrary(rh);renderPane();};
    if($('rhCopy'))$('rhCopy').onclick=function(){var rh=rhCapture();var old=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(!old)return;if(rh.workflows.length>=40)return toast('最多保存 40 条工作流配置');var copy=JSON.parse(JSON.stringify(old));copy.id='workflow-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);copy.name=(old.name+' 副本').slice(0,80);rh.workflows.push(copy);rh.activeWorkflowId=copy.id;rh.manualSelectionRequired=false;imagegenDraft.runninghub=rhLibrary(rh);renderPane();};
    if($('rhDelete'))$('rhDelete').onclick=async function(){var rh=rhCapture();if(!await askConfirm('删除当前工作流配置？保留 RunningHub 上的工作流与共用 API Key。删除后请重新选择当前工作流。'))return;rh.workflows=rh.workflows.filter(function(w){return w.id!==rh.activeWorkflowId;});rh.activeWorkflowId='';rh.manualSelectionRequired=true;imagegenDraft.runninghub=rhLibrary(rh);renderPane();};
  }

  var studioBalanceByProvider = {};
  var studioBalancePending = {};
  var studioPreview = null;
  var studioInspectSerial = 0;
  var studioInspectTimer = null;
  var studioBusy = false;
  var studioPolishing = false;
  var studioSaving = false;
  var studioResult = null;
  var studioBalanceSerial = {};
  var studioUploads=0;
  var operationPanelChat='';
  function operationPanelContext(){var keys=featureChats();if(!keys.includes(operationPanelChat)){var owner=String((data.settings.owners||[])[0]||data.settings.owner||'');operationPanelChat=keys.includes('private:'+owner)?'private:'+owner:keys[0]||'';}return operationPanelChat;}
  function operationContextMarkup(id){return '<label class="field">参考哪段对话（最近8条双方消息）<select id="'+id+'">'+featureOptions(operationPanelContext())+'</select></label><p class="muted">执行前结合这段对话的意图、指代和情绪；不足8条使用已有消息，当前要求和手动语气优先。</p>';}

  function studioSelectedWorkflow(){return ((imagegenDraft||data.settings.imagegen||{}).provider==='runninghub')?studioActiveEntry()?.id||'':'';}
  function studioResultMarkup() { return '<div id="igOut" class="muted" style="margin-top:10px;white-space:pre-wrap">'+esc(studioBusy?'正在润色提示词并生成图片…':studioResult?.text||'')+'</div><div id="igPreview" style="margin-top:10px">'+(studioResult?.name?'<img src="/im-bridge/gen/file?name='+encodeURIComponent(studioResult.name)+'" style="max-width:100%;border-radius:12px;border:1px solid var(--line)">':'')+'</div>'; }
  function studioFieldKey(field) { return field.nodeId+':'+field.fieldName; }
  function studioRequiredMarkup(field,rh) {
    var existing=(rh.extraNodes||[]).find(function(n){return studioFieldKey(n)===studioFieldKey(field);});
    if(/^(IMAGE|AUDIO|VIDEO)$/.test(field.type))return '<label class="field">'+esc(field.label)+'<input type="file" data-studio-upload="'+esc(studioFieldKey(field))+'" data-media-type="'+esc(field.type.toLowerCase())+'" accept="'+({IMAGE:'image/png,image/jpeg,image/webp',AUDIO:'audio/*',VIDEO:'video/*'}[field.type])+'"><small class="muted">'+(existing?.fieldValue?'已上传，可直接生成或选择替换':'角色自拍可由人设图自动填入对应图片节点；其余用途请上传（最多 16MB）')+'</small>'+(existing?.fieldValue?'<button type="button" class="small" data-studio-clear="'+esc(studioFieldKey(field))+'">移除此图 / 素材</button>':'')+'</label>';
    var detail=rh.discovery?.fields?.find(function(f){return studioFieldKey(f)===studioFieldKey(field);})||field;var value=existing?existing.fieldValue:detail.value;
    return '<label class="field">'+esc(field.label)+(detail.options?.length?'<select data-studio-param="'+esc(studioFieldKey(field))+'" data-value-type="'+esc(field.type)+'">'+detail.options.map(function(o){return '<option value="'+esc(o.value)+'"'+(String(value)===String(o.value)?' selected':'')+'>'+esc(o.label)+'</option>';}).join('')+'</select>':'<input data-studio-param="'+esc(studioFieldKey(field))+'" data-value-type="'+esc(field.type)+'" type="'+(field.type==='NUMBER'?'number':'text')+'" value="'+esc(value)+'" placeholder="请补充这个必填参数">')+'</label>';
  }
  function studioActiveEntry() { var rh=rhLibrary((imagegenDraft||data.settings.imagegen||{}).runninghub);return rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;}); }
  function studioInvalidate() { studioPreview=null; if($('igEnglish'))$('igEnglish').value='';if($('igNegative')){$('igNegative').value='';$('igNegative').disabled=false;}if($('igFixedFields'))$('igFixedFields').innerHTML='';if($('igModelInfo'))$('igModelInfo').textContent='润色后显示实际模型策略及识别依据'; }
  function studioInspectionMarkup(rh) {
    var info=rh.discovery;
    var out='<label class="field">RunningHub 请求示例<textarea id="rhExample" spellcheck="false" style="min-height:180px;font-family:monospace" placeholder="粘贴完整 curl 请求示例，包含地址和 nodeInfoList"></textarea></label><div class="btnrow"><button class="primary" id="rhExampleInspect">自动识别请求示例</button><span id="rhInspectStatus" class="muted">'+esc(info?.message||'粘贴官方请求示例，自动填写 ID、提示词和参数')+'</span></div><p class="muted">只解析示例，不执行命令、不启动生图；API Key 请在上方单独填写。识别完成后点击“保存配置库”。</p>';
    if(info?.choices?.length>1||info?.status==='choose-prompt')out+='<label class="field">选择画面描述输入位置<select id="rhPromptChoice"><option value="">请选择</option>'+info.choices.map(function(choice){var selected=(rh.promptTargets||[]).some(function(t){return t.nodeId===choice.nodeId;});return '<option value="'+esc(choice.nodeId)+'"'+(selected?' selected':'')+'>'+esc(choice.label)+'</option>';}).join('')+'</select></label>';
    if(info?.requiredFields?.length)out+='<div class="card" style="margin:0;background:var(--bg)"><h3>需要的素材与参数</h3>'+info.requiredFields.map(function(field){return studioRequiredMarkup(field,rh);}).join('')+'</div>';
    var reserved=[].concat(info?.promptTargets||[],info?.negativeTargets||[],info?.prefixTargets||[]);
    var controls=(info?.fields||[]).filter(function(field){var label=String(field.label||'')+' '+String(field.nodeName||'');var sizeish=/size|width|height|seed|steps|cfg|scale|ratio|model|batch|length|duration|画幅|尺寸|比例|像素|分辨率/i.test(String(field.fieldName||'')+' '+label);return !field.required&&!reserved.some(function(t){return studioFieldKey(t)===studioFieldKey(field);})&&(info?.source==='request-example'||sizeish);}).slice(0,30);
    if(info?.prefixTargets?.length)out+='<details><summary>固定正向词原稿（按上方策略精修或原样保留）</summary>'+info.prefixTargets.map(function(target){var field=info.fields.find(function(f){return studioFieldKey(f)===studioFieldKey(target);});var extra=(rh.extraNodes||[]).find(function(f){return studioFieldKey(f)===studioFieldKey(target);});return '<label class="field">'+esc(field?.label||target.fieldName)+'<textarea data-studio-param="'+esc(studioFieldKey(target))+'">'+esc(extra?extra.fieldValue:field?.value||'')+'</textarea></label>';}).join('')+'</details>';
    if(controls.length)out+='<details open><summary>尺寸与其他参数（保留请求示例或应用默认值）</summary>'+controls.map(function(field){var extra=(rh.extraNodes||[]).find(function(n){return studioFieldKey(n)===studioFieldKey(field);});var val=extra?extra.fieldValue:field.value;return '<label class="field">'+esc(field.label)+(field.options?.length?'<select data-studio-param="'+esc(studioFieldKey(field))+'" data-value-type="'+esc(field.type)+'">'+field.options.map(function(option){return '<option value="'+esc(option.value)+'"'+(String(val)===String(option.value)?' selected':'')+'>'+esc(option.label)+'</option>';}).join('')+'</select>':'<input data-studio-param="'+esc(studioFieldKey(field))+'" data-value-type="'+esc(field.type)+'" type="'+(field.type==='NUMBER'?'number':'text')+'" value="'+esc(val)+'">')+'</label>';}).join('')+'</details>';
    out+='<p class="muted" id="studioParamStatus" role="status">画幅与尺寸修改会自动保存，面板和聊天生图都会使用当前手动选中的工作流。图生图工作流会先把人设参考图补边到所选画幅，再提交。生成结果会显示实际像素尺寸。</p>';
    return out;
  }
  var studioParamTimer=null,studioParamSaving=false;
  function studioParamValue(input,field){
    var value=input.value;
    if(input.getAttribute('data-value-type')==='NUMBER'&&typeof field?.value==='number'&&String(value).trim()!==''&&Number.isFinite(Number(value)))return Number(value);
    if(field?.type==='BOOLEAN'&&typeof field?.value==='boolean')return value==='true';
    return value;
  }
  function studioApplyParam(input,rh){
    var key=input.getAttribute('data-studio-param');if(!key)return null;
    var entry=rh?.workflows?.find(function(w){return w.id===rh.activeWorkflowId;});if(!entry)return null;
    var field=entry.discovery?.fields?.find(function(f){return studioFieldKey(f)===key;});
    var parts=key.split(':');var item={nodeId:parts[0],fieldName:parts.slice(1).join(':'),fieldValue:studioParamValue(input,field)};
    entry.extraNodes=(entry.extraNodes||[]).filter(function(n){return studioFieldKey(n)!==studioFieldKey(item);});entry.extraNodes.push(item);
    return item;
  }
  function studioSetParamStatus(text){if($('studioParamStatus'))$('studioParamStatus').textContent=text;}
  function studioPersistParams(){
    clearTimeout(studioParamTimer);studioParamTimer=setTimeout(async function(){
      if(studioSaving||studioBusy||studioPolishing||studioUploads||studioParamSaving)return;
      var rh;try{rh=rhCapture();}catch(error){studioSetParamStatus('参数暂时无法保存：'+error.message);return;}
      try{studioParamSaving=true;studioSetParamStatus('正在自动保存画幅与参数…');
        await api('POST','/im-bridge/settings',{imagegen:{promptLanguage:$('igPromptLanguage')?.value==='zh'?'zh':'en',runninghub:{workflows:rh.workflows,activeWorkflowId:rh.activeWorkflowId}}});
        studioSetParamStatus('画幅与参数已自动保存，面板和聊天生图都会使用');
      }catch(error){studioSetParamStatus('自动保存失败：'+error.message+'；请点“保存”');}
      finally{studioParamSaving=false;}
    },350);
  }
  function studioCaptureInputs(rh) {
    var entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(!entry)return rh;
    Array.prototype.forEach.call(document.querySelectorAll('[data-studio-param]'),function(input){studioApplyParam(input,rh);});
    return rhLibrary(rh);
  }
  function bindStudioParams(){
    Array.prototype.forEach.call(document.querySelectorAll('[data-studio-param]'),function(input){
      var handler=function(){
        var current=imagegenDraft||data.settings.imagegen||{};
        var rh=rhLibrary(current.runninghub);
        if(!studioApplyParam(input,rh))return;
        imagegenDraft=Object.assign({},current,{runninghub:rhLibrary(rh)});
        studioSetParamStatus('画幅参数已修改，正在自动保存…');
        studioPersistParams();
      };
      if(input.tagName==='SELECT')input.onchange=handler;else input.oninput=handler;
    });
  }
  async function studioImportExample() {
    var input=$('rhExample');if(!input)return;var raw=input.value.trim();if(!raw)return toast('先粘贴 RunningHub 的 cURL 请求示例');
    if(raw.length>512*1024){toast('请求示例不要超过 512KB');return null;}
    var serial=++studioInspectSerial,entryId=renderedRhWorkflow;
    // Authorization is not needed for parsing. Remove quoted headers before the local request.
    var example=raw.replace(/(?:--header|-H)(?:=|\s+)(["'])Authorization:[^"'\r\n]*\1/gi,'');
    $('rhInspectStatus').textContent='正在识别请求示例…';$('rhExampleInspect').disabled=true;
    try{
      var info=await api('POST','/im-bridge/imagegen/example',{example:example});
      if(serial!==studioInspectSerial||!$('rhExample')||$('rhExample').value.trim()!==raw||renderedRhWorkflow!==entryId||$('igProvider')?.value!=='runninghub')return;
      $('rhId').value=info.targetId;$('rhMode').value=info.mode;
      var rh=rhCapture(),entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(!entry)throw Error('请先新建一条工作流配置');
      Object.assign(entry,{mode:info.mode,workflowId:info.mode==='workflow'?info.targetId:'',webappId:info.mode==='app'?info.targetId:'',discovery:info,autoDetect:true,promptTargets:info.promptTargets||[],negativeTargets:info.negativeTargets||[],promptNodeId:info.promptTargets?.[0]?.nodeId||'',promptField:info.promptTargets?.[0]?.fieldName||'text',extraNodes:[],instanceType:info.instanceType,usePersonalQueue:info.usePersonalQueue});
      imagegenDraft.runninghub=rhLibrary(rh);$('rhNode').value=entry.promptNodeId;$('rhField').value=entry.promptField;$('rhInstance').value=entry.instanceType;$('rhQueue').checked=entry.usePersonalQueue==='true';$('rhExtra').value='';$('rhExample').value='';
      // Imported fields replace the old parameter controls and their drafts as one unit.
      Object.keys(pageDrafts.imagegen||{}).forEach(function(key){if(key.endsWith('@'+entry.id)&&/^(studio:|rh(?:Node|Field|Mode|Id|Instance|Queue|Extra|Auto)@)/.test(key))delete pageDrafts.imagegen[key];});
      Array.prototype.forEach.call(document.querySelectorAll('[data-studio-param]'),function(control){control.removeAttribute('data-studio-param');});
      studioInvalidate();renderPane();toast('请求示例已识别，点击“保存配置库”即可保存');return info;
    }catch(error){if(serial===studioInspectSerial&&$('rhInspectStatus'))$('rhInspectStatus').textContent='识别失败：'+error.message;toast('识别失败：'+error.message);}
    finally{if($('rhExampleInspect'))$('rhExampleInspect').disabled=studioSaving||studioBusy||studioPolishing;}
  }

  async function studioInspect(force) {
    if(!$('rhId'))return null;var serial=++studioInspectSerial;
    if(studioInspectTimer){clearTimeout(studioInspectTimer);studioInspectTimer=null;}
    var typed=$('rhId').value.trim();if(!typed)return null;
    var mode=$('rhMode').value;var key=$('rhKey')?.value||imagegenTypedKeys.runninghub||'';
    var rh=rhCapture(),entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});var entryId=entry?.id;
    if($('rhInspectStatus'))$('rhInspectStatus').textContent='正在读取应用 / 工作流参数…';
    try{
      var info=await api('POST','/im-bridge/imagegen/inspect',{target:typed,mode:mode,apiKey:key,force:!!force});
      var current=studioActiveEntry();if(serial!==studioInspectSerial||!current||current.id!==entryId||!$('rhId')||$('rhId').value.trim()!==typed)return null;
      Object.assign(entry,{mode:info.mode,workflowId:info.mode==='workflow'?info.targetId:'',webappId:info.mode==='app'?info.targetId:'',discovery:info,autoDetect:true,promptTargets:info.promptTargets||[],negativeTargets:info.negativeTargets||[],promptNodeId:info.promptTargets?.[0]?.nodeId||'',promptField:info.promptTargets?.[0]?.fieldName||'text'});
      if(entry.name==='未命名工作流'||/^工作流 \d+$/.test(entry.name))entry.name=info.title||entry.name;
      imagegenDraft.runninghub=rhLibrary(rh);$('rhId').value=info.targetId;$('rhMode').value=info.mode;$('rhNode').value=entry.promptNodeId;$('rhField').value=entry.promptField;studioInvalidate();renderPane();return info;
    }catch(error){if(serial===studioInspectSerial&&$('rhInspectStatus'))$('rhInspectStatus').textContent='识别失败：'+error.message;throw error;}
  }
  async function studioEnsureSelection() {
    if(!$('rhId'))return;
    var rh=rhCapture();var entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(!entry)return;
    if(entry.autoDetect!==false&&(!entry.discovery||entry.discovery.targetId!==($('rhId').value.trim())||entry.discovery.mode!==entry.mode))await studioInspect(false);
  }
  async function studioReadBalance(force) {
    var provider=$('igProvider')?.value||'runninghub',at=Date.now();
    var state=studioBalanceByProvider[provider];if(!force&&state&&at-state.checkedAt<60000){studioPaintBalance(provider);return;}
    if(studioBalancePending[provider])return;
    var key=provider==='runninghub'?$('rhKey')?.value:$('igKey')?.value;studioBalancePending[provider]=true;var serial=studioBalanceSerial[provider]||0;
    if($('igBalance'))$('igBalance').textContent='正在查询余额…';
    try{var result=await api('POST','/im-bridge/imagegen/balance',{provider:provider,apiKey:key||'',force:!!force,billingSource:data?.settings?.wallet?.runninghubBillingSource||'auto'});if(serial!==(studioBalanceSerial[provider]||0))return;studioBalanceByProvider[provider]=Object.assign({},result,{checkedAt:at});studioPaintBalance(provider);}
    catch(error){if(serial!==(studioBalanceSerial[provider]||0))return;studioBalanceByProvider[provider]=Object.assign({},studioBalanceByProvider[provider],{status:'error',stale:!!studioBalanceByProvider[provider],reason:error.message,checkedAt:at});studioPaintBalance(provider);}
    finally{if(serial===(studioBalanceSerial[provider]||0))delete studioBalancePending[provider];}
  }
  function studioPaintBalance(provider) {
    var el=$('igBalance');if(!el||$('igProvider')?.value!==provider)return;var value=studioBalanceByProvider[provider];if(!value)return;
    if(value.status==='unsupported'){el.textContent=value.reason;return;}if(value.routed){el.textContent=value.provider+'：'+((value.entries||[]).map(function(e){return e.amount+' '+e.currency;}).join(' / ')||value.reason||'未知')+' · 更新于 '+new Date(value.updatedAt).toLocaleTimeString();return;}
    var parts=[];if(provider==='runninghub')parts.push(value.points!==undefined&&value.points!==null?'新版积分：'+value.points+' 积分':'新版积分：接口未返回（不代表 0）');if(value.money!==undefined&&value.money!==null)parts.push('API 钱包：'+value.money+' '+(value.currency||'（币种未提供）'));
    el.textContent=(parts.length?parts.join(' · ')+' · 更新于 '+new Date(value.updatedAt).toLocaleTimeString():'')+(value.status==='error'?(value.stale?'（上次记录）':'')+' 查询失败：'+value.reason:'');
    if(provider==='runninghub'&&value.status==='ok'&&!Object.prototype.hasOwnProperty.call(value,'points'))el.textContent+=' · 当前后端尚未读取新积分，请重载 QQ 桥接后刷新余额';
    if(value.status==='ok'&&value.reason)el.textContent+=' · '+value.reason;
    if(!el.textContent)el.textContent='接口未返回可显示余额';
  }
  function studioPromptMarkup() {
    return '<div class="card" style="margin:12px 0;background:var(--bg)"><h3>提示词</h3><p class="muted">输入中文即可。会按所选语言、按人物外貌 → 动作姿态 → 场景关系 → 镜头光线 → 画风分行写成自然语言，并处理当前角色、造型和光线；预览不会启动生图任务。</p><button id="igPolish">润色并预览</button><p class="muted" id="igModelInfo">'+esc(studioModelText(studioPreview?.modelProfile))+'</p><div id="igFixedFields">'+studioFixedMarkup(studioPreview)+'</div><label class="field">本次画面正向词（按所选语言分行输出）<textarea id="igEnglish" style="min-height:140px" placeholder="点击润色后可查看、修改">'+esc(studioPreview?.prompt||'')+'</textarea></label><label class="field">反向提示词<textarea id="igNegative" style="min-height:60px"'+(studioPreview?.modelProfile?.negativeSupported===false?' disabled':'')+'>'+esc(studioPreview?.negativePrompt||'')+'</textarea></label><p class="muted" id="igPolishInfo">'+esc(studioPreview?.summary||'生成时自动使用相同的模型适配与精修流程')+'</p></div>';
  }
  function studioModelText(profile){return profile?'模型策略：'+profile.label+' · '+({configured:'手动指定',metadata:'模型节点识别','name-hint':'根据名称推测（可在上方手动纠正）',unknown:'未确认，使用通用策略',ambiguous:'存在多个模型，使用通用策略'}[profile.source]||'未确认')+' · '+(profile.format==='hybrid'?'自然语言（固定前缀除外）':'自然语言')+' · '+(profile.language==='zh'?'中文提示词':'英语提示词')+(profile.negativeSupported===false?' · 本次不提交反向词':''):'润色后显示实际模型策略及识别依据';}
  function studioFixedMarkup(preview){return (preview?.fixedPrompts||[]).map(function(p){return '<label class="field">本次固定正向词 · '+esc(p.nodeId+':'+p.fieldName)+'<textarea data-studio-fixed="'+esc(p.nodeId+':'+p.fieldName)+'" style="min-height:90px">'+esc(p.prompt)+'</textarea></label>';}).join('');}
  function studioFixedValues(){return (studioPreview?.fixedPrompts||[]).map(function(p){var control=Array.from(document.querySelectorAll('[data-studio-fixed]')).find(function(el){return el.getAttribute('data-studio-fixed')===p.nodeId+':'+p.fieldName;});return Object.assign({},p,{prompt:control?control.value:p.prompt});});}
  function bindStudioFixed(){Array.prototype.forEach.call(document.querySelectorAll('[data-studio-fixed]'),function(input){input.oninput=function(){if(studioPreview)studioPreview.fixedPrompts=studioFixedValues();};});}
  function bindImageStudio() {
    if(!$('igProvider'))return;
    bindStudioFixed();
    bindStudioParams();
    ['igPolish','igTest','igSave','rhSave','rhExampleInspect'].forEach(function(id){if($(id))$(id).disabled=studioBusy||studioPolishing||studioSaving||studioUploads>0;});
    var providerChanged=$('igProvider').onchange;$('igProvider').onchange=function(){studioInspectSerial++;studioInvalidate();return providerChanged?.call(this);};
    if($('rhChoice')){var workflowChanged=$('rhChoice').onchange;$('rhChoice').onchange=function(){studioInspectSerial++;studioInvalidate();return workflowChanged?.call(this);};}
    if($('igPromptLanguage'))$('igPromptLanguage').onchange=function(){studioInvalidate();var current=imagegenDraft||data.settings.imagegen||{};imagegenDraft=Object.assign({},current,{promptLanguage:this.value==='zh'?'zh':'en'});studioSetParamStatus('提示词语言已修改，正在自动保存…');studioPersistParams();};
    [['rhKey','runninghub'],['igKey','siliconflow']].forEach(function(pair){if($(pair[0]))$(pair[0]).oninput=function(){studioBalanceSerial[pair[1]]=(studioBalanceSerial[pair[1]]||0)+1;delete studioBalancePending[pair[1]];delete studioBalanceByProvider[pair[1]];studioInvalidate();if($('igBalance'))$('igBalance').textContent='密钥已更改，请刷新余额';};});
    if($('igBalanceRefresh'))$('igBalanceRefresh').onclick=function(){return studioReadBalance(true);};
    void studioReadBalance(false);
    if($('rhExampleInspect'))$('rhExampleInspect').onclick=studioImportExample;
    if($('rhInspect'))$('rhInspect').onclick=async function(){this.disabled=true;try{await studioInspect(true);}catch(error){toast(error.message);}finally{if(this.isConnected)this.disabled=false;}};
    if($('rhId'))$('rhId').oninput=function(){studioInspectSerial++;studioInvalidate();};
    if($('rhMode'))$('rhMode').onchange=function(){studioInspectSerial++;studioInvalidate();};
    if($('rhPromptChoice'))$('rhPromptChoice').onchange=function(){var rh=rhCapture(),entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});var choice=entry?.discovery?.choices?.find(function(c){return c.nodeId===$('rhPromptChoice').value;});if(choice){entry.promptTargets=choice.targets;entry.promptNodeId=choice.targets[0].nodeId;entry.promptField=choice.targets[0].fieldName;imagegenDraft.runninghub=rhLibrary(rh);studioInvalidate();renderPane();}};
    Array.prototype.forEach.call(document.querySelectorAll('[data-studio-upload]'),function(input){input.onchange=async function(){
      var file=input.files[0];if(!file)return;if(file.size>16*1024*1024){toast('素材不要超过 16MB');return;}
      var field=input.getAttribute('data-studio-upload'),type=input.getAttribute('data-media-type'),entryId=studioActiveEntry()?.id;
      studioUploads++;input.disabled=true;['igPolish','igTest','igSave','rhSave'].forEach(function(id){if($(id))$(id).disabled=true;});
      studioInvalidate();
      try{
        var encoded=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.onerror=reader.onabort=function(){reject(Error('读取文件失败，请重新选择'));};reader.readAsDataURL(file);});
        var result=await api('POST','/im-bridge/imagegen/upload',{data:encoded,name:file.name,type:type,apiKey:imagegenTypedKeys.runninghub||''});
        if(studioActiveEntry()?.id!==entryId)return;
        var rh=rhCapture(),entry=rh.workflows.find(function(w){return w.id===entryId;});if(!entry)return;
        var parts=field.split(':');entry.extraNodes=entry.extraNodes.filter(function(n){return studioFieldKey(n)!==field;});entry.extraNodes.push({nodeId:parts[0],fieldName:parts.slice(1).join(':'),fieldValue:result.fileName});
        imagegenDraft.runninghub=rhLibrary(rh);studioInvalidate();renderPane();toast('素材已上传，保存配置后可生成');
      }catch(error){toast('上传失败：'+error.message);}finally{studioUploads--;if(input.isConnected)input.disabled=false;['igPolish','igTest','igSave','rhSave'].forEach(function(id){if($(id))$(id).disabled=studioUploads>0||studioBusy||studioPolishing||studioSaving;});}
    };});
    Array.prototype.forEach.call(document.querySelectorAll('[data-studio-clear]'),function(button){button.onclick=function(){var rh=rhCapture(),entry=rh.workflows.find(function(w){return w.id===rh.activeWorkflowId;});if(!entry)return;entry.extraNodes=entry.extraNodes.filter(function(n){return studioFieldKey(n)!==button.getAttribute('data-studio-clear');});imagegenDraft.runninghub=rhLibrary(rh);studioInvalidate();renderPane();};});
    ['rhReference','rhPromptModel','rhPromptLanguage','rhFixedMode'].forEach(function(id){if($(id))$(id).onchange=studioInvalidate;});
    if($('rhTriggers'))$('rhTriggers').oninput=studioInvalidate;
    if($('igContext'))$('igContext').onchange=function(){operationPanelChat=this.value;studioInvalidate();};
    if($('igTestPrompt'))$('igTestPrompt').oninput=studioInvalidate;
    if($('igPolish'))$('igPolish').onclick=async function(){var button=this;var prompt=$('igTestPrompt')?.value.trim();if(!prompt)return toast('先写想要的画面');if(studioBusy||studioPolishing||studioSaving||studioUploads)return;studioPolishing=true;button.disabled=true;try{await saveImagegenCurrent();var result=await api('POST','/im-bridge/imagegen/prompt',{prompt:prompt,workflow:studioSelectedWorkflow(),contextKey:operationPanelContext()});studioPreview={...result,summary:result.summary+studioRoutingText(result.routing),input:prompt};if($('igEnglish')){$('igEnglish').value=result.prompt;$('igNegative').value=result.negativePrompt;$('igNegative').disabled=result.modelProfile?.negativeSupported===false;$('igModelInfo').textContent=studioModelText(result.modelProfile);$('igFixedFields').innerHTML=studioFixedMarkup(studioPreview);bindStudioFixed();$('igPolishInfo').textContent=(result.summary||'提示词已准备好，可直接生成或修改后生成')+studioRoutingText(result.routing);}}catch(error){toast('润色失败：'+error.message);}finally{studioPolishing=false;['igPolish','igTest','igSave','rhSave','rhExampleInspect'].forEach(function(id){if($(id))$(id).disabled=studioBusy;});}};
  }
  async function saveImagegenWithFeedback(message) {
    if(studioSaving||studioBusy||studioPolishing||studioUploads)return;
    studioSaving=true;
    ['rhSave','igSave','igTest','igPolish','rhExampleInspect'].forEach(function(id){if($(id))$(id).disabled=true;});
    if($('rhSave'))$('rhSave').textContent='保存中…';
    try{await saveImagegenCurrent();toast(message||'已保存');}
    catch(error){toast('保存失败：'+error.message);}
    finally{studioSaving=false;['rhSave','igSave','igTest','igPolish','rhExampleInspect'].forEach(function(id){if($(id))$(id).disabled=studioBusy||studioPolishing;});if($('rhSave'))$('rhSave').textContent='保存配置库';}
  }
  async function saveImagegenCurrent() {
    if(studioUploads)throw Error('素材还在上传，请稍后再试');
    if(featureData?.imagePromptModelRevision!=='20261027-prompt-language-v2')throw Error('提示词语言与分行功能的后端尚未载入，请完整退出并重新打开 DSH 后再保存');
    var originalPrompt=$('igTestPrompt')?.value||'';
    if($('rhExample')?.value.trim()&&!await studioImportExample())throw Error('请求示例未识别，请检查后重试');
    if($('rhId'))await studioEnsureSelection();
    var provider=$('igProvider').value,patch={provider:provider,enabled:$('igEnabled')?.checked!==false,saveDir:$('igDir').value.trim(),promptLanguage:$('igPromptLanguage')?.value==='zh'?'zh':'en'};
    if(provider==='runninghub')patch.runninghub=Object.assign({},rhCapture(),{apiKey:$('rhKey').value.trim()});
    if(provider==='siliconflow')Object.assign(patch,{apiKey:$('igKey').value.trim(),model:$('igModel').value,size:$('igSize').value.trim()||'1024x1024',steps:Number($('igSteps').value)||20,cfg:Number($('igCfg').value)||7.5,seed:Number($('igSeed').value)||0});
    if(patch.apiKey||patch.runninghub?.apiKey)delete studioBalanceByProvider[provider];
    var savedWorkflowDrafts=Object.assign({},pageDrafts.imagegen||{});
    await api('POST','/im-bridge/settings',{imagegen:patch});
    Object.keys(savedWorkflowDrafts).forEach(function(key){if(/^(?:rh(?:Name|Note|Mode|Id|Node|Field|Instance|Extra|Style|Reference|PromptModel|FixedMode|Triggers|Queue|Auto)@|studio:)/.test(key)&&sameValue(pageDrafts.imagegen?.[key],savedWorkflowDrafts[key]))delete pageDrafts.imagegen[key];});
    imagegenDraft=null;imagegenTypedKeys={};await load();if($('igTestPrompt'))$('igTestPrompt').value=originalPrompt;
  }

  function studioExpectedRatio(){
    var entry=studioActiveEntry();if(!entry)return null;
    var pick=function(re){var extra=(entry.extraNodes||[]).find(function(n){return re.test(n.fieldName);});if(extra&&String(extra.fieldValue).trim()!=='')return String(extra.fieldValue);var field=(entry.discovery?.fields||[]).find(function(f){return re.test(f.fieldName);});return field&&String(field.value).trim()!==''?String(field.value):'';};
    var m=pick(/aspect|ratio|比例/i).match(/(\d+(?:\.\d+)?)\s*[:：\/x×]\s*(\d+(?:\.\d+)?)/);
    if(m)return {w:Number(m[1]),h:Number(m[2]),label:m[1]+':'+m[2]};
    var w=Number(pick(/^width$/i)),h=Number(pick(/^height$/i));
    return w>0&&h>0?{w:w,h:h,label:w+'×'+h}:null;
  }
  function studioSizeNote(size){
    if(!size||!size.width||!size.height)return '';
    var text=' · '+size.width+'×'+size.height,want=studioExpectedRatio();
    if(want&&want.w>0&&want.h>0){
      var expected=want.w/want.h,actual=size.width/size.height;
      if(Math.abs(expected-actual)/expected>0.04)text+='（画幅设置为 '+want.label+'，实际返回比例不同：这个工作流的画幅节点可能没有接到最终输出，或图生图沿用了输入图尺寸）';
    }
    return text;
  }

  var videoConnectionState=null,videoConnectionDraft=null;
  function viewVideogen(){
    var v=data.settings?.videogen||{}, rh=v.provider==='runninghub';
    return '<section class="card"><h2>视频 API</h2><label class="field">视频来源<select id="vgProvider"><option value="connection" '+(!rh?'selected':'')+'>兼容视频 API</option><option value="runninghub" '+(rh?'selected':'')+'>RunningHub · MiniMax H3</option></select></label><p id="vgRunningHub" class="muted" style="'+(rh?'':'display:none')+'">AI 应用 2085597941657587714，使用图像生成页的 RunningHub 密钥。角色出镜时使用该角色已保存的人设图。</p><div id="vgConnection" style="'+(rh?'display:none':'')+'"><label class="field">已保存连接<select id="vgProfile"><option value="">新建视频连接</option></select></label><div class="form-two"><label class="field">连接名称<input id="vgName" placeholder="我的视频 API"></label><label class="field">服务地址<input id="vgUrl" placeholder="https://example.com/v1"></label></div><label class="field">API 密钥<input id="vgKey" type="password" autocomplete="new-password" placeholder="编辑已保存连接时留空保留原密钥"></label><div class="btnrow"><button id="vgDetect" disabled title="正在读取连接列表">自动检测连接</button><button id="vgRetry">重新读取连接</button><button data-go="services">管理所有连接</button></div><p id="vgEvidence" class="muted" role="status"></p><datalist id="vgModels"></datalist><label class="field">视频模型<input id="vgModel" list="vgModels" placeholder="填写此接口支持的视频模型 ID"></label><details><summary>接口方式与路径</summary><label class="field">提交格式<select id="vgMode"><option value="multipart">兼容 /videos：表单上传参考图</option><option value="json">相同字段的 JSON：参考图用 data URI</option></select></label><p class="muted">不同服务的视频接口并不统一。只有字段与任务回执兼容时才能使用；不能仅凭密钥推断所有网站的协议。参考图通过 input_reference 真实传入，不会静默丢弃。JSON 方式需服务商明确支持。</p><label class="field">提交路径<input id="vgCreatePath" placeholder="默认 videos，例如 /v1/videos"></label><label class="field">进度路径<input id="vgStatusPath" placeholder="默认 videos/{id}"></label><label class="field">下载路径<input id="vgContentPath" placeholder="默认 videos/{id}/content"></label></details></div></section><section class="card"><h2>画面与动作</h2><p class="muted">聊天可指定时长、画幅、动作、镜头、台词和声音。只在本次生成中应用。</p><div class="form-two"><label class="field">默认时长（秒）<input id="vgSeconds" type="number" min="0.1" step="any" value="'+esc(v.seconds||(rh?10:8))+'"></label><label id="vgSizeField" class="field" style="'+(rh?'display:none':'')+'">默认尺寸（宽x高）<input id="vgSize" value="'+esc(v.size||'720x1280')+'" placeholder="720x1280"></label><label id="vgRatioField" class="field" style="'+(rh?'':'display:none')+'">默认画幅<select id="vgRatio">'+['9:16','16:9','1:1','4:3','3:4','3:2','2:3'].map(function(ratio){return '<option '+(ratio===(v.aspectRatio||'9:16')?'selected':'')+'>'+ratio+'</option>';}).join('')+'</select></label></div><label class="field">默认画面动作（可选）<textarea id="vgAction" placeholder="例如：前2秒看向镜头，随后轻轻挥手">'+esc(v.action||'')+'</textarea></label><label class="field">默认镜头运动（可选）<input id="vgCamera" value="'+esc(v.cameraMotion||'')+'" placeholder="留空保持原有构图，自然跟随"></label><label class="check-field"><input type="checkbox" id="vgEnabled" '+(v.enabled?'checked':'')+'>开启视频 API</label><p class="muted">可在“连接与搭配”独立选择视频 API 或本地工作流，与聊天来源分开。在 QQ 里描述要拍的视频即可发起生成，结果走 QQ 发送队列。原任务中断可按任务编号继续查询，不重复生成。</p><div class="btnrow"><button id="vgSave" class="primary" disabled>保存视频配置</button><button data-go="delivery">QQ 发送回执</button></div><p id="vgResult" class="muted" role="status">正在读取连接…</p></section>';
  }
  function paintVideoProfile(p){
    videoConnectionDraft=Object.assign({},p||{type:'openai',paths:{}},{apiKey:''});p=videoConnectionDraft;
    [['vgName','name'],['vgUrl','baseUrl'],['vgModel','videoModel']].forEach(function(pair){$(pair[0]).value=p[pair[1]]||'';});$('vgKey').value='';$('vgMode').value=p.videoMode||'multipart';
    [['vgCreatePath','video'],['vgStatusPath','videoStatus'],['vgContentPath','videoContent']].forEach(function(pair){$(pair[0]).value=p.paths?.[pair[1]]||'';});
    $('vgModels').innerHTML=(p.models||[]).map(function(m){return '<option value="'+esc(m)+'"></option>';}).join('');$('vgEvidence').textContent=(p.evidence||[]).join('；')+(p.hasKey?'（密钥已保存）':'');
  }
  function captureVideoProfile(){return Object.assign({},videoConnectionDraft||{},{name:$('vgName').value.trim(),baseUrl:$('vgUrl').value.trim(),apiKey:$('vgKey').value.trim(),type:'openai',videoModel:$('vgModel').value.trim(),videoMode:$('vgMode').value,paths:Object.assign({},videoConnectionDraft?.paths||{},{video:$('vgCreatePath').value.trim(),videoStatus:$('vgStatusPath').value.trim(),videoContent:$('vgContentPath').value.trim()})});}
  async function bindVideogen(){
    if(!$('vgProfile'))return;var result=$('vgResult'),select=$('vgProfile'),retry=$('vgRetry'),detect=$('vgDetect');retry.onclick=function(){void bindVideogen();};retry.disabled=true;detect.disabled=true;$('vgSave').disabled=true;result.textContent='正在读取连接…';
    try{videoConnectionState=await api('GET','/im-bridge/service-connections');if($('vgProfile')!==select)return;var profiles=(videoConnectionState.profiles||[]).filter(function(p){return p.type==='openai';});$('vgProfile').innerHTML='<option value="">新建视频连接</option>'+profiles.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>';}).join('');$('vgProfile').value=data.settings?.videogen?.profileId||'';paintVideoProfile(profiles.find(function(p){return p.id===$('vgProfile').value;}));$('vgSave').disabled=false;result.textContent=data.settings?.videogen?.enabled?'已开启；配置保存后由聊天请求生成。':'尚未开启视频 API。';}catch(error){if(result.isConnected){result.textContent='连接读取失败：'+error.message+'；请点击“重新读取连接”。';detect.title='请先重新读取连接，成功后可检测服务。';$('vgSave').title='请先重新读取连接，避免覆盖尚未加载的配置。';}return;}finally{if(retry.isConnected)retry.disabled=false;applyPreviewControls();}
    $('vgProvider').onchange=function(){
      var rh=this.value==='runninghub',seconds=$('vgSeconds');
      $('vgConnection').style.display=rh?'none':'';
      $('vgRunningHub').style.display=rh?'':'none';
      $('vgSizeField').style.display=rh?'none':'';
      $('vgRatioField').style.display=rh?'':'none';
      seconds.min=rh?'10':'0.1';seconds.step=rh?'1':'any';seconds.max=rh?'15':'';
      if(rh&&(!Number.isInteger(Number(seconds.value))||Number(seconds.value)<10||Number(seconds.value)>15))seconds.value='10';
    };
    $('vgProvider').onchange();
    $('vgProfile').onchange=function(){paintVideoProfile((videoConnectionState.profiles||[]).find(function(p){return p.id===$('vgProfile').value;}));};
    $('vgDetect').onclick=async function(){var button=this,draft=captureVideoProfile();button.disabled=true;try{var r=await api('POST','/im-bridge/service-connections',Object.assign({},draft,{action:'detect'}));if(!$('vgEvidence'))return;var d=r.detection;if(['runninghub','comfyui','voicelab','anthropic','responses'].indexOf(d.type)>=0)throw Error('该服务不能按通用视频接口调用；RunningHub 请使用工作流。');videoConnectionDraft=Object.assign({},draft,d,{type:'openai'});paintVideoProfile(videoConnectionDraft);$('vgKey').value=draft.apiKey;$('vgEvidence').textContent=(d.evidence||[]).join('；')+'；视频生成能力尚未试运行。';}catch(error){if($('vgEvidence'))$('vgEvidence').textContent=error.message;}finally{button.disabled=false;}};
    $('vgSave').onclick=async function(){var button=this;button.disabled=true;try{var draft=captureVideoProfile(),config={enabled:$('vgEnabled').checked,provider:$('vgProvider').value,aspectRatio:$('vgRatio').value,profileId:draft.id||'',seconds:Number($('vgSeconds').value),size:$('vgSize').value.trim(),action:$('vgAction').value.trim(),cameraMotion:$('vgCamera').value.trim()};if(!Number.isFinite(config.seconds)||config.seconds<=0||!/^\d{2,5}x\d{2,5}$/.test(config.size))throw Error('请填写有效时长和宽x高尺寸');if(config.provider==='runninghub'){if(!Number.isInteger(config.seconds)||config.seconds<10||config.seconds>15)throw Error('此应用请使用 10–15 秒整数时长');}else if(config.enabled&&!draft.videoModel)throw Error('开启前请填写视频模型');if(config.provider==='connection'&&draft.baseUrl){var r=await api('POST','/im-bridge/service-connections',Object.assign({},draft,{action:'save'}));config.profileId=r.profile.id;videoConnectionDraft=Object.assign({},r.profile,{apiKey:''});}else if(config.provider==='connection'&&config.enabled)throw Error('开启前请填写视频服务地址');await api('POST','/im-bridge/settings',{videogen:config});data.settings.videogen=config;if($('vgKey'))$('vgKey').value='';if($('vgResult'))$('vgResult').textContent='视频配置已保存；没有执行试生成。';toast('视频配置已保存');}catch(error){if($('vgResult'))$('vgResult').textContent='未保存：'+error.message;}finally{if(button.isConnected)button.disabled=false;}};
    if(select.isConnected){detect.disabled=false;detect.title='只检测连接，不提交视频生成任务';$('vgSave').title='';applyPreviewControls();}
  }

  function imageGuideCard(){
    return '<section class="card guide"><h2>第一次配图片？从这里开始</h2><p>推荐 RunningHub。默认提供作者同款 Qwen2.1 图像编辑配置（图生图），跟着教程填密钥、准备参考图、保存并测试，不用手填节点。</p><div class="btnrow"><button class="primary" type="button" data-onb-track="image">手把手配置图片</button><a class="button-link" href="'+ONBOARD_RECOMMENDATIONS.image+'" target="_blank" rel="noopener noreferrer">RunningHub 推荐链接 ↗</a></div><p class="muted">作者邀请码：7q4hxxql。API 可用权限和计费以平台规则为准；生成测试由你手动点击。</p><details><summary>配置顺序与官方说明</summary><ol><li>注册平台并复制自己的 API Key。</li><li>服务商选 RunningHub，点“载入作者同款 Qwen2.1”。</li><li>应用 ID 2102644452430008321；准备自己的参考图，默认不包含作者的私有素材。</li><li>填好 Key 和参考素材，点保存配置库。更换其他应用时再从其 API 页面复制完整 cURL 自动识别。</li><li>手动生成，看到图片才算测试成功。</li></ol><p>各应用的节点不同；同款预设已提供输入映射。<a href="https://www.runninghub.cn/ai-detail/2102644452430008321" target="_blank" rel="noopener noreferrer">作者同款 Qwen2.1 应用</a> · <a href="https://www.runninghub.cn/call-api/api-detail/1965614643077070850?apiType=5" target="_blank" rel="noopener noreferrer">官方 API 说明示例</a>（仅用来了解格式，不指定你使用此工作流）。</p></details></section>';
  }
  function viewImagegen(){return imageGuideCard()+'<section class="card"><h2>图片 API 与本地来源</h2><p class="muted">可接入其他 OpenAI 兼容图片 API，不限原有服务商；在连接与搭配保存图片模型并点击“用于图片”。RunningHub 保留工作流方式。</p><button data-go="services">添加或切换图片 API</button></section>'+viewImagegenOriginal();}
  function viewImagegenOriginal() {
    var g = imagegenDraft || (data.settings && data.settings.imagegen) || {};
    var rh = rhLibrary(g.runninghub);
    renderedRhWorkflow = rh.activeWorkflowId;
    var provider = g.provider || 'runninghub';
    var models = [
      ['Kwai-Kolors/Kolors', 'Kolors（免费）'],
      ['Tongyi-MAI/Z-Image-Turbo', 'Z-Image-Turbo（约 0.1 元/张）'],
      ['Qwen/Qwen-Image', 'Qwen-Image（约 0.2 元/张）'],
    ];
    var out = personaImageMarkup()+(featureData?.imageStudioRevision==='20261027-param-autosave-v4'&&featureData?.imagePromptModelRevision==='20261027-prompt-language-v2'?'':'<div class="card" role="status"><p>新生图功能需要完整退出并重新打开 DSH，才能载入后端。仅刷新本页不会生效。</p></div>')+'<div class="card"><h2>生图</h2>' +
      '<div class="muted" style="margin-bottom:10px">同一时间只用一家，避免两套配置互相打架。</div>' +
      '<label class="check-field"><input id="igEnabled" type="checkbox"'+(g.enabled!==false?' checked':'')+'>启用图片生成</label><label class="field">服务商<select id="igProvider">' +
      '<option value="runninghub"' + (provider === 'runninghub' ? ' selected' : '') + '>RunningHub（工作流 / AI 应用）</option>' +
      '<option value="siliconflow"' + (provider === 'siliconflow' ? ' selected' : '') + '>硅基流动</option>' +
      '<option value="pollinations"' + (provider === 'pollinations' ? ' selected' : '') + '>Pollinations（免 key）</option>' +
      '</select></label>'+'<label class="field" style="margin-top:10px">提示词语言<select id="igPromptLanguage">'+
      '<option value="en"'+(g.promptLanguage!=='zh'?' selected':'')+'>英语（多数通用模型的推荐写法）</option>'+
      '<option value="zh"'+(g.promptLanguage==='zh'?' selected':'')+'>中文（适合 Qwen、Z-Image 等中文模型）</option>'+
      '</select><small class="muted">只影响提示词语言，不影响画风。提示词按人物、动作和场景写成连贯的自然语言；Anima、FLUX 等以英文标签为主的模型建议用英语。切换后请重新润色。</small></label>'+
      '<div class="row" style="margin-top:12px"><span id="igBalance" role="status">账户余额尚未查询</span><span class="muted">余额刷新在插件首页的口粮卡片</span></div>';

    if (provider === 'runninghub') {
      out += rhLibraryMarkup(rh) + '<div style="margin-top:12px;display:grid;gap:8px">' +
        '<label class="field">RunningHub API Key<input id="rhKey" type="password" placeholder="已保存则留空；要换 key 才填" value=""></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<label class="field">接入方式<select id="rhMode">' +
        '<option value="auto"'+(rh.mode==='auto'?' selected':'')+'>按 ID 判断（备用）</option><option value="app"' + (rh.mode === 'app' ? ' selected' : '') + '>AI 应用</option>' +
        '<option value="workflow"' + (rh.mode === 'workflow' ? ' selected' : '') + '>ComfyUI 工作流</option>' +
        '</select></label>' +
        '<label class="field">应用 / 工作流 ID<input id="rhId" value="' + esc(rh.mode === 'app' ? rh.webappId || '' : rh.workflowId || '') + '"></label></div>' +
        studioInspectionMarkup(rh) + '<details><summary>高级设置（通常无需填写）</summary><button id="rhInspect">按 ID 读取参数（备用）</button><label><input type="checkbox" id="rhAuto"'+(rh.autoDetect!==false?' checked':'')+'> 自动读取节点参数</label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
        '<label class="field">提示词节点<input id="rhNode" value="' + esc(rh.promptNodeId || '') + '"></label>' +
        '<label class="field">字段名<input id="rhField" value="' + esc(rh.promptField || 'text') + '"></label>' +
        '<label class="field">机型<select id="rhInstance">' +
        '<option value="default"' + ((rh.instanceType || 'default') === 'default' ? ' selected' : '') + '>default（快）</option>' +
        '<option value="lite"' + (rh.instanceType === 'lite' ? ' selected' : '') + '>lite（便宜）</option>' +
        '<option value="plus"'+(rh.instanceType==='plus'?' selected':'')+'>plus</option></select></label></div><label><input id="rhQueue" type="checkbox"'+(rh.usePersonalQueue==='true'?' checked':'')+'> 使用个人队列</label>' +
        '<label class="field">额外节点（JSON 数组，换行和逗号会完整保留；通常无需手动修改）' +
        '<textarea id="rhExtra" style="min-height:100px" spellcheck="false" placeholder="[]">' +
        esc(JSON.stringify(rh.extraNodes || [],null,2)) +
        '</textarea></label></details></div>';
    } else if (provider === 'siliconflow') {
      out += '<div style="margin-top:12px;display:grid;gap:8px">' +
        '<label class="field">硅基流动 API Key<input id="igKey" type="password" placeholder="已保存则留空；要换 key 才填" value=""></label>' +
        '<label class="field">模型<select id="igModel">' +
        models.map(function (m) {
          return '<option value="' + m[0] + '"' + ((g.model || 'Kwai-Kolors/Kolors') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
        '<label class="field">尺寸<input id="igSize" value="' + esc(g.size || '1024x1024') + '"></label>' +
        '<label class="field">步数<input id="igSteps" type="number" value="' + Number(g.steps || 20) + '"></label>' +
        '<label class="field">CFG<input id="igCfg" type="number" step="0.5" value="' + Number(g.cfg || 7.5) + '"></label></div>' +
        '<label class="field">固定 seed（0 随机）<input id="igSeed" type="number" value="' + Number(g.seed || 0) + '"></label></div>';
    } else {
      out += '<div class="muted" style="margin-top:12px">Pollinations 免 key，直接生成；有配额限制并可能带水印。</div>';
    }

    out += '<label class="field" style="margin-top:12px">统一媒体目录下的图片位置（在存储设置中更换，当前 = ' + esc((data.status && data.status.genDir) || 'cache/photos/gen') + '）' +
      '<input id="igDir" value="" readonly placeholder="跟随存储与缓存目录"></label>' +
      (g.lastError ? '<p class="muted" role="status">上次图片错误（'+esc(g.lastErrorPhase||'generate')+'）：'+esc(g.lastError)+'</p>' : '') +
      '<div class="btnrow" style="margin-top:10px"><button class="primary" id="igSave">保存</button>' +
      operationContextMarkup('igContext')+'<input id="igTestPrompt" placeholder="试一句，例如：一碗热腾腾的牛肉面" style="flex:1;min-width:150px">' +
      '<button id="igTest">生成一张</button></div>' +
      studioPromptMarkup() + studioResultMarkup()+'</div>';
    return out;
  }

  var learningChat='',learningQuery='',learningPage=0,learningScope='';
  function learningMarkup(compact){
    var library=featureData?.learning,c=library?.config||data.settings.learning||{};
    if(library?.revision!=='20261026-learning-v1')return '<div class="card"><h2>主动与被动学习</h2><p class="muted">学习模块尚未载入，请重新打开 DSH。</p></div>';
    var out='<div class="card"><div class="section-heading"><h2>主动与被动学习</h2><span class="tag">真实资料 · 交流经验 · 自选兴趣</span></div><p class="muted">被动学习观察白名单聊天中的反馈，并提取实际读到的网页与字幕。主动学习结合人设兴趣和未解决的问题查找公开资料，不预设必学主题；固定、重复的要求在你提出后登记到长期任务。手机应用里读到的标题、简介和公开评论也会作为有原文依据的资料排入学习。不会因此额外向 QQ 发消息。</p><div class="form-two"><label class="check-field"><input type="checkbox" id="learnEnabled"'+(c.enabled!==false?' checked':'')+'>启用学习记忆</label><label class="check-field"><input type="checkbox" id="learnPassive"'+(c.passive!==false?' checked':'')+'>被动学习聊天反馈和分享资料</label><label class="check-field"><input type="checkbox" id="learnActive"'+(c.active!==false?' checked':'')+'>允许后台主动学习</label><label class="field">学习方向<select id="learnFocus"><option value="mixed"'+(c.focus==='mixed'?' selected':'')+'>结合人设兴趣与未解决的问题</option><option value="questions"'+(c.focus==='questions'?' selected':'')+'>优先补足未解决的问题</option></select></label><label class="field">主动学习间隔（分钟）<input id="learnInterval" type="number" min="30" max="1440" value="'+Number(c.intervalMinutes||120)+'"></label><label class="field">每天最多主动尝试次数<input id="learnDaily" type="number" min="1" max="6" value="'+Number(c.maxActivePerDay||2)+'"></label></div><button id="learnSave" class="primary">保存学习设置</button><p class="muted">自动学习同时遵守自主总开关和清醒时段；<strong>聊天里的被动学习不设每日次数上限</strong>，读到的新反馈会持续排队处理。主动联网学习仍按每天次数限制。只保存有原文依据的具体理解，搜索标题和摘要不算已读正文。学习过程进入日终记忆，个人信息仍按日／月／年整理。</p></div>';
    if(compact)return '<div class="card"><h2>后台学习</h2><p class="muted">学习记忆 '+(c.enabled!==false?'已开':'已关')+' · 主动学习 '+(c.active!==false?'已开':'已关')+'。学习设置与记录统一在“情绪与学习”管理。</p><button data-go="thoughts">管理学习与情绪</button></div>';
    var scopes=(library.scopes||[]).filter(x=>{var persona=data.settings.contactProfiles?.[x.meta.key]?.personaId||data.settings.activePersonaId||data.status.persona?.id||data.status.preset;return x.meta.personaId===persona;});
    if(!scopes.some(x=>x.meta.key===learningChat))learningChat=scopes[0]?.meta.key||'';
    var scope=scopes.find(x=>x.meta.key===learningChat),items=scope?.items||[],labels={social:'语境观察',expression:'表达经验',meme:'梗知识',knowledge:'知识'};
    out+='<div class="card"><h2>学习记录与使用情况（自动提取，无需审核）</h2><label class="field">当前人设的学习范围<select id="learnChat">'+scopes.map(x=>'<option value="'+esc(x.meta.key)+'"'+(x.meta.key===learningChat?' selected':'')+'>'+esc(notesLabel(x.meta.key))+'</option>').join('')+'</select></label><div class="btnrow"><button id="learnNow"'+(!scope?' disabled':'')+'>现在主动学一次</button><button id="learnProcess"'+(!scope?' disabled':'')+'>立即补处理待学习资料</button><button id="learnHistory"'+(!scope?' disabled':'')+'>补学保留的历史反馈</button><button id="learnClear" class="danger small"'+(!scope?' disabled':'')+'>清空此范围的学习库</button></div>';
    if(!scope)return out+'<p class="muted">先添加白名单联系人。</p></div>';
    var scopeId=JSON.stringify([data.settings.activeAccountId,scope.meta.personaId,learningChat]);
    if(scopeId!==learningScope){learningScope=scopeId;learningPage=0;learningQuery='';}
    var query=learningQuery.trim().toLowerCase(),filtered=items.filter(function(i){return !query||[i.summary,i.when,i.avoid,i.example,i.quote,i.source?.title].some(function(text){return String(text||'').toLowerCase().includes(query);});});
    var pages=Math.max(1,Math.ceil(filtered.length/20));learningPage=Math.max(0,Math.min(learningPage,pages-1));
    var visibleItems=filtered.slice(learningPage*20,(learningPage+1)*20);
    out+='<label class="field">查找学习记录<input id="learnSearch" maxlength="160" value="'+esc(learningQuery)+'" placeholder="关键词、来源或原文"></label><div class="btnrow" id="learnPagination"><button id="learnPrev"'+(learningPage?'':' disabled')+'>上一页</button><span role="status">第 '+(learningPage+1)+' / '+pages+' 页 · '+filtered.length+' 条'+(query?'匹配':'记录')+' · 每页 20 条</span><button id="learnNext"'+(learningPage<pages-1?'':' disabled')+'>下一页</button></div>';
    if(items.length&&!filtered.length)out+='<p class="muted">没有匹配的学习记录，可更换关键词。</p>';

    out+='<p class="muted">已存 '+items.length+' 条 · 等待提取 '+scope.pending.length+' 份 · 今天主动尝试 '+scope.limit.active+' / '+Number(c.maxActivePerDay||2)+' 次 · 被动提取 '+scope.limit.passive+' 次</p>';
    if(scope.status)out+='<div class="notice" role="status">'+esc(({queued:'等待学习',running:'学习中',completed:'已处理',failed:'未学成，待重试',cancelled:'本次已取消',pending:'待补处理'})[scope.status.state]||scope.status.state)+'：'+esc(scope.status.reason||'')+(scope.status.query?'<br>公开选题：'+esc(scope.status.query):'')+'</div>';
    if(scope.archiveError)out+='<p class="muted">'+esc(scope.archiveError)+'</p>';
    if(!items.length)out+='<div class="empty">目前没有学成的记录。可以补学历史反馈、分享资料，或让她主动学一次；没有读到正文时会如实说明。</div>';
    visibleItems.forEach(i=>{out+='<article class="memory-item"><div class="section-heading"><span class="tag">'+esc(labels[i.kind])+'</span><span class="muted">'+(i.mode==='active'?'主动学习':'被动学习')+' · '+esc(new Date(i.at).toLocaleString())+'</span></div><p>'+esc(i.summary)+'</p><p class="muted">适用：'+esc(i.when)+'<br>避免：'+esc(i.avoid)+'</p>'+(i.example?'<p class="muted">自拟例句：'+esc(i.example)+'</p>':'')+'<details><summary>来源与原文依据</summary><p>'+esc(i.source.title)+(i.source.partial?' · 部分材料':'')+'</p><blockquote>'+esc(i.quote)+'</blockquote>'+(i.source.url?'<a href="'+esc(i.source.url)+'" target="_blank" rel="noreferrer">查看公开来源</a>':i.source.type==='phone'?'<p class="muted">来自手机应用当前屏幕，只保存文字，没有截图</p>':'<p class="muted">来自本对话，未提交外网</p>')+'</details><p class="muted">已用于相关回复 '+Number(i.used||0)+' 次'+(i.lastUsedAt?' · 最近 '+esc(new Date(i.lastUsedAt).toLocaleString()):'')+' · '+(i.expiresAt<Date.now()?'已过期，暂停使用':'复核期限 '+esc(new Date(i.expiresAt).toLocaleDateString()))+'</p><button class="danger small" data-learning-delete="'+esc(i.id)+'">删除，不再引用</button></article>';});
    if(scope.pending.length)out+='<details><summary>等待学习的资料</summary>'+scope.pending.map(q=>'<p class="muted">'+esc(q.sources.map(x=>x.title).join('、'))+' · 尝试 '+q.attempts+' 次</p>').join('')+'</details>';
    out+='<p class="muted">知识和经验按账号、联系人、人设隔离。梗默认 7 天后复核；过期不再注入对话。删除后不再用于回复，日历记忆中已经记录的学习过程仍是历史。</p></div>';return out;
  }
  function bindLearning(){
    if($('learnChat'))$('learnChat').onchange=function(){learningChat=this.value;renderPane();};
    if($('learnSearch'))$('learnSearch').oninput=function(){learningQuery=this.value;learningPage=0;renderPane();};
    [['learnPrev',-1],['learnNext',1]].forEach(function(pair){if($(pair[0]))$(pair[0]).onclick=function(){learningPage+=pair[1];renderPane();$('learnPagination')?.scrollIntoView({block:'center'});};});
    if($('learnSave'))$('learnSave').onclick=async function(){var button=this;button.disabled=true;try{await api('POST','/im-bridge/settings',{learning:{enabled:$('learnEnabled').checked,passive:$('learnPassive').checked,active:$('learnActive').checked,focus:$('learnFocus').value,intervalMinutes:Number($('learnInterval').value),maxActivePerDay:Number($('learnDaily').value)}});await load();toast('学习设置已保存');}catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}};
    async function act(action,button,id){if(!learningChat)return;if(['clear','delete'].includes(action)&&!await askConfirm(action==='clear'?'清空此联系人、当前人设的学习记录和队列？':'删除这条学习记录，并停止在后续回复中引用？'))return;button.disabled=true;try{var r=await api('POST','/im-bridge/features/learning',{key:learningChat,action,id});await load();toast(r.result.reason||'已检查学习状态');}catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}}
    [['learnNow','active'],['learnProcess','process'],['learnHistory','history'],['learnClear','clear']].forEach(pair=>{if($(pair[0]))$(pair[0]).onclick=function(){act(pair[1],this,'');};});
    document.querySelectorAll('[data-learning-delete]').forEach(b=>b.onclick=function(){act('delete',this,this.getAttribute('data-learning-delete'));});
    if($('memLearning'))$('memLearning').onclick=()=>navigate('thoughts');
  }

  var soulChat='';
  function viewSoulState(){
    if(!featureData?.moodRevision)return '<div class="card"><p class="muted">完整退出并重新打开 DSH 后，可使用情绪状态与网页学习。</p></div>';
    if(!featureData.knownChats.includes(soulChat))soulChat=featureData.knownChats[0]||'';
    var c=featureData.moodConfig||{},s=featureData.soulByChat[soulChat]||{mood:{score:65,timeline:[],dims:{}},experiences:[]};
    var dims={happy:'开心',calm:'平静',sweet:'亲近',heartache:'心疼',worry:'担心',sad:'低落',jealous:'吃醋',angry:'生气',curious:'好奇',excited:'兴奋',disappointed:'失落',relieved:'释然',proud:'得意',bored:'无聊'};
    var out='<div class="card"><h2>相处状态</h2><p class="muted">按账号、联系人和人设分别保存。情绪是可修正的估计，作品反思与用户个人记忆分开。低可信度的猜测不会影响她的语气；状态会逐渐回稳。</p><label class="field">查看对话<select id="soulChat">'+featureOptions(soulChat)+'</select></label><p>心情 '+Number(s.mood.score).toFixed(0)+' · '+Object.keys(dims).map(k=>dims[k]+' '+Math.round(s.mood.dims[k]||0)).join(' / ')+'</p><div class="form-two"><label class="check-field"><input type="checkbox" id="moodEnabled"'+(c.enabled?' checked':'')+'>启用情绪连续性</label><label class="field">判断间隔（用户轮次）<input id="moodEvery" type="number" min="1" max="20" value="'+Number(c.everyTurns||3)+'"></label><label class="field">最低可信度<input id="moodConfidence" type="number" min="50" max="100" value="'+Number(c.confidence||70)+'"></label><label class="field">回稳半衰期（小时）<input id="moodDecay" type="number" min="1" max="48" value="'+Number(c.halfLifeHours||6)+'"></label></div><p class="muted">默认每三轮评估；明确的情绪信号可提前评估。与已有复盘合用一次模型调用，情绪底色持续影响后续措辞和自动语音；重要事件每天最多提示六次，同一事件只提示一次，不限制情绪延续。</p><button id="soulReset" class="small">让当前对话心情回稳</button><div style="margin-top:12px">'+(s.mood.timeline||[]).slice(-6).reverse().map(e=>'<div class="msg"><div class="meta">'+esc(new Date(e.at).toLocaleString())+' · 可信度 '+Number(e.confidence)+'</div><div>'+esc(e.reason)+'</div><div class="muted">依据：'+esc(e.quote)+'</div></div>').join('')+'</div></div>';
    if(s.lastAnalysis)out+='<div class="card"><p class="muted">上次分析：'+esc(s.lastAnalysis.state==='running'?'处理中':s.lastAnalysis.reason||'已完成')+' · '+esc(new Date(s.lastAnalysis.at).toLocaleString())+'</p></div>';
    var video=featureData?.videoCapability||{};out+='<div class="card"><h2>视频画面与声音</h2><p>'+esc(video.enhanced?'video-watch-plus 本地增强已就绪':'当前使用本机基础抽帧')+' · '+esc(video.whisper?'本地语音模型已就绪':'语音模型待就绪')+'</p><label class="check-field"><input id="videoPlusEnabled" type="checkbox"'+(data.settings.media?.videoPlus!==false?' checked':'')+'>增强视频卡片与附件理解</label><p class="muted">按切镜与全片骨架提取最多8张画面，先分析声音再转写，避免把背景音乐编成台词。当前读取15分钟、128MB以内的单个视频；音轨覆盖前3分钟。支持可取得视频的B站、抖音等链接，登录或平台限制会如实显示失败。设置与下方阅读选项一起保存。</p></div>';
    var exp=featureData.expressionLearning||{},cr=exp.corpusRatings||{};
    out+='<div class="card"><h2>自然说话与梗学习</h2><p>真人对话样例 '+Number(exp.corpus||0)+' 组（日常 '+Number(cr.general||0)+' · 情绪/粗口 '+Number(cr.edgy||0)+' · 黄色玩笑 '+Number(cr.bawdy||0)+' · 成人向 '+Number(cr.adult||0)+'） · 当前对话已学表达 '+Number(exp.learned||0)+' 条 · 待整理发言 '+Number(exp.pending||0)+' 条</p><p class="muted">把普通接话、情绪和场景统一按语境检索；不要求先出现原词，不强制搞笑，不学习个人身份。样例包含 MIT 授权的 LCCC 小样本（约 220 条）、少量 Apache-2.0 的 KdConv 对话片段和本项目自写的日常/情绪/场景/粗口/亲密对话，只作语气参考，不是训练模型权重。黄色玩笑样例对所有私聊和群聊开放，只当玩笑、不点名身体、对方不接就收；成人向亲密仍只在号主私聊且开启成人模式时检索，不进群聊或陌生人对话。可用 tools/import-expression-corpus.mjs 从本地 LCCC/KdConv 文件补充自己的语料。</p><details><summary>本对话最近学到的表达</summary>'+(exp.items||[]).slice(-8).map(i=>'<p><b>'+esc(i.situation)+'</b>：'+esc(i.style)+'</p>').join('')+'</details></div>';
    out+=websiteReadingMarkup();
    out+='<div class="card"><h3>历史作品反思</h3>';
    out+=(s.experiences||[]).slice(-8).reverse().map(e=>'<div class="msg"><div class="meta">'+esc(e.title)+' · '+esc(new Date(e.at).toLocaleString())+'</div><div>'+esc(e.insight)+'</div><p>'+esc(e.nextResponse)+'</p><div class="muted">原文依据：'+esc(e.evidenceQuote)+'</div></div>').join('')||'<p class="muted">没有历史记录。</p>';
    return out+'<button id="soulForget" class="small">不再引用当前对话的历史理解</button></div>';
  }
  function websiteReadingMarkup(){
    var w=featureData.websites||{},c=w.config||data.settings.websites||{},rows=w.records||[];
    var sources=(c.sources||[]).map(v=>v.name+' | '+v.url).join('\n');
    var out='<div class="card"><h2>自定义网站阅读与分享</h2><p class="muted">填写她可以浏览的网站或具体网页。动态网站会用真实浏览器打开，并优先进入视频或文章详情；主页只用于选内容，不作为学习成果。读到的具体资料会进入记录，再按兴趣决定是否分享。视频画面与声音的理解沿用现有设置，此处不会把网页简介当作看过视频。</p><div class="form-two"><label class="check-field"><input id="websitesEnabled" type="checkbox"'+(c.enabled!==false?' checked':'')+'>启用网页阅读</label><label class="check-field"><input id="websitesLearning" type="checkbox"'+(c.learning!==false?' checked':'')+'>从实际读到的文字学习</label><label class="check-field"><input id="websitesAutoShare" type="checkbox"'+(c.autoShare!==false?' checked':'')+'>允许她主动向号主分享（仍受主动开关约束）</label><label class="field">检查新内容的间隔（分钟）<input id="websitesInterval" type="number" min="30" max="1440" value="'+Number(c.intervalMinutes||120)+'"></label></div><label class="field">自定义来源（每行一个，最多20个）<textarea id="websitesSources" rows="5" placeholder="网站名称 | https://example.com/videos">'+esc(sources)+'</textarea></label><p class="muted">可填公开网站栏目或文章地址，每次少量读取同站链接。需要登录或无法读取的页面会显示原因。学习总开关仍在下方学习设置中；关闭主动消息时不会主动分享。</p><div class="btnrow"><button id="soulSave" class="primary">保存情绪与阅读设置</button><button id="websitesReadNow">立即读取已保存的来源</button></div><h3 style="margin-top:18px">当前号主对话的阅读与分享记录</h3>';
    if(!rows.length)out+='<p class="muted">还没有阅读记录。先保存来源，再点“立即读取”；这里只读取并排入学习，不会直接向QQ发消息。</p>';
    out+=rows.slice(0,30).map(r=>'<div class="msg"><div class="meta">'+esc(new Date(r.at).toLocaleString())+' · '+esc(({read:'已读取正文',metadata:'仅取得标题与简介',restricted:'页面需要验证或登录',failed:'读取失败',empty:'页面没有可读文字'})[r.status]||r.status)+' · '+esc(r.learnedIds?.length?'已学到 '+r.learnedIds.length+' 条':r.learning==='queued'?'学习待处理':r.learning&&r.learning!=='none'?r.learning:'未新增学习')+' · '+esc(r.sharedAt?'已确认分享到QQ':'尚未分享')+'</div><b>'+esc(r.title||r.url)+'</b><div>'+esc(r.url)+'</div><p>'+esc(r.excerpt||r.description||r.error||'未取得内容')+'</p><div class="muted">'+esc(r.coverage)+'</div></div>').join('');
    return out+'</div>';
  }

  var qzonePanel=null,qzoneHealthTimer=null;
  function qzoneStateLabel(connection){return ({disabled:'空间已关闭',offline:'等待 QQ 连接',unverified:'等待验证',checking:'正在验证',ready:'只读验证通过',auth_required:'需要登录或验证',unavailable:'暂时无法确认',throttled:'稍后再检查',unsupported:'接口暂不可用'})[connection?.state]||'尚未检查';}
  function qzoneConnectionCard(connection){return '<div class="card"><h2>QQ 与空间登录</h2><p class="muted">共用这台设备的 QQ 登录凭据。QQ 上线或重连后自动检查空间，空闲时维护；空间异常时 QQ 聊天仍可正常使用。</p><div class="row"><span>QQ 桥接</span><span id="qzoneQqState" class="tag">'+(connection?.qqConnected?'已连接':'未连接')+'</span></div><div class="row"><span>空间登录</span><span id="qzoneAuthState" class="tag">'+esc(qzoneStateLabel(connection))+'</span></div><p id="qzoneAuthNote" class="muted" role="status">'+esc(connection?.reason||'正在读取空间状态')+'</p><p id="qzoneAuthTime" class="muted"></p><button id="qzoneCheck">检查并更新登录</button><p class="muted">只读取自己的空间验证登录，不会发动态或评论。发布权限与结果以实际回执为准；平台要求扫码或验证码时仍需本人完成。</p></div>';}
  function viewQzone(){return '<div class="card"><h2>QQ空间总开关</h2><label class="check-field"><input id="qzoneEnabled" type="checkbox" '+(data.settings?.qzoneAccess?.enabled===true?'checked':'')+'>开启空间功能</label><p class="muted">默认关闭。关闭后，空间专用接口不再浏览、维护登录、上传配图、发动态或评论，也不做后台读回核对；QQ聊天不受影响。开启后，日程每天只提醒她一次想不想逛逛或发布，选择不做也不补提醒，不把提醒当成任务；每次主动访问最多尝试一条评论或回复。不要求你每天手动确认。通用浏览器和手机操作不是网站隔离沙箱。</p><p id="qzoneSwitchNote" class="muted" role="status"></p></div>'+qzoneConnectionCard(data.status?.qzone)+'<div class="card"><h2>空间动态与评论</h2><p class="muted">这里只显示实际提交与回执。平台接收不代表已核实公开可见；结果未知时不会自动重发。她可自行选搜索图、截图、生成图或画作；生成图沿用角色风格与生图逻辑，来源和文件见调用记录。</p><button id="qzoneRefresh">刷新发布记录</button><div id="qzoneEntries"></div></div><div class="card"><h2>读取动态评论</h2><label class="field">动态作者 QQ<input id="qzoneOwner" inputmode="numeric"></label><label class="field">动态 ID<input id="qzoneTid"></label><button id="qzoneComments">读取实际评论</button><div id="qzoneCommentsList"></div><p id="qzoneReplyTarget" class="muted"></p><label class="field">完整回复<textarea id="qzoneReplyText" rows="3" maxlength="600"></textarea></label><button id="qzoneReply" class="primary" disabled>发布上面这条回复</button><p id="qzoneNotice" role="status"></p></div>';}
  function bindQzone(){if(!$('qzoneRefresh'))return;var target=null,root=$('qzoneQqState'),checking=false;if(typeof data.settings?.qzoneAccess?.enabled!=='boolean'){$('qzoneEnabled').disabled=true;$('qzoneSwitchNote').textContent='后台尚未加载新版，请先重启DSH；旧版没有空间总开关。';}
    function active(){return root?.isConnected;}
    $('qzoneEnabled').onchange=async function(){var enabled=this.checked;this.disabled=true;try{await api('POST','/im-bridge/settings',{qzoneAccess:{enabled:enabled}});data.settings.qzoneAccess={enabled:enabled};$('qzoneSwitchNote').textContent=enabled?'空间已开启；日程每天只提醒一次。':'空间已关闭，已停止空间专用任务和登录维护。';await $('qzoneRefresh').onclick();}catch(error){this.checked=!enabled;$('qzoneSwitchNote').textContent='未保存：'+error.message;}finally{this.disabled=false;}};
    function paint(connection){if(!active()||!connection)return;var off=connection.enabled!==true;$('qzoneCheck').disabled=off;$('qzoneComments').disabled=off;if(off)$('qzoneReply').disabled=true;$('qzoneQqState').textContent=connection.qqConnected?'已连接':'未连接';$('qzoneAuthState').textContent=qzoneStateLabel(connection);$('qzoneAuthState').dataset.state=connection.state||'unverified';$('qzoneAuthNote').textContent=connection.reason||'';$('qzoneAuthTime').textContent=(connection.checkedAt?'最近检查：'+new Date(connection.checkedAt).toLocaleString():'尚未完成只读检查')+(connection.nextCheckAt>Date.now()?' · 下次检查不早于 '+new Date(connection.nextCheckAt).toLocaleTimeString():'');}
    async function run(action,extra){if(!active())return null;try{var value=await api('POST','/im-bridge/features/qzone',Object.assign({action:action,uin:$('qzoneOwner').value,tid:$('qzoneTid').value},extra||{}));if(active()){paint(value.connection);if(action!=='status')$('qzoneNotice').textContent=value.coverage||'已读取';}return value;}catch(e){if(active())$('qzoneNotice').textContent=e.message;throw e;}}
    $('qzoneCheck').onclick=async function(){if(checking)return;checking=true;this.disabled=true;try{await run('check-session');}catch{}finally{checking=false;if(active())$('qzoneCheck').disabled=false;}};
    $('qzoneRefresh').onclick=async function(){try{qzonePanel=await run('status');if(!active()||!qzonePanel)return;$('qzoneEntries').replaceChildren();(qzonePanel.entries||[]).forEach(function(row){var article=document.createElement('article'),p=document.createElement('p'),button=document.createElement('button');p.textContent=row.text+' · '+(row.verification?.state==='observed'?'已读回核对':row.status==='accepted'?'平台已接收，待核对':row.status)+' · 配图 '+Number(row.imageCount||0)+' 张';article.append(p);if(row.verification){var check=document.createElement('p');check.className='muted';check.textContent=row.verification.reason+'；对方接收/已读未知';article.append(check);}if(['accepted','unknown'].includes(row.status)){var verify=document.createElement('button');verify.textContent='核对发布结果';verify.onclick=async function(){verify.disabled=true;try{await run('verify',{id:row.id});await $('qzoneRefresh').onclick();}finally{verify.disabled=false;}};article.append(verify);}if(row.itemId&&row.kind==='publish'){button.textContent='读取这条动态的评论';button.onclick=function(){$('qzoneOwner').value=row.owner||'';$('qzoneTid').value=row.itemId;$('qzoneComments').click();};article.append(button);}$('qzoneEntries').append(article);});}catch{}};
    $('qzoneComments').onclick=async function(){target=null;$('qzoneReply').disabled=true;try{var result=await run('comments');if(!active()||!result)return;$('qzoneCommentsList').replaceChildren();(result.comments||[]).forEach(function(comment){var p=document.createElement('p'),button=document.createElement('button');p.textContent=(comment.name||comment.uin)+'：'+comment.text;button.textContent='回复';button.onclick=function(){target=comment;$('qzoneReplyTarget').textContent='回复 '+(comment.name||comment.uin)+'：'+comment.text;$('qzoneReply').disabled=false;};p.append(button);$('qzoneCommentsList').append(p);});}catch{}};
    $('qzoneReply').onclick=async function(){if(!target)return;var button=this;button.disabled=true;try{await run('reply',{text:$('qzoneReplyText').value,uin:target.owner,tid:target.tid,commentId:target.id,commentUin:target.uin,confirm:true});target=null;}catch{}finally{if(active())button.disabled=!target;}};
    void $('qzoneRefresh').onclick();qzoneHealthTimer=setInterval(function(){if(active()&&!document.hidden)void $('qzoneRefresh').onclick();},15000);
  }
  function viewThoughts() {
    var t = thoughts || { timeline: [] };
    var items = t.timeline || [];
    var out = viewSoulState()+learningMarkup(false)+'<div class="card"><div class="row"><span><b>自主行为与回复复盘</b><br><span class="muted">状态：' + esc(t.mood || '平静') +
      ' · 自主模式' + (t.enabled ? '开着' : '关着') + '</span></span>' +
      '<button class="small" id="thTick">现在想一次</button>' +

      '<button class="small" id="autoSim">预览一天的决策（不执行）</button>' +
      '<button class="small" id="thReflect">' + ((data.settings.autonomy && data.settings.autonomy.reflect === false) ? '复盘：关' : '复盘：开') + '</button></div>' +
      '<div class="muted" style="margin-top:6px">已有情绪或作品分析时顺带保留复盘记录，不为记录额外调用模型。关闭记录不影响情绪评估和作品学习。</div>' +
      '<div class="muted" style="margin-top:6px">今天：签名 ' + ((t.counts && t.counts.signature) || 0) +
      ' · 空间 ' + ((t.counts && t.counts.qzone) || 0) + ' · 找人 ' + ((t.counts && t.counts.chats) || 0) + '</div></div>';

    out += '<div class="card"><h2>复盘与行为记录</h2>';
    if (!items.length) out += '<div class="empty">还没有记录。点上面的「现在想一次」，或者等她自己动。</div>';
    items.forEach(function (item) {
      var when = new Date(item.at).toLocaleString();
      if (item.kind === 'decision') {
        var label = { signature: '改签名', nickname: '改昵称', qzone: '发空间', chat: '找人聊天', none: '什么也没做' }[item.action] || item.action;
        out += '<div class="msg out" style="margin-bottom:8px"><div class="meta"><span>' + esc(label) + '</span><span>' + esc(when) + '</span></div>' +
          (item.text ? '<div class="body">' + esc(item.text) + '</div>' : '') +
          (item.reason ? '<div class="muted" style="margin-top:4px">为什么：' + esc(item.reason) + '</div>' : '') +
          (item.target ? '<div class="muted">对象：' + esc(item.target) + '</div>' : '') + '</div>';
      } else {
        out += '<div class="msg" style="margin-bottom:8px"><div class="meta"><span>回复记录</span><span>' + esc(when) + '</span></div>' +
          '<div class="body" style="white-space:pre-wrap">' + esc(String(item.text || '')) + '</div>' +
          (item.reply ? '<div class="muted" style="margin-top:6px">据此说：' + esc(String(item.reply).split('|||').join(' / ').slice(0, 90)) + '</div>' : '') +
          '</div>';
      }
    });
    out += '</div>';
    return out;
  }

  function viewModelSettings() {
    var s = data.status;
    var pc = data.settings.proactiveCfg || { startHour: 9, endHour: 23, maxPerDay: 3 };
    var dnd = data.settings.dnd || { enabled: false, startHour: 23, endHour: 9 };
    
    var out = '<div class="card"><h2>聊天模型</h2><div class="row"><span>当前</span><span class="muted mono" id="modelCur"></span></div>' +
      '<label class="field" style="margin-top:8px">智力档位（点一下立刻切换并重开会话）</label>' +
      '<div class="btnrow">' +
      ['eco:省·不思考', 'standard:标准·轻思考', 'high:高·深想', 'max:最高·拉满'].map(function (pair) {
        var id = pair.split(':')[0];
        var label = pair.split(':')[1];
        return '<button class="small ' + ((data.status.intelligence || 'standard') === id ? 'primary' : '') + '" data-iq="' + id + '">' + label + '</button>';
      }).join('') + '</div>' +
      '<div class="muted" style="margin-top:4px">当前实际档位：<code>' + esc(data.status.effectiveEffort || 'low') + '</code>。档位写在会话里，所以切换会结束当前会话，下一条消息自动开新会话。</div>' +
      '<div class="muted" id="iqHint"></div>' +
      '<div style="display:grid;gap:8px;margin-top:8px">' +
      '<label class="field">模型提供商<select id="mProvider"></select></label><label class="field">聊天模型<select id="mModel"></select></label>' +
      '<div class="btnrow"><button class="primary" id="mSave">保存模型</button><button id="mReset">恢复默认</button></div>' +
      '<div class="muted">思考深度由上面的「智力档位」统一控制，这里只管用哪个模型。聊天默认沿用 DeepSeek；要接入其他服务，在“连接与搭配”填地址、密钥和模型，保存后点击“用于聊天”。也可继续使用 DSH 的模型设置。</div>' +
      '<button data-go="services">添加或切换聊天 API</button><div class="muted" id="ibHint">输入预算：本轮系统 ' + Number((featureData?.inputBudget?.last||{}).systemChars||0) + ' 字 + 动态 ' + Number((featureData?.inputBudget?.last||{}).contentChars||0) + ' 字（去重前 ' + Number((featureData?.inputBudget?.last||{}).rawContentChars||0) + ' 字）；较长的临时提示只保留最近两轮。</div>' +
      '</div></div>';



    out += viewSearchCard();
    return out;
  }

  /** 人设页里的「主动行为」块：她什么时候会主动说话。 */
  function proactiveCards() {
    var s=data.status,e=featureData?.lifeExecution||{};
    function row(key,label,on){return '<div class="row"><span>'+label+'</span><button class="small" data-toggle="'+key+'">'+(on?'开':'关')+'</button></div>';}
    return '<div class="card"><h2>聊天后的自然续聊</h2><p class="muted">续聊遵守自主总开关；对方忙碌、结束或不想聊时停止。</p>'+row('silence','沉默后考虑再聊一句',s.silence)+row('afterthought','偶尔补充刚才没说完的话',s.afterthought)+'</div><div class="card"><h2>日程作息</h2><p>'+esc(e.sleeping?'正在睡觉：停止接收和回复 QQ 消息，醒来不补回睡眠期间消息。':'当前醒着：按正常聊天规则决定是否回应。')+'</p><p class="muted">作息在下方「人生与实际行动」统一设置。失眠或醒着休息属于清醒活动，不随机伪造失眠。</p>'+(e.sleeping?'<button id="lifeWake">唤醒当前睡眠段</button>':'')+'</div>';
  }

  function viewSearchCard() {
    var se = (data.settings && data.settings.search) || {};
    return '<div class="card"><h2>网页搜索来源</h2>' +
      '<div class="muted" style="margin-bottom:8px">用于网页搜索与资料查询；是否搜索由当前需求决定。这里设置默认搜索来源，实际结果以调用记录为准。</div>' +
      '<label class="field">引擎<select id="seEngine">' +
      '<option value="host"' + (se.engine === 'host' || !se.engine ? ' selected' : '') + '>DSH 自带（默认）</option>' +
      '<option value="wikipedia"' + (se.engine === 'wikipedia' ? ' selected' : '') + '>维基百科 API（免费、无需 key）</option>' +
      '<option value="ddg"' + (se.engine === 'ddg' ? ' selected' : '') + '>DuckDuckGo API（免费、英文强）</option>' +
      '<option value="searx"' + (se.engine === 'searx' ? ' selected' : '') + '>SearXNG（自建，开源）</option>' +
      '<option value="custom"' + (se.engine === 'custom' ? ' selected' : '') + '>自定义 URL（{q} 占位）</option>' +
      '</select></label>' +
      '<label class="field" style="margin-top:8px">SearXNG 地址<input id="searxUrl" placeholder="http://127.0.0.1:8888" value="' + esc(se.searxUrl || '') + '"></label>' +
      '<label class="field" style="margin-top:8px">自定义搜索 URL<input id="seCustomUrl" placeholder="https://example.com/search?q={q}" value="' + esc(se.customUrl || '') + '"></label>' +
      '<button class="primary" id="searxSave" style="margin-top:10px">保存搜索设置</button></div>';
  }

  /** 记忆：压缩规则 + 存放位置。 */
  /** 把 private:1234567 显示成「备注（尾号1234）」。 */
  function notesLabel(key) {
    var qq = String(key || '').replace(/^(private|group):/, '');
    var note = (data.settings.userNotes || {})[qq];
    if (key.indexOf('group:') === 0) return '群 ' + qq;
    return note ? note + '（尾号' + qq.slice(-4) + '）' : '尾号' + qq.slice(-4);
  }

  function companionMarkup(){
    var c=data.settings.companion||{};
    var out='<div class="card"><h2>自然相处与表达</h2><p class="muted">人设决定她是谁，表达设置决定她有多放得开。可以接梗、互怼、撒娇、说自己的想法；不用统一成礼貌客服，也不固定模仿某一段聊天。</p>';
    if(featureData?.expressionRevision!=='20261025-expression-v1')out+='<div class="banner">新增表达设置需要完整退出并重新打开 DSH 后生效。</div>';
    out+='<div class="form-two"><label class="field">表达自由度<select id="careExpression"><option value="relaxed"'+(c.expressionMode!=='reserved'?' selected':'')+'>自然放开</option><option value="reserved"'+(c.expressionMode==='reserved'?' selected':'')+'>温和克制</option><option value="free"'+(c.expressionMode==='free'?' selected':'')+'>自由（更少滤镜）</option></select></label><label class="field">群聊气泡数<select id="careBubbles">'+[[0,'自主决定（无固定数量）'],[1,'1 个'],[2,'2 个'],[3,'3 个'],[4,'4 个'],[5,'5 个'],[6,'6 个'],[8,'8 个']].map(function(v){return '<option value="'+v[0]+'"'+(Number(c.maxBubbles??0)===v[0]?' selected':'')+'>'+v[1]+'</option>';}).join('')+'</select></label><label class="field">拟真模式下单条最多字数（0=平台上限）<input id="careChars" type="number" min="0" max="8000" value="'+Number(c.maxReplyChars??0)+'"></label><label class="check-field"><input type="checkbox" id="careRepeat"'+(c.allowRepetition!==false?' checked':'')+'>允许重复口头禅，不做重复检测改写</label><label class="check-field"><input type="checkbox" id="careCasual"'+(c.casualInitiative!==false?' checked':'')+'>自主搭话允许随意闲聊，不必有新资讯</label><label class="check-field"><input type="checkbox" id="careEnabled"'+(c.enabled!==false?' checked':'')+'>启用情境回应</label><label class="check-field"><input type="checkbox" id="careContinuity"'+(c.continuity!==false?' checked':'')+'>短时情绪衔接</label><label class="check-field"><input type="checkbox" id="carePauses"'+(c.respectPauses!==false?' checked':'')+'>忙碌 / 晚安后不追发</label><label class="field">等你把话说完<select id="careWait">'+[['natural','自然'],['fast','快速'],['steady','多等一会'],['off','使用原合并间隔']].map(function(p){return '<option value="'+p[0]+'"'+((c.waitMode||'natural')===p[0]?' selected':'')+'>'+p[1]+'</option>';}).join('')+'</select></label></div><p class="muted">自然放开允许符合人设与聊天习惯的轻微粗口、玩笑和亲昵称呼，不强制每轮使用。群聊气泡数控制短句分段；私聊由她自己决定表达长短；本地私聊按换行分别发送，代码和列表保持完整；单条字数与重复改写只在拟真模式开启时生效，长篇任务仍按平台长度拆分。</p><button class="primary" id="careSave">保存相处方式</button><p class="muted">主动行为的开关、时段、频率仍在「主动互动」设置。“我先忙 / 晚安 / 别再发”会暂停追聊，下一条用户消息恢复；不靠求救或充值压力维持互动。</p></div>';
    var r=data.settings.realism||{},rs=r.safety||{};
    out+='<div class="card"><h2>拟真模式</h2><p class="muted">放开会让她更像真人聊天：单条可以更长、气泡更多、允许重复口头禅，不再每轮加“核实/免责声明”式的收尾。安全相关项目单独列出，默认保持保护。</p>' +
      '<label class="check-field"><input id="rlEnabled" type="checkbox"'+(r.enabled!==false?' checked':'')+'>启用拟真模式（放开单条字数、重复检测、媒体免责声明和主动额度）</label>' +
      '<label class="check-field"><input id="rlNaturalMedia" type="checkbox"'+(r.naturalEvidence!==false?' checked':'')+'>媒体资料不套固定免责声明，用自然口吻说明有没有依据</label>' +
      '<label class="check-field"><input id="rlStrictMedia" type="checkbox"'+(r.strictMedia===true?' checked':'')+'>严格媒体核验（防编造歌词/字幕/视频细节）</label>' +
      '<label class="check-field"><input id="rlUnlimited" type="checkbox"'+(r.unlimitedProactive!==false?' checked':'')+'>不限制主动消息每日额度与分享间隔（仍遵守日程休息和明确暂停）</label>' +
      '<label class="check-field"><input id="rlAdult" type="checkbox"'+(r.adultMode===true?' checked':'')+'>成人向私密表达（仅号主私聊、双方明确自愿；默认关闭）</label>' +
      '<div class="muted" style="margin-top:10px">安全限制（可选）</div>' +
      '<label class="check-field"><input id="rlPay" type="checkbox"'+(rs.payment!==false?' checked':'')+'>允许支付 / 下单（仍需本地面板配置金额与验证）</label>' +
      '<label class="check-field"><input id="rlPhone" type="checkbox"'+(rs.phone!==false?' checked':'')+'>允许手机自动化（Pilot / 学习 / 工具）</label>' +
      '<label class="check-field"><input id="rlPrivacy" type="checkbox"'+(rs.privacy!==false?' checked':'')+'>隐私保护：不把私聊、地址、账号带进群聊或外部</label>' +
      '<label class="check-field"><input id="rlCoercion" type="checkbox"'+(rs.coercion!==false?' checked':'')+'>禁止情感胁迫、自伤威胁和金钱压力</label>' +
      '<button class="primary" id="rlSave">保存拟真设置</button>' +
      '<p class="muted">关闭“允许手机自动化”会拦截 phone_* 工具和手机学习；关闭“允许支付”会拦截下单/付款流程。隐私与反胁迫即使关闭，仍受平台与本地安全底线约束。成人向表达只在号主私聊、双方自愿时生效，不涉及未成年人、真实他人、非自愿或违法内容。</p></div>';
    return out;
  }
  function bindCompanion(){
    if($('rlSave'))$('rlSave').onclick=async function(){var button=this;button.disabled=true;try{if($('rlAdult').checked&&data.settings.realism?.adultMode!==true&&!await askConfirm('成人向私密表达仅限号主私聊、双方自愿的成年人角色扮演；不涉及未成年人、真实他人、非自愿或违法内容。确认开启？'))return;await api('POST','/im-bridge/settings',{realism:{enabled:$('rlEnabled').checked,naturalEvidence:$('rlNaturalMedia').checked,strictMedia:$('rlStrictMedia').checked,...optionalSetting('rlUnlimited','unlimitedProactive','checked'),adultMode:$('rlAdult').checked,safety:{payment:$('rlPay').checked,...optionalSetting('rlPhone','phone','checked'),privacy:$('rlPrivacy').checked,coercion:$('rlCoercion').checked}}});await load();toast('拟真设置已保存，下一轮生效');}catch(error){toast('保存失败：'+error.message);}finally{if(button.isConnected)button.disabled=false;}};
    if($('careSave'))$('careSave').onclick=async function(){if(featureData?.expressionRevision!=='20261025-expression-v1')return toast('请完整退出并重新打开DSH后再保存表达设置');var button=this;button.disabled=true;try{await api('POST','/im-bridge/settings',{companion:{enabled:$('careEnabled').checked,continuity:$('careContinuity').checked,respectPauses:$('carePauses').checked,waitMode:$('careWait').value,...optionalSetting('careExpression','expressionMode','value'),...optionalSetting('careCasual','casualInitiative','checked'),...optionalSetting('careBubbles','maxBubbles','number'),...optionalSetting('careChars','maxReplyChars','number'),allowRepetition:$('careRepeat').checked}});await load();toast('相处方式已保存，下一轮生效');}catch(error){toast('保存失败：'+error.message);}finally{if(button.isConnected)button.disabled=false;}};
  }

  var lifePersona='',calendarSelection='',hubSelection='',hubPreview=null,hubSearchResult='';
  function personaLabel(id){var p=(data.settings.personae||[]).filter(p=>p.id===id)[0];return p?.name||({whale:'大米鲸鱼娘',legacy:'旧记录（人设未标记）',config:'自我（空卡）'}[id]||id);}
  function calendarReady(){return ['20261025-calendar-v1','20261025-calendar-v2'].includes(featureData?.calendar?.revision);}
  function minuteLabel(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  function lifeMarkup(){
    if(!calendarReady())return '<div class="card"><h2>模拟人生</h2><p class="muted">完整退出并重新打开 DSH 后加载模拟日程与日历记忆。</p></div>';
    var cal=featureData.calendar,scopes=(cal.scopes||[]).filter(s=>s.meta.kind==='life');if(!scopes.some(s=>s.meta.personaId===lifePersona))lifePersona=scopes[0]?.meta.personaId||data.settings.activePersonaId||'whale';
    var scope=scopes.filter(s=>s.meta.personaId===lifePersona)[0],days=Object.entries(scope?.plans||{}).sort((a,b)=>b[0].localeCompare(a[0]));
    var c=data.settings.life||{},e=featureData.lifeExecution||{},statuses={planned:'计划中',queued:'等待执行',running:'正在执行',participating:'群参与中',ended:'群参与已结束',waiting_user:'等你决定',completed:'已完成',failed:'未能完成',unsupported:'已跳过实体活动',sleeping:'睡眠',resting:'醒着休息',expired:'时段已结束',budget:'今日任务额度已用完',interrupted:'已中断，不重放',incomplete:'未确认真实结果',cancelled:'已取消',paused:'进度已保存',needs_reconcile:'需要核对上次结果',user_request:'正在按你的请求安排'};
    var out='<div class="card"><div class="section-heading"><h2>人生与实际行动</h2><span class="tag">上海时间</span></div><p class="muted">日程安排真实数字日常和离线休息。画画会生成作品；浏览须进入具体内容。她是没有实体的数字角色：吃饭、洗澡、出行等实体活动跳过；QQ交流、听歌、浏览、创作和其他数字目标由DSH选择工具完成。等待事项和已保存进度继续保留；恢复前先观察，未知发送结果不重放；分享由她选择，联系人仍受允许名单约束。</p><div class="form-two"><label class="check-field"><input type="checkbox" id="lifeEnabled"'+(c.enabled!==false?' checked':'')+'>启用人生安排</label><label class="check-field"><input type="checkbox" id="lifeExecute"'+(c.execute!==false?' checked':'')+'>执行可做的数字活动</label><label class="check-field"><input type="checkbox" id="lifeSleep"'+(c.sleep!==false?' checked':'')+'>日程休息时过滤普通消息，当前明确请求可唤醒</label><label class="field">每日实际任务上限（0 为不限）<input id="lifeBudget" type="number" min="0" max="99" value="'+Number(c.maxTasksPerDay??8)+'"></label><label class="field">新日程前休息（分钟，0 为不限）<input id="lifeMinGap" type="number" min="0" max="1440" value="'+Number(c.minGapMinutes??0)+'"></label></div><p class="muted">实际任务可能调用已有付费接口；上限只控制日程任务，不限制聊天句数。普通允许对象的QQ交流可自主决定；仅实际付款需要逐次确认；B站评论遵守独立发布开关。</p><div class="btnrow"><button class="primary" id="lifeSave">保存人生设置</button><button id="lifeRun">检查当前任务</button></div><label class="field">查看角色<select id="lifePersona">'+scopes.map(s=>'<option value="'+esc(s.meta.personaId)+'"'+(s.meta.personaId===lifePersona?' selected':'')+'>'+esc(personaLabel(s.meta.personaId))+'</option>').join('')+'</select></label><button class="small" id="lifePlan"'+(c.enabled===false?' disabled':'')+'>补齐当前时段</button><p class="muted">已有日程保持连续；后续时段根据真实可用能力安排。当前：'+esc(e.scene?.activity||'尚无当前日程')+' · '+esc(e.sleeping?'睡眠中':'醒着')+'</p>';
    if(e.pending){out+='<div class="notice"><b>需要你决定</b><p>'+esc(e.pending.question.question)+'</p><details><summary>具体操作与目标</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(e.pending.question.details||{},null,2))+'</pre></details><label class="field">补充意见<input id="lifeAnswerText" maxlength="1000" placeholder="例如：同意这笔付款；或先不要买"></label><div class="btnrow"><button data-life-answer="同意" data-life-q="'+esc(e.pending.question.id)+'">同意这件事</button><button data-life-answer="拒绝" data-life-q="'+esc(e.pending.question.id)+'">拒绝</button></div><p class="muted">也可在本人 QQ 私聊中回复“同意”或“拒绝”。决定只适用于这个问题。</p></div>';}
    out+='<details><summary>最近执行记录</summary>'+(e.jobs||[]).slice(0,12).map(j=>'<div class="msg"><b>'+esc(j.scene?.activity||j.kind)+'</b> · '+esc(statuses[j.status]||j.status)+'<p>'+esc(j.note||j.reason||'')+'</p>'+(j.evidence||[]).filter(x=>x.ok&&x.substantive).map(x=>'<div class="muted">'+esc(x.coverage||x.kind)+(x.file?' · 作品：'+esc(x.file):'')+(x.url?' · '+esc(x.url):'')+'</div>').join('')+'</div>').join('')+'</details>';
    if(scope?.status&&['failed','pending','running'].includes(scope.status.state))out+='<div class="notice" role="status">'+esc(({failed:'未完成：',pending:'等待处理：',running:'正在处理：'})[scope.status.state])+esc(scope.status.reason||(scope.status.state==='running'?'正在规划或整理，原有日程保留。':'日程待补处理，原有记录保留。'))+(scope.status.errorDetail?'<details><summary>具体原因</summary><p style="overflow-wrap:anywhere">'+esc(scope.status.errorDetail)+'</p></details>':'')+'</div>';
    if(!days.length)out+='<div class="empty">尚无当前日程。早间 06:00、午后 12:00、晚间 18:00 后的维护或下一轮聊天会补齐当前时段。</div>';
    days.forEach(function(pair){out+='<h3 style="margin-top:16px">'+esc(pair[0])+' · 模拟日程</h3>';mergeDisplaySlots(Object.values(pair[1]).flatMap(function(part){return part.slots||[];}).sort(function(a,b){return a.start-b.start;})).forEach(function(slot){var current=pair[0]===cal.now?.day&&slot.start<=cal.now.minute&&slot.end>cal.now.minute;out+='<div class="row"><span><b>'+esc(minuteLabel(slot.start)+'–'+minuteLabel(slot.end))+'</b> '+esc(slot.activity)+(slot.mood?'<small class="muted" style="display:block">'+esc(slot.mood)+'</small>':'')+'</span><span class="tag">'+(current?'计划 · 当前':'计划')+'</span>'+(LIFE_CAPABILITY_LABELS[slot.taskKind]?'<span class="tag">'+esc(LIFE_CAPABILITY_LABELS[slot.taskKind])+'</span>':'')+'</div>';});});return out+'</div>';
  }
  function calendarReport(r){if(r.error||r.skipped)return r.error||r.reason||'已有任务正在运行';if(r.memoryEnabled===false)return '记忆已关闭，未归档';return '导入 '+Number(r.imported||0)+' 条历史资料 · 归档 '+Number(r.days||0)+' 日 / '+Number(r.months||0)+' 月 / '+Number(r.years||0)+' 年 · 重新提炼 '+Number(r.refined||0)+' 份摘记 · 失败 '+Number(r.failed||0)+' 项 · 剩余 '+Number(r.remainingDates||0)+' 个已结束日期 · 今天 '+Number(r.todayRows||0)+' 条等待日终'+(r.unattributed?' · '+r.unattributed+' 条旧记录缺少人设标记，仅保留原聊天，不写入当前人设记忆':'')+(r.failures?.[0]?.reason?' · '+r.failures[0].reason:'')+(r.limitReached?' · 本批达到上限，可继续补处理':'');}
  var calendarBrowse={level:'days',period:''};
  function calendarPeriod(value,level=calendarBrowse.level){return String(value||'').slice(0,level==='years'?4:level==='months'?7:10);}
  function calendarMove(direction){
    var level=calendarBrowse.level,value=calendarBrowse.period,parts=value.split('-').map(Number),date=new Date(Date.UTC(parts[0],(parts[1]||1)-1,parts[2]||1));
    if(level==='years')date.setUTCFullYear(date.getUTCFullYear()+direction);else if(level==='months')date.setUTCMonth(date.getUTCMonth()+direction);else date.setUTCDate(date.getUTCDate()+direction);
    calendarBrowse.period=calendarPeriod(date.toISOString().slice(0,10));renderPane();
  }
  function calendarMemoryMarkup(){
    if(!calendarReady())return '<section class="card"><h2>记忆日历</h2><p class="muted">记忆正在准备，稍后刷新即可查看。</p></section>';
    var cal=featureData.calendar,scopes=(cal.scopes||[]).filter(s=>!s.meta.accountId||!data.settings.activeAccountId||s.meta.accountId===data.settings.activeAccountId),key=s=>encodeURIComponent(JSON.stringify([s.meta.key,s.meta.personaId]));
    if(!scopes.some(s=>key(s)===calendarSelection))calendarSelection=key(scopes.find(s=>s.meta.key===companionPanelKey())||scopes.find(s=>s.meta.kind==='chat')||scopes[0]||{meta:{key:'',personaId:''}});
    var scope=scopes.find(s=>key(s)===calendarSelection),level=calendarBrowse.level;
    var rows=scopes.flatMap(s=>(s[level]||[]).map(record=>({record,scope:s}))).sort((a,b)=>b.record.start.localeCompare(a.record.start));
    if(!calendarBrowse.period)calendarBrowse.period=calendarPeriod(rows[0]?.record.start||cal.now?.day||new Date().toISOString().slice(0,10));
    var selected=calendarPeriod(calendarBrowse.period),records=rows.filter(x=>calendarPeriod(x.record.start)===selected),pending=scopes.reduce((n,s)=>n+(s.pendingDays||[]).filter(d=>calendarPeriod(d.date)===selected).reduce((sum,d)=>sum+d.rows,0),0);
    var length=level==='years'?4:level==='months'?7:10,periods=[...new Set(rows.map(x=>calendarPeriod(x.record.start)))];
    var out='<section class="card memory-calendar"><div class="section-heading"><div><h2>记忆日历</h2><p class="muted">选一个日期，翻翻那时的事。</p></div><div class="memory-period-tabs" role="group" aria-label="记忆时间尺度">'+[['days','日'],['months','月'],['years','年']].map(([id,label])=>'<button data-ct-level="'+id+'" aria-pressed="'+(level===id)+'">'+label+'</button>').join('')+'</div></div><div class="memory-date-bar"><button id="ctPrevious" aria-label="上一个'+({days:'日期',months:'月份',years:'年份'})[level]+'">‹</button><label class="field"><span class="sr-only">选择'+({days:'日期',months:'月份',years:'年份'})[level]+'</span><input id="ctDate" type="'+({days:'date',months:'month',years:'number'})[level]+'" value="'+esc(selected)+'"'+(level==='years'?' min="1900" max="2200" step="1"':'')+'></label><button id="ctNext" aria-label="下一个'+({days:'日期',months:'月份',years:'年份'})[level]+'">›</button><button id="ctLatest" class="ghost small">最近有记录</button></div>';
    out+='<div class="memory-date-picks" aria-label="已有记忆的日期">'+periods.slice(0,8).map(p=>'<button class="small" data-ct-period="'+esc(p)+'" aria-pressed="'+(selected===p)+'">'+esc(p)+'</button>').join('')+'</div><div id="ctRecords" aria-live="polite">';
    records.forEach(({record:r,scope:s})=>{
      var source=(s.meta.kind==='life'?'她的数字日常':notesLabel(s.meta.key))+' · '+personaLabel(s.meta.personaId);
      out+='<article class="calendar-entry"><header><time>'+esc(r.start+(r.end!==r.start?' — '+r.end:''))+'</time><small>'+esc(source)+'</small></header>'+(r.events||[]).map(e=>'<p>'+esc((e.speakerName?e.speakerName+'：':'')+e.text)+'</p>').join('')+'<details class="calendar-source"><summary>查看依据'+(r.partial?' · 部分资料':'')+'</summary>'+(r.events||[]).filter(e=>e.quote).map(e=>'<blockquote>'+esc(e.quote)+'</blockquote>').join('')+'<small>'+Number(r.sourceCount||0)+' 条来源</small><div><button class="danger small" data-ct-delete="'+esc(r.id)+'" data-ct-owner="'+esc(key(s))+'">删除这份归档</button></div></details></article>';
    });
    if(!records.length)out+='<div class="empty-soft">'+(pending?'这一天的聊天还在积累，整理完成后会出现在这里。':'这段时间还没有整理好的记忆。可以换个日期看看。')+'</div>';
    out+='</div><details class="calendar-manage"><summary>整理与管理</summary><p class="muted">每天自动整理昨日记忆，月末与年末汇总。查看不会触发整理，原始资料保留。</p>';
    if(cal.lastRun)out+='<p class="muted" role="status">'+esc(calendarReport(cal.lastRun))+'</p>';
    if(cal.error)out+='<p role="alert">'+esc(cal.error)+'</p>';
    out+='<label class="field">管理范围<select id="ctScope">'+scopes.map(s=>'<option value="'+esc(key(s))+'"'+(key(s)===calendarSelection?' selected':'')+'>'+esc((s.meta.kind==='life'?'她的数字日常':notesLabel(s.meta.key))+' · '+personaLabel(s.meta.personaId))+'</option>').join('')+'</select></label><div class="btnrow"><button id="ctRun"'+(!scope?' disabled':'')+'>整理这个范围</button><button id="ctRunAll">整理全部</button><button class="danger small" id="ctClear"'+(!scope?' disabled':'')+'>清空这个范围</button></div>';
    if(scope?.anchors?.length)out+='<details><summary>长期记住的事</summary>'+scope.anchors.map(a=>'<div class="row"><span>'+esc((a.source?.speakerName?a.source.speakerName+'：':'')+a.text)+'</span><button class="danger small" data-ct-anchor="'+esc(a.id)+'">删除</button></div>').join('')+'</details>';
    return out+'</details></section>';
  }

  function walletAmountText(account){
    var rows=(account.entries||[]).filter(function(e){return account.provider!=='runninghub'||e.kind!=='coins';}).map(function(e){return (e.label?e.label+'：':'')+e.amount+' '+e.currency+(e.applies===true?'（用于余额判断）':e.applies===false?'（参考）':'');});
    if(account.provider==='runninghub'&&!(account.entries||[]).some(function(e){return e.kind==='points';}))rows.unshift('新版积分：接口未返回（不代表 0）');
    return rows.join(' / ')||({free:'免费 / 本地',unsupported:'暂不可查询',unknown:'未知',error:'查询失败'})[account.status]||'未知';
  }
  function walletStateText(account){
    if(account.stale)return '旧数据';
    if(account.provider==='runninghub'&&account.status==='ok'&&account.billingConfirmed===false)return account.billingSource==='unknown'?'扣费来源待确认':'所选余额未返回';
    return ({normal:'正常',low:'偏低',empty:'已耗尽',free:'免费',unknown:'未知'})[account.state]||'未知';
  }
  function walletMarkup(){
    var w=featureData?.wallet,c=data.settings.wallet||{},accounts=w?.accounts||[];
    var out='<section class="card" style="grid-column:1/-1"><div class="section-heading"><h2>账户余额与角色感知</h2><button class="small" id="wRefresh">刷新余额</button></div><p class="muted">显示已接入的生图、语音和对话账户。查询失败或暂不可查询不会记成零；今日预估花费与剩余余额分开。</p>';
    if(w&&w.revision!=='20261111-provider-wallet-v2')out+='<p class="banner" role="status">当前后端还是旧余额逻辑。请重载 QQ 桥接插件后点“刷新余额”，才能按当前服务读取余额；只刷新网页不会载入后端修改。</p>';
    if(!accounts.length)out+='<div class="empty">余额尚未查询，可点刷新；聊天中及后台也会定期更新。</div>';
    accounts.forEach(a=>{var amount=walletAmountText(a);out+='<div class="row"><span><b>'+esc(a.label)+' · '+esc(a.provider)+'</b><small class="muted" style="display:block">'+esc(a.reason||'')+(a.updatedAt?' · '+esc(new Date(a.updatedAt).toLocaleTimeString()):'')+'</small></span><span>'+esc(amount||({free:'免费 / 本地',unsupported:'暂不可查询',unknown:'未知',error:'查询失败'})[a.status]||'未知')+' <span class="tag">'+esc(walletStateText(a))+'</span></span></div>';});
    out+='<div class="form-two"><label class="check-field"><input type="checkbox" id="wEnabled"'+(c.enabled!==false?' checked':'')+'>让她感知账户余额</label><label class="check-field"><input type="checkbox" id="wReactions"'+(c.reactions!==false?' checked':'')+'>低余额、耗尽和恢复时允许情绪反应</label><label class="field">金额低余额线<input id="wMoney" type="number" min="0" max="100000" value="'+Number(c.lowMoney??5)+'"></label><label class="field">配额低余额线<input id="wCoins" type="number" min="0" max="1000000" value="'+Number(c.lowCoins??100)+'"></label><label class="field">积分低余额线<input id="wPoints" type="number" min="0" max="1000000" step="0.001" value="'+Number(c.lowPoints??100)+'"></label><label class="field">RunningHub 按哪种余额判断<select id="wRhBilling">'+[['auto','待确认：先显示，不判断耗尽'],['points','按新版积分判断（自己确认 Key 使用积分时选）'],['money','按企业 API 钱包判断']].map(function(o){return '<option value="'+o[0]+'"'+((c.runninghubBillingSource||'auto')===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label></div><p class="muted">余额跟随实际使用的连接。其他服务可在“连接与搭配”配置其余额查询接口、金额字段和单位；接口未提供或未配置时显示未知/暂不可查询。不同服务、金额、积分和配额分别展示，不相加、不猜汇率。RunningHub 用户可按 Key 实际扣费来源选择积分或 API 钱包。</p><button class="primary" id="wSave">保存余额感知</button><p class="muted">金额按账户返回的币种显示；美元低余额线最多为 1 美元。余额金额只注入号主私聊。情绪反应随当前人设表达，不会因此另起消息刷屏。</p></section>';return out;
  }
  function bindCalendarWallet(){
    async function lifeAction(body){try{await api('POST','/im-bridge/life-execution',body);await load();toast('日程状态已更新');}catch(e){toast(e.message);}}
    if($('lifeWake'))$('lifeWake').onclick=()=>lifeAction({action:'wake'});
    if($('lifeRun'))$('lifeRun').onclick=()=>lifeAction({action:'run'});
    document.querySelectorAll('[data-life-answer]').forEach(b=>{b.onclick=()=>lifeAction({action:'answer',id:b.dataset.lifeQ,answer:b.dataset.lifeAnswer+($('lifeAnswerText')?.value?'：'+$('lifeAnswerText').value:'')});});
    if($('lifePersona'))$('lifePersona').onchange=function(){lifePersona=this.value;renderPane();};
    if($('lifeSave'))$('lifeSave').onclick=async function(){try{await api('POST','/im-bridge/settings',{life:{enabled:$('lifeEnabled').checked,execute:$('lifeExecute').checked,sleep:$('lifeSleep').checked,...optionalSetting('lifeBudget','maxTasksPerDay','number'),...optionalSetting('lifeMinGap','minGapMinutes','number')}});await load();toast('模拟人生设置已保存');}catch(e){toast(e.message);}};
    if($('lifePlan'))$('lifePlan').onclick=async function(){this.disabled=true;try{await api('POST','/im-bridge/features/calendar',{action:'plan',personaId:lifePersona});await load();toast('已检查当前时段，请查看日程与处理状态');}catch(e){toast(e.message);if(this.isConnected)this.disabled=false;}};
    document.querySelectorAll('[data-ct-level]').forEach(b=>b.onclick=()=>{calendarBrowse.level=b.dataset.ctLevel;calendarBrowse.period='';renderPane();});
    document.querySelectorAll('[data-ct-period]').forEach(b=>b.onclick=()=>{calendarBrowse.period=b.dataset.ctPeriod;renderPane();});
    if($('ctDate'))$('ctDate').onchange=function(){if(!this.checkValidity()||!this.value)return;calendarBrowse.period=this.value;renderPane();};
    if($('ctPrevious'))$('ctPrevious').onclick=()=>calendarMove(-1);
    if($('ctNext'))$('ctNext').onclick=()=>calendarMove(1);
    if($('ctLatest'))$('ctLatest').onclick=()=>{calendarBrowse.period='';renderPane();};
    if($('ctScope'))$('ctScope').onchange=function(){calendarSelection=this.value;renderPane();};
    async function calendarEdit(action,id,sourceKey=calendarSelection){var s=(featureData.calendar.scopes||[]).filter(s=>encodeURIComponent(JSON.stringify([s.meta.key,s.meta.personaId]))===sourceKey)[0];if(!s)return;if(!await askConfirm(action==='clear'?'清空这个账号、联系人和人设范围的日历记忆及未归档日记账？旧聊天不会自动重新摄入。':'删除这条日历记忆？'))return;await api('POST','/im-bridge/features/calendar',{action,id,key:s.meta.key,personaId:s.meta.personaId});await load();toast('日历记忆已更新');}
    async function runCalendar(all,button){button.disabled=true;try{var scope=(featureData.calendar.scopes||[]).find(s=>encodeURIComponent(JSON.stringify([s.meta.key,s.meta.personaId]))===calendarSelection),body={action:'run'};if(!all&&scope){body.key=scope.meta.key;body.personaId=scope.meta.personaId;}var result=await api('POST','/im-bridge/features/calendar',body);await load();toast(calendarReport(result.result||{}));}catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}}
    if($('ctRun'))$('ctRun').onclick=function(){runCalendar(false,this);};
    if($('ctRunAll'))$('ctRunAll').onclick=function(){runCalendar(true,this);};
    if($('ctClear'))$('ctClear').onclick=()=>calendarEdit('clear','').catch(e=>toast(e.message));
    document.querySelectorAll('[data-ct-delete]').forEach(b=>{b.onclick=()=>calendarEdit('delete',b.getAttribute('data-ct-delete'),b.dataset.ctOwner||calendarSelection).catch(e=>toast(e.message));});
    document.querySelectorAll('[data-ct-anchor]').forEach(b=>{b.onclick=()=>calendarEdit('delete-anchor',b.getAttribute('data-ct-anchor')).catch(e=>toast(e.message));});
    if($('wRefresh'))$('wRefresh').onclick=async function(){this.disabled=true;try{await api('POST','/im-bridge/features/wallet',{});await load();toast('余额已刷新');}catch(e){toast(e.message);if(this.isConnected)this.disabled=false;}};
    if($('wSave'))$('wSave').onclick=async function(){try{await api('POST','/im-bridge/settings',{wallet:{enabled:$('wEnabled').checked,reactions:$('wReactions').checked,lowMoney:Number($('wMoney').value),lowCoins:Number($('wCoins').value),lowPoints:Number($('wPoints').value),runninghubBillingSource:$('wRhBilling').value}});await api('POST','/im-bridge/features/wallet',{});await load();toast('余额感知已保存并刷新');}catch(e){toast(e.message);}};
  }
  function sharedMemoryMarkup(){
    var keys=(featureData?.knownChats||[]).filter(k=>/^(private|group):\d+$/.test(k));
    if(!keys.includes(hubSelection)){hubSelection=keys.includes(featureData?.memoryHub?.meta?.key)?featureData.memoryHub.meta.key:keys[0]||'';hubPreview=null;}
    var m=hubPreview||featureData?.memoryHub;
    var out='<div class="card"><h2>共享经历与个人记忆</h2><p class="muted">同一 QQ 账号、同一对话的用户事实和历史资料可跨人设查阅，原话保留说话者与来源角色。每个人设的主观反思、关系称呼和未完事项分别保存；换人设仍会新建聊天上下文。同一人设的核心性格、自身实际经历与通用知识跨场合连续；私人原文和关系细节按来源保留。</p><label class="field">查看对话<select id="hubScope">'+keys.map(k=>'<option value="'+esc(k)+'"'+(k===hubSelection?' selected':'')+'>'+esc(notesLabel(k))+'</option>').join('')+'</select></label>';
    if(!m?.available)return out+'<p class="muted">开启记忆并选中已允许的对话后，可查看本地记忆。</p></div>';
    out+='<p class="muted">原始记录 '+Number(m.sources||0)+' 条 · 已确认事实 '+(m.facts||[]).length+' 条 · 当前人设摘记 '+(m.diaries||[]).length+' 篇</p><p class="muted">'+esc(m.retrieval)+'</p>';
    if(m.ownReflection)out+='<details><summary>当前人设的主观反思</summary><p>'+esc(m.ownReflection.text)+'</p><small>这是角色理解，不是用户事实。</small></details>';
    (m.diaries||[]).slice().reverse().forEach(d=>{out+='<details><summary>'+esc(d.day)+' · 当前人设互动摘记</summary><p>'+esc(d.text)+'</p><small>来源 '+d.sourceIds.length+' 条</small></details>';});
    if(m.facts?.length){out+='<details><summary>本对话共享的用户事实</summary>';m.facts.forEach(f=>{out+='<div class="row"><span>'+esc((f.source?.speakerName?f.source.speakerName+'：':'')+f.text)+'</span><button class="danger small" data-hub-forget="'+esc(f.id)+'">停止召回</button></div>';});out+='</details>';}
    out+='<label class="field">试查记忆<input id="hubQuery" placeholder="例如：以前聊过的画册"></label><div class="btnrow"><button id="hubSearch">检索来源</button><button id="hubConsolidate" class="small">整理当前人设记忆</button><button id="hubClear" class="danger small">停止召回本对话的已有记忆</button></div><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:340px;overflow:auto">'+esc(hubSearchResult)+'</pre><p class="muted">整理结果和来源记录保存在本地，不向 QQ 发送维护回执。停止召回会在同步时保留标记，原始记录留作查证。</p></div>';return out;
  }
  function bindSharedMemory(){
    async function act(action,extra){var r=await api('POST','/im-bridge/features/memory-hub',Object.assign({action,key:hubSelection},extra||{}));hubPreview=r.memoryHub;if(action==='search')hubSearchResult=r.result?.text||'未找到相关来源';renderPane();}
    if($('hubScope'))$('hubScope').onchange=function(){hubSelection=this.value;hubSearchResult='';act('snapshot').catch(e=>toast(e.message));};
    if($('hubSearch'))$('hubSearch').onclick=()=>act('search',{query:$('hubQuery').value}).catch(e=>toast(e.message));
    if($('hubConsolidate'))$('hubConsolidate').onclick=async function(){this.disabled=true;try{await act('consolidate');toast('整理结束，可查看反思与来源');}catch(e){toast(e.message);if(this.isConnected)this.disabled=false;}};
    if($('hubClear'))$('hubClear').onclick=async()=>{if(await askConfirm('停止召回此账号、此对话所有人设的已有共享记忆与个人摘记？原始记录保留，新消息将重新积累；其他联系人不受影响。'))act('clear').catch(e=>toast(e.message));};
    document.querySelectorAll('[data-hub-forget]').forEach(b=>{b.onclick=()=>act('forget',{id:b.dataset.hubForget}).catch(e=>toast(e.message));});
  }
  function viewMemoryBasic(){
    var mem=data.settings.memory||{};
    return '<div class="card"><h2>自动整理规则</h2><p class="muted">原始消息单独留存，可靠自述形成共享事实；按问题检索少量来源，当前人设保留自己的生活摘要与反思。日终、月终、年终归档继续保留，不随机遗忘或自动删除原文。</p><div class="row"><span>启用记忆</span><button id="memToggle" class="small">'+(mem.enabled!==false?'已开':'已关')+'</button></div><label class="field">对话记忆字数预算<input id="memChars" type="number" min="120" max="2000" value="'+Number(mem.maxChars||1200)+'"></label><button id="memSave" class="primary">保存</button></div><div class="card"><h2>记忆文件位置</h2><p class="muted">同一人设的连续记忆、日记与来源位于 memory-hub，历史归档位于 calendar-memory，歌曲资料位于 singing。一键同步按记忆目录保留资料，迁移前请先备份。</p><input id="memDir" value="'+esc(data.settings.memoryDir||'')+'" placeholder="留空使用默认目录"><button id="memDirSave">迁移到该目录</button></div>';
  }

  function viewStorage() {
    var out = "";
    out += '<div class="card"><h2>缓存与占用</h2>' +
      '<div class="muted" style="margin-bottom:8px">图片、语音、视频、波形图、设备截图和画本统一跟随此目录。记忆和设置另行保存，收藏与作品不会自动删除。</div>' +
      '<div class="kv"><span>当前路径</span><code class="path">' + esc((storage && storage.cacheDir) || (data.status && data.status.cacheDir) || '') + '</code></div>' +
      '<div class="row"><span>占用</span><span class="muted">表情 ' + fmtSize(storage && storage.sizes && storage.sizes.sticker) +
      ' · 语音 ' + fmtSize(storage && storage.sizes && storage.sizes.voice) +
      ' · 监听图 ' + fmtSize(storage && storage.sizes && storage.sizes.messages) +
      ' · 日志 ' + fmtSize(storage && storage.sizes && storage.sizes.log) + '</span></div>' +
      '<input id="cacheInput" placeholder="新路径，例如 D:/dsh-cache/im-bridge" style="margin-top:8px">' +
      '<div class="btnrow" style="margin-top:8px"><button class="primary" id="cacheMove">迁移到这个路径</button>' +
      '<button id="cacheDefault">恢复默认</button>' +
      '<button id="cachePreview">看看能清理多少</button><button class="danger" id="cacheClean">按保留策略清理临时文件</button></div>'+
      '<label class="check-field"><input id="cacheAuto" type="checkbox"'+(storage?.retention?.enabled!==false?' checked':'')+'>自动整理临时媒体</label><div class="row"><label class="field">保留天数<input id="cacheDays" type="number" min="1" max="365" value="'+Number(storage?.retention?.days||7)+'"></label><label class="field">临时文件上限（MB）<input id="cacheMax" type="number" min="256" value="'+Number(storage?.retention?.maxMB||4096)+'"></label></div><button id="cachePolicy">保存整理规则</button><label class="field" style="margin-top:10px">我自己的文件上限（MB）<input id="mySpaceMax" type="number" min="50" max="4096" value="'+Number(data.settings.mySpaceMaxMB||1024)+'"></label><button id="mySpaceSave">保存上限</button><p class="muted">笔记、画、存下的音频视频都算在内；超过上限会从最旧的开始收，笔记不动。</p><p class="muted">当前媒体共 '+fmtSize(storage?.managed?.totalBytes||0)+'；最近一小时及正在发送的文件保留。普通生成图按保留策略整理；喜欢的图片请加入相册。收藏表情、相册、画本、作品与歌曲示范不自动清理。</p>' +
      '<div id="cacheOut" class="muted" style="margin-top:8px"></div></div>';
    out += '<div class="card"><h2>诊断</h2><p class="muted">排错时再打开；平时放在这里，不占主菜单。</p><div class="btnrow"><button data-go="logs">运行日志</button><button data-go="devices">设备与连接</button></div></div>';
    return out;
  }

  /** 只剩语音和素材相关的设置，挂到「素材」页。 */
  var VOICE_PACK_MOODS=[{id:'auto',name:'跟随内容'},{id:'natural',name:'自然'},{id:'happy',name:'开心'},{id:'gentle',name:'轻柔 / 安慰'},{id:'sad',name:'低落'},{id:'surprised',name:'惊喜'},{id:'serious',name:'认真'},{id:'tender',name:'撒娇 / 黏'},{id:'shy',name:'害羞'},{id:'teasing',name:'挑逗'},{id:'whisper',name:'耳语 / 小声'},{id:'tired',name:'慵懒 / 累'},{id:'excited',name:'兴奋'},{id:'angry',name:'有点气'}];
  /* MiniMax 可选音色。clonezh001 是用 1.mp3 快速复刻出来的私有音色（7 天内不用会被官方回收）。 */
  var MINI_VOICE_PRESETS=[['female-tianmei','甜美女性'],['Chinese (Mandarin)_Warm_Girl','温暖少女'],['Chinese (Mandarin)_Soft_Girl','柔和少女'],['clonezh001','复刻音色 · 1.mp3（我的）']];
  function miniVoiceOptions(current){
    var id=String(current||'female-tianmei'),list=MINI_VOICE_PRESETS.slice();
    if(!list.some(function(item){return item[0]===id;}))list.unshift([id,'自定义 · '+id]);
    return list.map(function(item){return '<option value="'+esc(item[0])+'"'+(id===item[0]?' selected':'')+'>'+esc(item[1])+'</option>';}).join('');
  }
  function viewMusicCard(){return '<div class="card"><h2>音乐理解</h2><p class="muted">直接在QQ分享网易云歌曲即可获取可播放音频，并把真实波形图、频谱图和节奏等测量交给模型理解。音频留在本机；图谱会交给当前对话模型。试听与整曲分开说明，不能取得音频时不假装听过。</p><label class="field">网易云歌曲链接或音频直链<input id="musicUrl" placeholder="https://music.163.com/#/song?id=…"></label><button id="musicAnalyze">分析音乐（不发QQ）</button><div id="musicResult" role="status" style="overflow-wrap:anywhere"></div></div>';}
  function bindMusicCard(){if($('musicAnalyze'))$('musicAnalyze').onclick=async function(){var button=this,result=$('musicResult');button.disabled=true;result.textContent='正在获取真实音频、生成图谱并分析…';try{var data=await api('POST','/im-bridge/features/music',{url:$('musicUrl').value,interpret:true}),r=data.result||{};result.innerHTML='<p>'+esc(r.title||'音频')+' · '+esc(r.author||'')+'</p><p>'+esc(r.coverage||'')+'</p><p>'+esc(data.interpretation||'')+'</p>'+(r.charts||[]).map(c=>'<details><summary>'+esc(c.kind==='waveform'?'真实波形图':'真实频谱图')+'</summary><img style="width:100%;height:auto" src="'+esc(c.url)+'" alt="'+esc(c.kind)+'"></details>').join('');}catch(e){result.textContent=e.message;}finally{button.disabled=false;}};}
  function voiceGuideCard(){
    return '<section class="card guide"><h2>第一次配语音？从这里开始</h2><p>推荐 BreezeBlue。先准备 API Key 和音色 ID，跟着教程填进正确的位置，保存后亲自试听。</p><div class="btnrow"><button class="primary" type="button" data-onb-track="voice">手把手配置语音</button><a class="button-link" href="'+ONBOARD_RECOMMENDATIONS.voice+'" target="_blank" rel="noopener noreferrer">BreezeBlue 推荐链接 ↗</a></div><p class="muted">作者推荐码：BDD9YP。注册网站与 API 地址不同，不要把推荐链接填进接口地址。</p><details><summary>配置顺序与官方说明</summary><ol><li>在 BreezeBlue 注册，进入开发者控制台复制 API Key。</li><li>选用或创建可通过 API 使用的音色，复制真实 Voice ID。</li><li>语音服务选 Breeze TTS 2，接入方式选官方 API。</li><li>分别填写 Key、音色 ID；官方地址为 https://api.breeze.blue，模型 breeze-tts-2，语言 zh。</li><li>保存设置，再手动试听；可能计费，只在本页播放，不自动发 QQ。</li><li>要在 QQ 使用，再开启允许她发语音。</li></ol><a href="https://docs.breezeblue.ai/api-reference/text-to-speech/stream-text-to-speech" target="_blank" rel="noopener noreferrer">Breeze 官方 API 文档</a></details></section>';
  }
  function viewVoiceCard() {
    var v=data.settings.voice||{},mini=v.minimax||{};
    var moods=VOICE_PACK_MOODS;
    return voiceGuideCard()+viewMusicCard()+'<div class="card"><h2>语音参数</h2><p class="muted">Edge 和依赖它的内置免费音色已移除。这里保留现有服务参数；通用语音 API 可在“连接与搭配”填写地址、密钥、任意模型与音色，并点击“用于语音”。</p><button data-go="services">管理语音来源</button><div class="row"><span>允许她发语音</span><button class="small" id="vToggle">'+(v.enabled?'已开':'已关')+'</button></div>'+
      '<label class="field" style="margin-top:16px">语音服务<select id="vEngine">'+[['none','暂未选择'],['localai','本地语音服务'],['minimax','MiniMax 情绪增强'],['breeze','Breeze TTS 2'],['runninghub','RunningHub 语音工作流'],['custom','自定义 HTTP TTS']].filter(function(e){return !mobileApiOnly()||e[0]!=='localai';}).map(function(e){return '<option value="'+e[0]+'"'+(v.engine===e[0]?' selected':'')+'>'+e[1]+'</option>';}).join('')+'</select></label>'+
      '<p class="muted">本地服务地址和音色在本地模型与工作流页配置；通用 API 连接的模型、密钥与音色在连接与搭配页配置。</p>'+
      '<label class="field">语气 / 韵律<select id="vMood">'+moods.map(function(m){return '<option value="'+m.id+'"'+((v.emotion||'auto')===m.id?' selected':'')+'>'+esc(m.name)+'</option>';}).join('')+'</select></label>'+
      '<div id="vMiniSection"><h3>可选情绪增强</h3><p class="muted">使用 MiniMax 官方音色或自己复刻的音色；需独立 API Key，试听和生成均可能计费，仅选用此服务时调用。</p><label class="field">MiniMax API Key<input type="password" autocomplete="off" id="vMiniKey" placeholder="'+(mini.hasKey?'已保存；留空保留':'仅启用增强时需要')+'"></label><label class="field">增强音色<select id="vMiniVoice">'+miniVoiceOptions(mini.voiceId)+'</select></label><label class="field">模型<select id="vMiniModel">'+['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo'].map(function(m){return '<option value="'+m+'"'+((mini.model||'speech-2.8-hd')===m?' selected':'')+'>'+m+'</option>';}).join('')+'</select></label></div>'+
      '<div id="vBreezeSection"><h3>Breeze TTS 2</h3><p class="muted">开源权重模型，官方 API 按字符计费；也可以指向自建的 vLLM-Omni（OpenAI 兼容 /v1/audio/speech）。音色 ID 在 breeze.blue 应用里设计或克隆后复制；自建时用 S0–S9 预置音色，或填自己训练/克隆的音色。</p><label class="field">接入方式<select id="vBreezeMode"><option value="official"'+((v.breeze?.mode||'official')==='official'?' selected':'')+'>Breeze 官方 API（api.breeze.blue）</option><option value="openai"'+(v.breeze?.mode==='openai'?' selected':'')+'>自建 vLLM-Omni（OpenAI 兼容）</option></select></label><label class="field">接口地址<input id="vBreezeBase" value="'+esc(v.breeze?.baseUrl||'')+'" placeholder="'+(v.breeze?.mode==='openai'?'http://127.0.0.1:8091':'https://api.breeze.blue')+'"></label><label class="field">API Key<input type="password" autocomplete="off" id="vBreezeKey" placeholder="'+((v.breeze&&v.breeze.hasKey)?'已保存；留空保留':'官方模式必填，自建可留空')+'"></label><label class="field">音色 ID<input id="vBreezeVoice" value="'+esc(v.breeze?.voiceId||'')+'" placeholder="voc_xxx（官方）/ S0（自建预置）"></label><label class="field">模型<input id="vBreezeModel" value="'+esc(v.breeze?.model||'')+'" placeholder="breeze-tts-2 / BreezeBlue/Breeze-TTS-2"></label><label class="field">语言代码<input id="vBreezeLang" value="'+esc(v.breeze?.language||'zh')+'" placeholder="zh"></label><label class="field">音色 / 常用演绎方向（逐句语气自动补充）<input id="vBreezeInstructions" value="'+esc(v.breeze?.instructions||'')+'" placeholder="例如：保持清亮自然的当前音色"></label></div>'+
      '<details id="vLegacy"'+(v.engine==='custom'?' open':'')+'><summary>自定义服务</summary><label class="field">自定义 TTS 地址（{text} / {voice}）<input id="vCustomUrl" value="'+esc(v.customUrl||'')+'"></label><label class="field">自定义音色名<input id="vCustomVoice" value="'+esc(v.customVoice||'')+'"></label></details>'+
      operationContextMarkup('vContext')+'<button id="vSaveEngine" class="primary" style="margin-top:12px">保存语音设置</button><label class="field">试听方式<select id="vPerformance"><option value="speech">说话</option><option value="sing">RunningHub 唱歌</option></select><small class="muted">唱歌使用歌曲页中已保存的 RunningHub 工作流。翻唱素材与输出序号可在那里配置。</small></label><label class="field" style="margin-top:16px">试听文字<input id="vText" placeholder="例如：没关系呀，我在听，慢慢说就好。"></label><button id="vTest">试听当前设置</button><p class="muted">只在本页播放，不自动发给 QQ。选择情绪增强时将调用计费接口。</p><div id="vOut" role="status" style="margin-top:10px"></div>'+
      (v.lastError?'<div class="banner" style="margin-top:12px"><b>上次语音失败</b><p>'+esc(v.lastError)+'</p></div>':'')+'</div>';
  }

  var voiceStudioBusy=false;
  function voiceStudioSetBusy(value){voiceStudioBusy=value;['vSaveEngine','vTest'].forEach(function(id){if($(id))$(id).disabled=value;});Array.prototype.forEach.call(document.querySelectorAll('[data-usevoice]'),function(button){button.disabled=value;});}
  function voiceStudioInput(preset){
    var mini=data.settings.voice?.minimax||{},breeze=data.settings.voice?.breeze||{};
    return{engine:$('vEngine').value,emotion:$('vMood').value,customUrl:$('vCustomUrl').value.trim(),customVoice:$('vCustomVoice').value.trim(),minimax:{apiKey:$('vMiniKey').value.trim(),voiceId:$('vMiniVoice').value,model:$('vMiniModel').value,...(mini.speed?{speed:mini.speed}:{})},breeze:{mode:$('vBreezeMode').value,baseUrl:$('vBreezeBase').value.trim(),apiKey:$('vBreezeKey').value.trim(),voiceId:$('vBreezeVoice').value.trim(),model:$('vBreezeModel').value.trim(),language:$('vBreezeLang').value.trim()||'zh',instructions:$('vBreezeInstructions').value.trim(),...(breeze.guidance?{guidance:breeze.guidance}:{})},...(preset?{enabled:true}:{})};
  }
  function voiceStudioPaint(){if(!$('vEngine'))return;
    if($('vContext'))$('vContext').onchange=function(){operationPanelChat=this.value;};var engine=$('vEngine').value;$('vMiniSection').hidden=engine!=='minimax';$('vBreezeSection').hidden=engine!=='breeze';$('vLegacy').open=engine==='custom';
    if(engine==='breeze'){var selfhost=$('vBreezeMode').value==='openai';$('vBreezeBase').placeholder=selfhost?'http://127.0.0.1:8091':'https://api.breeze.blue';$('vBreezeModel').placeholder=selfhost?'BreezeBlue/Breeze-TTS-2':'breeze-tts-2';}
    $('vTest').textContent=engine==='minimax'?'试听情绪增强（计费）':engine==='breeze'?($('vBreezeMode').value==='openai'?'试听 Breeze（本地）':'试听 Breeze（计费）'):'试听当前设置';}
  async function saveVoiceStudio(preset){
    if(voiceStudioBusy)return;voiceStudioSetBusy(true);var config=voiceStudioInput(preset);
    ['vSaveEngine','vTest'].forEach(function(id){if($(id))$(id).disabled=true;});
    try{await api('POST','/im-bridge/settings',{voice:config});await load();
      var savedEngine=(data.settings&&data.settings.voice?data.settings.voice.engine:'')||'';
      if(savedEngine!==''&&savedEngine!==config.engine)toast('已提交，但运行中的桥接仍是 '+savedEngine+'；请到 设置 → 插件 重载 QQ / IM 桥接后再保存');
      else toast('语音设置已保存（'+config.engine+'）');
    }
    catch(error){toast('保存失败：'+error.message);}
    finally{voiceStudioSetBusy(false);}
  }
  function bindVoiceStudio(){
    if(!$('vEngine'))return;
    $('vEngine').onchange=voiceStudioPaint;if($('vBreezeMode'))$('vBreezeMode').onchange=voiceStudioPaint;voiceStudioPaint();voiceStudioSetBusy(voiceStudioBusy);
    $('vSaveEngine').onclick=function(){return saveVoiceStudio();};
    Array.prototype.forEach.call(document.querySelectorAll('[data-usevoice]'),function(button){button.onclick=function(){return saveVoiceStudio(button.getAttribute('data-usevoice'));};});
    $('vTest').onclick=async function(){
      if(voiceStudioBusy)return;voiceStudioSetBusy(true);var button=this;var output=$('vOut');output.textContent='正在结合最近8条对话安排语气并合成试听…';
      try{var result=await api('POST','/im-bridge/voice/preview',Object.assign(voiceStudioInput(),{performance:$('vPerformance')?.value||'speech',contextKey:operationPanelContext(),text:$('vText').value.trim()||'你来啦，今天过得怎么样？我刚好想听你说说。'}));
        if(result.jobId){const {waitForAudioPreview}=await import('./runninghub-audio-ui.js');result=await waitForAudioPreview(api,result,taskId=>{if(taskId&&$('vOut'))$('vOut').textContent='RunningHub 任务 '+taskId+' 正在生成…';});}
        if($('vOut'))$('vOut').innerHTML='<p>'+esc(result.label||result.engine)+' · '+(result.capability==='emotion'?'情绪合成':'音色与韵律')+'</p>'+(result.direction?'<p class="muted">结合 '+Number(result.contextCount||0)+' 条上下文，本次语气：'+esc(result.direction)+'</p>':'')+'<audio controls preload="metadata" src="/im-bridge/audio?name='+encodeURIComponent(result.name)+'" style="width:100%"></audio>';
      }catch(error){if($('vOut'))$('vOut').textContent='试听失败：'+error.message;}
      finally{voiceStudioSetBusy(false);}
    };
  }


  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function loadLog() {
    var box = $('logBox');
    if (!box) return;
    api('GET', '/im-bridge/log?lines=40')
      .then(function (v) { box.textContent = (v.lines || []).join('\n') || '（空）'; box.scrollTop = box.scrollHeight; })
      .catch(function (e) { box.textContent = '读取失败：' + e.message; });
  }

  var qrTimer = null;
  var qrReadSerial = 0;
  var qrObjectUrl = '';

  function loginHint(message, danger) {
    var hint = $('loginHint');
    if (!hint) return;
    hint.textContent = message;
    hint.style.color = danger ? 'var(--danger)' : 'var(--ink3)';
  }

  function showQrMeta(v) {
    var hint = $('qrAge');
    if (!hint) return;
    var status = String(v.status || '');
    var age = Math.max(0, Math.round(v.ageSeconds || 0));
    var descriptions = { ready: 'QQ 已登录，等待桥接连接。', qrcode_scanned: '二维码已扫码，请在手机 QQ 确认。', generating_qrcode: '正在申请新二维码…', reconnecting: 'QQ 正在重新连接，请稍候…', initializing: 'NapCat 正在初始化，请稍候…', offline: 'QQ 当前离线，请启动 NapCat 或更换二维码。' };
    if (v.error) hint.textContent = '二维码状态：' + v.error;
    else if (v.expired) hint.textContent = '当前二维码已过期，请点击「换一个二维码」。旧图仅供识别，不能继续扫码。';
    else if (descriptions[status]) hint.textContent = descriptions[status];
    else if (v.available === false || !v.exists) hint.textContent = '还没有可扫描的二维码，请先启动 NapCat。启动后会自动读取二维码。';
    else hint.textContent = '二维码更新于 ' + age + ' 秒前，请用手机 QQ 扫码并确认登录。';
    hint.style.color = v.error || v.expired ? 'var(--danger)' : 'var(--ink3)';
    var box = $('qrBox');
    if (box) {
      box.setAttribute('data-qr-status', v.expired ? 'expired' : (v.available === false ? 'unavailable' : (status || 'available')));
      var image = box.querySelector('img');
      if (image) { image.style.opacity = v.expired || v.available === false ? '0.35' : '1'; image.title = v.expired ? '二维码已过期，请换一个二维码' : '手机 QQ 扫码登录'; }
    }
  }

  async function paintQr(force) {
    var box = $('qrBox');
    if (!box) return;
    var serial = ++qrReadSerial;
    function current() { return serial === qrReadSerial && box.isConnected && $('qrBox') === box; }
    try {
      var meta = await api('GET', '/im-bridge/qr/meta');
      if (!current()) return;
      showQrMeta(meta);
      if (meta.available === false || meta.expired || !meta.exists) {
        if (!box.querySelector('img')) box.innerHTML = '<div class="muted">' + esc(meta.error || (meta.status === 'ready' ? 'QQ 已登录，正在等待桥接连接。' : '等待 NapCat 生成可扫描的二维码…')) + '</div>';
        return;
      }
      var version = String(meta.updatedAt || meta.version || '');
      if (!force && version && box.getAttribute('data-qr-version') === version && box.querySelector('img')) return;
      var response = await fetch('/im-bridge/qr?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) {
        var reason = 'HTTP ' + response.status;
        try { var problem = await response.json(); if (problem.error) reason = problem.error; } catch (_) {}
        throw new Error(reason);
      }
      if (!/^image\//i.test(response.headers.get('content-type') || '')) throw new Error('二维码接口未返回图片');
      var blob = await response.blob();
      if (!current()) return;
      var objectUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        if (!current()) { URL.revokeObjectURL(objectUrl); return; }
        img.style.maxWidth = '220px';
        img.style.borderRadius = '12px';
        img.style.border = '1px solid var(--line)';
        img.alt = 'QQ 登录二维码';
        img.title = '请用手机 QQ 扫码并确认登录';
        box.replaceChildren(img);
        box.setAttribute('data-qr-version', version);
        if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
        qrObjectUrl = objectUrl;
        showQrMeta(meta);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        if (!current()) return;
        if (!box.querySelector('img')) box.innerHTML = '<div class="muted">二维码图片无法解码，请更换二维码后重试。</div>';
        if ($('qrAge')) { $('qrAge').textContent = '读取二维码失败：图片无法解码'; $('qrAge').style.color = 'var(--danger)'; }
      };
      img.src = objectUrl;
    } catch (error) {
      if (!current()) return;
      if (!box.querySelector('img')) box.innerHTML = '<div class="muted">暂时无法读取二维码。</div>';
      if ($('qrAge')) { $('qrAge').textContent = '读取二维码失败：' + error.message; $('qrAge').style.color = 'var(--danger)'; }
    }
  }

  

  function refreshDiag() {
    var line = $('loginDiag');
    if (!line) return;
    api('GET', '/im-bridge/login/diag').then(function (d) {
      if (!line.isConnected) return;
      line.textContent = 'QQ 进程 ' + d.qqProcesses + ' 个 · NapCat 进程 ' + d.napcatProcesses + ' 个 · 桥接 ' + d.port3001 + (d.qrAgeSeconds === null ? '' : ' · 本地二维码 ' + d.qrAgeSeconds + ' 秒前');
      if (d.advice) line.textContent += ' —— ' + d.advice;
      line.style.color = d.advice ? 'var(--danger)' : 'var(--ink3)';
    }).catch(function (error) { if (line.isConnected) line.textContent = '暂时无法检查登录进程：' + error.message; });
  }

  function startQrWatch() {
    stopQrWatch();
    paintQr();
    refreshDiag();
    qrTimer = setInterval(function () { if ($('qrBox')) paintQr(); refreshDiag(); }, 5000);
  }

  function stopQrWatch() {
    qrReadSerial += 1;
    if (qrTimer !== null) { clearInterval(qrTimer); qrTimer = null; }
    if (qrObjectUrl) { URL.revokeObjectURL(qrObjectUrl); qrObjectUrl = ''; }
  }

  function chatModelOptions(chatKey) {
    var current = (data.status.modelByChat || {})[chatKey];
    var out = '<option value="">跟随全局</option>';
    ((models && models.groups) || []).forEach(function (g) {
      (g.models || []).forEach(function (m) {
        var value = g.id + '|' + m.id;
        var selected = current && current.provider === g.id && current.model === m.id;
        out += '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(m.name || m.id) + ' · ' + esc(g.name || g.id) + '</option>';
      });
    });
    return out;
  }

  function renderModelPickers() {
    var provider = $('mProvider');
    var modelSelect = $('mModel');
    if (!provider || !modelSelect) return;
    // 用面板真实生效的那一组，而不是目录里的默认值；否则下拉显示的和实际用的会不一致。
    var cur = (data.status && data.status.model) || (models && (models.current || models.default)) || {};
    provider.innerHTML = '';
    ((models && models.groups) || []).forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name || g.id;
      if (g.id === cur.provider) opt.selected = true;
      provider.appendChild(opt);
    });
    if (!provider.options.length) {
      provider.innerHTML = '<option value="' + esc(cur.provider || '') + '">' + esc(cur.provider || '无可用模型') + '</option>';
    }
    fillModels(cur.model);
    if ($('modelCur')) {
      $('modelCur').textContent =
        (cur.provider || '?') + ' / ' + (cur.model || '?') + (cur.reasoningEffort ? ' · ' + cur.reasoningEffort : '');
    }
  }

  function fillModels(preferred) {
    var provider = $('mProvider');
    var modelSelect = $('mModel');
    if (!provider || !modelSelect) return;
    var groups = (models && models.groups) || [];
    var group = groups.filter(function (g) { return g.id === provider.value; })[0];
    modelSelect.innerHTML = '';
    ((group && group.models) || []).forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name || m.id;
      if (m.id === preferred) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    if (!modelSelect.options.length) {
      modelSelect.innerHTML = '<option value="' + esc(preferred || '') + '">' + esc(preferred || '无可用模型') + '</option>';
    }
  }

  function bind() {
    bindBiliPanel();
    bindRoutes();
    localBackendControls();
    var el;
    if($('localImportChat'))$('localImportChat').onclick=function(){$('localChatWorkflowFile').click();};
    if($('localDeleteChat'))$('localDeleteChat').onclick=function(){return deleteLocalWorkflow($('localChatWorkflow').value,this);};
    if($('localChatWorkflowFile'))$('localChatWorkflowFile').onchange=function(){readLocalWorkflow(this.files[0],'chat');this.value='';};
    if($('localApplyChat'))$('localApplyChat').onclick=async function(){this.disabled=true;try{await applyLocalChatWorkflow($('localChatWorkflow').value);}catch(error){toast(error.message);}finally{if(this.isConnected)this.disabled=false;}};
    document.querySelectorAll('[data-local-use-chat]').forEach(function(button){button.onclick=async function(){try{await applyLocalChatWorkflow(this.dataset.localUseChat);}catch(error){toast(error.message);}};});
    if((el=$('localWorkflowFile')))el.onchange=function(){readLocalWorkflow(this.files[0]);};
    if((el=$('localWorkflowDrop'))){
      el.ondragover=function(event){event.preventDefault();};
      el.ondrop=function(event){event.preventDefault();readLocalWorkflow(event.dataTransfer.files[0]);};
    }
    if((el=$('localImportCancel')))el.onclick=function(){captureLocalForm();localImportState=null;renderPane();};
    if((el=$('localImportKind')))el.onchange=function(){captureLocalImport();localImportState.kind=this.value;var outputs=localImportOutputs(localImportState.analysis,localImportState.kind);localImportState.output=outputs.length===1?outputs[0]:null;renderPane();};
    document.querySelectorAll('[data-import-input],#localImportTextField,#localImportActivateChat').forEach(function(select){select.onchange=function(){captureLocalImport();renderPane();};});
    if($('localImportOutput'))$('localImportOutput').onchange=function(){var output=this.value?JSON.parse(this.value):null;if($('localImportTextField'))$('localImportTextField').value=output?.field||'text';captureLocalImport();renderPane();};
    if((el=$('localImportConfirm')))el.onclick=function(){
      var button=this;captureLocalForm();captureLocalImport();var s=localImportState;button.disabled=true;
      localPost({action:'import-workflow',token:s.token,name:s.name,description:s.description,kind:s.kind,inputs:s.inputs,output:s.output,activateChat:s.activateChat===true}).then(function(result){
        localWorkflowDraft=localWorkflowDraft.filter(function(x){return x.id!==result.entry.id;}).concat(result.entry);
        if(result.entry.kind!=='chat'&&!localDefaultsDraft[result.entry.kind])localDefaultsDraft[result.entry.kind]=result.entry.id;
        localConfigDraft.workflowLibrary=localWorkflowDraft;
        if(s.activateChat&&result.entry.kind==='chat'){localConfigDraft.backend='comfyui';localConfigDraft.chatWorkflow=result.config.chatWorkflow;}
        localImportState=null;localDraftEditing=true;
        if(localGateway){localGateway.config=result.config;}
        renderPane();toast(s.activateChat&&result.entry.kind==='chat'?(result.config.chatWorkflow===result.entry.id?'已导入并用于本地聊天，下一轮生效':'已导入，但旧网关未确认聊天选择；请重启网关后再应用'):'工作流已导入并保存');
      }).catch(function(error){button.disabled=false;toast('导入失败：'+error.message);});
    };
    document.querySelectorAll('[data-local-workflow-inspect]').forEach(function(button){button.onclick=function(){var item=localWorkflowDraft[Number(this.dataset.localWorkflowInspect)];if(item?.id)analyzeLocalWorkflow({workflowId:item.id,kind:item.kind});};});
    if((el=$('localModelsRefresh')))el.onclick=function(){
      var button=this;button.disabled=true;$('localModelsHint').textContent='正在读取模型列表…';
      localPost({action:'list-models',baseUrl:$('localModelBaseUrl').value.trim()}).then(function(result){
        localModels=result.models||[];$('localModelList').innerHTML=localModels.map(function(x){return '<option value="'+esc(x.id)+'">';}).join('');
        $('localModelsHint').textContent='已找到 '+localModels.length+' 个模型，可从模型输入框选择，也可以直接手填。';
      }).catch(function(error){$('localModelsHint').textContent=error.message;}).finally(function(){button.disabled=false;});
    };
    if ((el = $('localSave'))) el.onclick = function () {
      return saveLocalConfig(this);
    };
    if((el=$('localInitiativeSave')))el.onclick=async function(){var button=this;button.disabled=true;try{await api('POST','/im-bridge/settings',{localChat:{initiativeEnabled:$('localInitiativeEnabled').checked}});data.localChat=data.localChat||{};data.localChat.initiativeEnabled=$('localInitiativeEnabled').checked;toast('本地主动聊天设置已保存');await refreshLocalRun();}catch(error){toast('保存失败：'+error.message);}finally{button.disabled=false;}};
    function saveLocalConfig(button) {
      button.disabled = true;
      var config = captureLocalForm();
      return localPost({
        action: 'save',
        gatewayUrl: $('localGatewayUrl').value.trim(),

        config: config,
      })
        .then(function (result) {
          if(result.verified!==true)throw Error('后台尚未确认配置回读，请重启 DSH 后再保存');
          if(result.localChat)data.localChat=Object.assign({},data.localChat,result.localChat);
          localDraftEditing = false;
          localConfigDraft = null;
          if ($('localWorkflowHint')) $('localWorkflowHint').textContent = '配置已保存；下一轮生效。';
          toast(data.localChat?.enabled?(data.localChat.apiComplement?'本地模型已保存，API 补全仍开启':'本地模型已保存，当前为纯本地'):'本地配置已保存；当前仍是 API 模式，可点击“切换纯本地并使用此工作流”');
          return localRefresh().catch(function(error){toast('配置已保存，但刷新状态未完成：'+error.message);return result;});
        })
        .catch(function (e) {
          if ($('localWorkflowHint')) $('localWorkflowHint').textContent = '保存失败：' + e.message;
          toast('保存失败：' + e.message);if(floatingSaveCapture)throw e;
        })
        .finally(function () { if(button.isConnected)button.disabled = false; });
    }
    if ((el = $('localWorkflowSave'))) el.onclick = function () { saveLocalConfig(this); };
    if ((el = $('localWorkflowAdd'))) el.onclick = function () {
      captureLocalForm();
      localDraftEditing = true;
      localWorkflowDraft.push({
        id: 'image-' + Date.now().toString(36), name: '新工作流', kind: 'image', description: '', file: '',
        inputs: { prompt: { node: '', field: '' }, negativePrompt: { node: '', field: '' }, seed: { node: '', field: '' }, image: { node: '', field: '' } },
        timeoutMs: 600000,
      });
      renderPane();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-local-workflow-delete]'), function (button) {
      button.onclick = function () {
        deleteLocalWorkflow(localWorkflowDraft[Number(button.getAttribute('data-local-workflow-delete'))]?.id,button);
      };
    });
    function rememberLocalEdit() {
      localDraftEditing = true;
      captureLocalForm();
    }
    if($('localParameterRead'))$('localParameterRead').onclick=readLocalParameters;
    if($('localParameterSave'))$('localParameterSave').onclick=saveLocalParameters;
    if($('localParameterPicker'))$('localParameterPicker').onchange=function(){localParameterSelected=this.value;renderLocalParameters();if($('localParameterPanel').open)void readLocalParameters();};
    if($('localParameterPanel'))$('localParameterPanel').ontoggle=function(){localParameterOpen=this.open;if(this.open){localParameterSelected=$('localParameterPicker').value;renderLocalParameters();if(!localParameterViews[localParameterSelected])void readLocalParameters();}};
    if($('localParameterPanel')?.open){localParameterSelected=$('localParameterPicker').value;renderLocalParameters();}
    if($('localParameterReset'))$('localParameterReset').onclick=function(){var view=localParameterViews[localParameterSelected];if(!view){void readLocalParameters();return;}view.parameters.forEach(function(p){p.value=p.defaultValue;p.overridden=false;});view.dirty=true;renderLocalParameters();$('localParameterHint').textContent='已在编辑区恢复默认，点击保存后生效。';};
    if($('localParameterDiscard'))$('localParameterDiscard').onclick=function(){if(localParameterViews[localParameterSelected]?.saving)return;delete localParameterViews[localParameterSelected];void readLocalParameters();};
    ['localBackend','localModelBaseUrl','localModelId','localChatWorkflow','localTemperature','localMaxTokens','localHistoryChars','localVoiceEnabled','localVoicePreset','localFastDialogue','localDialoguePriority','localStreamDialogue','localVisionMode','localMemoryProfile','localUrl','localGatewayUrl','localWarm','localIdle','localDefaultImage','localDefaultVideo','localVoiceClearKey'].concat(Object.values(localVoiceFields).map(function(name){return 'localVoice'+name;})).forEach(function (id) {
      var field = $(id);
      if (!field) return;
      field.addEventListener('input', rememberLocalEdit);
      field.addEventListener('change', function () {
        rememberLocalEdit();
        if(id==='localBackend')localBackendControls();
        if (id === 'localDefaultImage' || id === 'localDefaultVideo') {
          localDefaultsDraft[id === 'localDefaultImage' ? 'image' : 'video'] = field.value;
          localConfigDraft.defaultWorkflows = Object.assign({}, localDefaultsDraft);
        }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-local-workflow]'), function (row) {
      var index = Number(row.getAttribute('data-local-workflow'));
      Array.prototype.forEach.call(row.querySelectorAll('[data-wf],[data-map]'), function (field) {
        field.addEventListener('focus', function () {
          if (field.getAttribute('data-wf') === 'id') field.dataset.localPreviousId = localWorkflowDraft[index] && localWorkflowDraft[index].id || '';
        });
        field.addEventListener('input', rememberLocalEdit);
        field.addEventListener('change', function () {
          var oldId = field.getAttribute('data-wf') === 'id' ? field.dataset.localPreviousId || '' : '';
          rememberLocalEdit();
          var current = localWorkflowDraft[index] || {};
          if (field.getAttribute('data-wf') === 'id' && oldId && current.id !== oldId) {
            if(localConfigDraft.chatWorkflow===oldId){localConfigDraft.chatWorkflow=current.id;var chatSelect=$('localChatWorkflow');if(chatSelect){chatSelect.innerHTML=localChatOptions(current.id);chatSelect.value=current.id;}}
            if (localDefaultsDraft.image === oldId) localDefaultsDraft.image = current.id;
            if (localDefaultsDraft.video === oldId) localDefaultsDraft.video = current.id;
            field.dataset.localPreviousId = current.id;
          }
          localConfigDraft.defaultWorkflows = Object.assign({}, localDefaultsDraft);
          if (['id','name','kind'].includes(field.getAttribute('data-wf'))) {refreshLocalDefaultOptions();var select=$('localChatWorkflow');if(select)select.innerHTML=localChatOptions(localConfigDraft.chatWorkflow);}
        });
      });
    });
    if ((el = $('localLoadVoices'))) el.onclick = function () {
      var button=this;button.disabled=true;
      localPost({action:'save',config:captureLocalForm()}).then(function(){return localPost({action:'list-voices'});}).then(function(result){
        $('localVoicePresets').innerHTML=(result.voices||[]).map(function(voice){return '<option value="'+esc(voice.id)+'">'+esc(voice.name)+'</option>';}).join('');
        $('localVoicePresetHint').textContent=(result.voices||[]).length?'已读取 '+result.voices.length+' 个音色；在输入框选择后保存。':'服务未提供音色列表，可直接填写音色 ID；VoiceLab 请先创建参考音色。';
      }).catch(function(error){$('localVoicePresetHint').textContent='读取音色失败：'+error.message;}).finally(function(){button.disabled=false;});
    };
    if ((el = $('localProbe'))) el.onclick=function(){var button=this;button.disabled=true;$('localStatus').textContent='正在使用短测试核验能力；不会发送 QQ，也不会调用云端模型。';api('POST','/im-bridge/local',{action:'probe-capabilities'}).then(function(){return localRefresh();}).catch(function(e){$('localStatus').textContent='本地能力检查暂未完成：'+e.message;}).finally(function(){button.disabled=false;});};
    if ((el = $('localPing'))) el.onclick = function () { $('localStatus').textContent = '正在连接…'; localRefresh().then(function () { toast('已刷新'); }).catch(function(e){toast('读取未完成：'+e.message);}); };
    if ((el = $('localRelease'))) el.onclick = function () {
      var button = this; button.disabled = true;
      localPost({ action: 'release' }).then(function (v) { toast(v.freed ? '已释放显存' : '释放失败：' + (v.error || '')); return localRefresh(); })
        .catch(function (e) { toast('释放失败：' + e.message); }).finally(function () { button.disabled = false; });
    };
    if ((el = $('localChat'))) el.onclick = function () {
      if(localTrialBusy)return;localTrialBusy=true;
      var button = this, text = ($('localText').value || '').trim(), input = $('localImage');
      if (!text) { localTrialBusy=false;toast('先写一句话'); return; }
      button.disabled = true; $('localChatOut').textContent = '正在生成…';
      localTrialResult={text:'正在生成…'};
      var imageReady = input && input.files && input.files[0] ? new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('无法读取所选图片')); };
        reader.readAsDataURL(input.files[0]);
      }) : Promise.resolve('');
      imageReady.then(function (dataUrl) {
        var content = [{ type: 'text', text: text }];
        if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
        var messages = [{ role: 'system', content: String((data && data.settings && data.settings.basePersona) || '') }, { role: 'user', content: dataUrl ? content : text }];
        return localPost({ action: 'test', messages: messages });
      }).then(function (v) {
        var files = (v.attachments || []).map(function (item) { return item.kind + ' · ' + item.file; });
        localTrialResult={text:String(v.text || v.spokenText || '') + '\n' + (files.length ? files.join('\n') : '没有媒体附件') + '\n（' + (Number(v.elapsedMs || 0) / 1000).toFixed(1) + ' 秒；QQ 未发送）',receipts:'receipts\n'+JSON.stringify(v.receipts||[],null,2)};paintLocalTrial();void refreshLocalRun();
      })
        .catch(function (e) { localTrialResult={text:'失败：'+e.message};paintLocalTrial();void refreshLocalRun(); }).finally(function () { localTrialBusy=false;button.disabled=false;if($('localChat'))$('localChat').disabled=false; });
    };
    if (tab === 'services') bindServiceConnections();
    if(tab==='videogen')bindVideogen();
    if (tab === 'websitemcp') bindWebsiteMcp();
    if (tab === 'local'&&!deviceUiPreview()) {void localRefresh().catch(function(){});startLocalRunWatch();paintLocalTrial();}
    Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          await api('POST', '/im-bridge/action', { kind: 'toggle', target: btn.getAttribute('data-toggle') });
          await load();
        } catch (error) { toast('设置失败：' + error.message); }
        finally { btn.disabled = false; }
      };
    });
    if ((el = $('igProvider'))) el.onchange = function () {
      var current = imagegenDraft || data.settings.imagegen || {};
      var next = Object.assign({}, current, { provider: this.value });
      // Preserve unsaved values before changing the provider's form.
      var old = current.provider || 'siliconflow';
      if ($('igDir')) next.saveDir = $('igDir').value;
      if ($('igKey')) imagegenTypedKeys.siliconflow = $('igKey').value;
      if ($('rhKey')) imagegenTypedKeys.runninghub = $('rhKey').value;
      if (old === 'runninghub') next.runninghub = rhCapture();
      if (old === 'siliconflow' && $('igModel')) Object.assign(next, {
        apiKey: $('igKey').value, model: $('igModel').value, size: $('igSize').value,
        steps: Number($('igSteps').value), cfg: Number($('igCfg').value), seed: Number($('igSeed').value)
      });
      imagegenDraft = next;
      renderPane();
    };
    if ((el = $('sendTarget'))) el.onchange = function () {
      $('sendCustom').style.display = this.value === '__custom' ? '' : 'none';
    };
    if ((el = $('sendGo'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var target = $('sendTarget').value === '__custom' ? ($('sendCustom').value || '').trim() : $('sendTarget').value;
      if (!target) { toast('先选发送对象'); return; }
      var payload = {
        target: target,
        text: ($('sendText').value || '').trim(),
        voice: ($('sendVoice').value || '').trim(),
        sticker: $('sendSticker').value || ''
      };
      if (!payload.text && !payload.voice && !payload.sticker) { toast('没有要发的内容'); return; }
      el.disabled = true;
      $('sendOut').textContent = '发送中…';
      api('POST', '/im-bridge/send', payload)
        .then(function (v) { $('sendOut').textContent = '已加入发送队列（' + v.segments.join('+') + '）→ ' + v.target+'；实际结果见发送记录'; toast('已排队，等待QQ回执'); })
        .catch(function (e) { $('sendOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    [['sendFillSorry', '刚才说错了，别当真'], ['sendFillBusy', '我去忙一会儿，回头找你'], ['sendFillNight', '睡了，晚安']].forEach(function (pair) {
      var btn = $(pair[0]);
      if (btn) btn.onclick = async function () { $('sendText').value = pair[1]; };
    });
    if ((el = $('btnStart'))) el.onclick = async function () {
      var button = this;
      button.disabled = true;
      loginHint('正在启动 NapCat，请等待登录状态或二维码…');
      try {
        var v = await api('POST', '/im-bridge/login', { action: 'start' });
        loginHint(v.already ? 'NapCat 桥接已连接，正在检查 QQ 登录状态…' : (v.message || '启动请求已提交，正在等待二维码或 QQ 登录结果。'));
        paintQr(true);
        setTimeout(function () { if (tab === 'connection') load(); }, 6000);
      } catch (error) { loginHint('启动失败：' + error.message, true); }
      finally { button.disabled = false; }
    };
    if ((el = $('btnQrRefresh'))) el.onclick = async function () {
      var button = this;
      button.disabled = true;
      loginHint('正在向 NapCat 申请一个新二维码…');
      try {
        var v = await api('POST', '/im-bridge/login', { action: 'qr-refresh' });
        loginHint(v.message || (v.restarting ? '正在重新建立登录，请等待新二维码…' : '新二维码请求已完成，请用手机 QQ 扫码。'));
        await paintQr(true);
      } catch (error) { loginHint('更换二维码失败：' + error.message, true); }
      finally { button.disabled = false; }
    };
    if ((el = $('btnRestartNapCat'))) el.onclick = async function () {
      var button = this;
      button.disabled = true;
      loginHint('正在重启当前机器人对应的 NapCat…');
      try {
        var v = await api('POST', '/im-bridge/login', { action: 'restart' });
        loginHint(v.message || '重启请求已提交，请等待二维码或 QQ 登录结果。');
        paintQr(true);
      } catch (error) { loginHint('重启失败：' + error.message, true); }
      finally { button.disabled = false; }
    };
    if ($('qrBox')) startQrWatch();
    if ((el = $('autoStartToggle'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var next = !data.status.autoStart;
      el.disabled = true;
      api('POST', '/im-bridge/settings', { autoStart: next })
        .then(function () { toast(next ? '已开启开机自启' : '已关闭开机自启'); load(); })
        .catch(function (e) { toast('设置失败：' + e.message); })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('btnReconnect'))) el.onclick = async function () {
      if(login&&(login.requiresDeviceSwitch||data.status.accountPaused)){await api('POST','/im-bridge/action',{kind:'activate-local'});toast('本机桥接已启用');await load();return;}
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/action', { kind: 'reconnect' }).then(function (v) {
        toast(v.connected ? '已重连' : '请求已发出，但 NapCat 还没连上'); load();
      });
    };
    if ((el = $('btnPause'))) el.onclick = async function () {
      if(login&&(login.requiresDeviceSwitch||data.status.accountPaused)){await api('POST','/im-bridge/action',{kind:'activate-local'});toast('本机桥接已启用');await load();return;}
      var el = this; // 捕获当次元素
      var paused = !data.status.accountPaused;
      api('POST', '/im-bridge/action', { kind: paused ? 'pause' : 'resume' }).then(function () {
        toast(paused ? '已停用连接（配置保留）' : '已恢复连接'); load();
      });
    };
    if ((el = $('btnTest'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/action', { kind: 'test' }).then(function (v) {
        toast(v.connected ? '测试消息已发出' : 'NapCat 未连接，没发出去');
      });
    };
    if ((el = $('logRefresh'))) el.onclick = loadLog;
    Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (btn) {
      btn.onclick = async function () {
        if (!await askConfirm('重置这个会话？下一条消息会开新的。')) return;
        api('POST', '/im-bridge/action', { kind: 'reset', key: btn.getAttribute('data-reset') })
          .then(function () { toast('已重置'); load(); });
      };
    });

    if ((el = $('pAdd'))) el.onclick = async function () {
      var name = $('pName').value.trim();
      var prompt = $('pPrompt').value.trim();
      if (!name || !prompt) { toast('名字和提示词都要填'); return; }
      var editing = (data.settings.personae || []).filter(function (p) { return p.id === editingId; })[0];
      var presetIds = presets.map(function (p) { return p.id; });
      var editingIsPreset = editingId !== '' && presetIds.indexOf(editingId) >= 0;

      // 内置人设：改文件 + 记一个显示名
      if (editingIsPreset) {
        try {
          await api('POST', '/im-bridge/presets', { id: editingId, action: 'save', prompt: prompt });
          var names = Object.assign({}, data.settings.presetNames || {});
          names[editingId] = name;
          await api('POST', '/im-bridge/settings', { presetNames: names });
          toast('已保存');
          editingId = '';
          personaTool = '';
          load();
        } catch (e) {
          toast('保存失败：' + e.message);
        }
        return;
      }

      var personae = (data.settings.personae || []).slice();
      if (editingId) {
        personae = personae.map(function (p) {
          return p.id === editingId ? { id: p.id, name: name, preset: 'whale', prompt: prompt } : p;
        });
      } else {
        personae.push({ id: 'p' + Date.now(), name: name, preset: 'whale', prompt: prompt });
      }
      api('POST', '/im-bridge/settings', { personae: personae }).then(function () {
        toast(editingId ? '已保存' : '已添加');
        editingId = '';
        personaTool = '';
        load();
      }).catch(function (e) { toast('保存失败：' + e.message); });
    };
    if ((el = $('pCancel'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      editingId = '';
      renderPane();
    };
    if ((el = $('unhideAll'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { hiddenPresets: [] }).then(function () { toast('已恢复'); load(); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-hide]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-hide');
        if (!await askConfirm('从列表里删除「' + id + '」？只是隐藏；要彻底卸载请去插件管理。')) return;
        var hidden = (data.settings.hiddenPresets || []).slice();
        if (hidden.indexOf(id) === -1) hidden.push(id);
        var patch = { hiddenPresets: hidden };
        if (data.settings.activePersonaId === id) patch.activePersonaId = '';
        api('POST', '/im-bridge/settings', patch).then(function () { toast('已移除'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-view');
        viewPreset = viewPreset === id ? '' : id;
        renderPane();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-presave]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-presave');
        var box = document.getElementById('presetEdit-' + id);
        if (!box) return;
        btn.disabled = true;
        api('POST', '/im-bridge/presets', { action: 'save', id: id, prompt: box.value })
          .then(function () { toast('已保存，下条消息生效'); load(); })
          .catch(function (e) { toast('保存失败：' + e.message); btn.disabled = false; });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-prerestore]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-prerestore');
        if (!await askConfirm('恢复成预设原文？你的修改会丢。')) return;
        api('POST', '/im-bridge/presets', { action: 'restore', id: id })
          .then(function () { toast('已恢复原文'); load(); })
          .catch(function (e) { toast('恢复失败：' + e.message); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-copy');
        var detail = presets.filter(function (x) { return x.id === id; })[0];
        if (!detail) { toast('读不到预设文本'); return; }
        editingId = '';
        personaTool = 'edit';
        var nameInput = document.getElementById('pName');
        var promptInput = document.getElementById('pPrompt');
        if (nameInput) nameInput.value = detail.name + '（我的版本）';
        if (promptInput) promptInput.value = detail.prompt;
        if (document.getElementById('pAdd')) document.getElementById('pAdd').textContent = '另存为新的人设卡';
        viewPreset = '';
        renderPane();
        var again = document.getElementById('pName');
        if (again) {
          again.value = detail.name + '（我的版本）';
          document.getElementById('pPrompt').value = detail.prompt;
          document.getElementById('pAdd').textContent = '另存为新的人设卡';
        }
        window.scrollTo(0, document.body.scrollHeight);
        toast('已填入表单，改完点「另存为新的人设卡」');
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-use]'), function (btn) {
      btn.onclick = async function () {
        api('POST', '/im-bridge/settings', { activePersonaId: btn.getAttribute('data-use') })
          .then(function () { toast('已穿上人设卡'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-self]'), function (btn) {
      btn.onclick = async function () {
        try {
          await api('POST', '/im-bridge/settings', { activePersonaId: '' });
          toast('已脱下角色卡，回到自我');
          await load();
        } catch (e) { toast(e.message); }
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (btn) {
      btn.onclick = async function () {
        rememberDraft('persona');
        personaTool = 'edit';
        editingId = btn.getAttribute('data-edit');
        renderPane();
        var form = $('personaForm');
        if (form) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
        var nameBox = $('pName');
        if (nameBox) setTimeout(function () { nameBox.focus(); }, 200);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-del');
        var target = (data.settings.personae || []).filter(function (p) { return p.id === id; })[0];
        var isActive = data.settings.activePersonaId === id;
        var tip = '删除人设卡「' + (target ? target.name : id) + '」？' +
          (isActive ? '她正穿着这张卡，删除后会脱下它、回到自我。' : '');
        if (!await askConfirm(tip)) return;
        var personae = (data.settings.personae || []).filter(function (p) { return p.id !== id; });
        var patch = { personae: personae };
        if (presets.some(function (p) { return p.id === id; })) {
          var hidden = (data.settings.hiddenPresets || []).slice();
          if (hidden.indexOf(id) === -1) hidden.push(id);
          patch.hiddenPresets = hidden;
        }
        if (isActive) patch.activePersonaId = '';
        api('POST', '/im-bridge/settings', patch).then(function () {
          toast(isActive ? '已删除，回到自我' : '已删除');
          if (editingId === id) { editingId = ''; personaTool = ''; }
          load();
        });
      };
    });
    if ((el = $('pExport'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var blob = new Blob([JSON.stringify(data.settings.personae || [], null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'personae.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    };
    if ((el = $('pImportBtn'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      try {
        var incoming = JSON.parse($('pImport').value);
        if (!Array.isArray(incoming)) throw new Error('需要一个数组');
        var personae = (data.settings.personae || []).slice();
        incoming.forEach(function (p) {
          if (!p || !p.name || !p.prompt) return;
          personae.push({ id: 'p' + Date.now() + Math.floor(Math.random() * 1000), name: String(p.name), preset: String(p.preset || 'whale'), prompt: String(p.prompt) });
        });
        api('POST', '/im-bridge/settings', { personae: personae }).then(function () { toast('已导入'); load(); });
      } catch (e) { toast('导入失败：' + e.message); }
    };

    document.querySelectorAll('[data-owner-note-save]').forEach(b=>b.onclick=async()=>{var id=b.dataset.ownerNoteSave,notes={...data.settings.userNotes,[id]:$('ownerAddress_'+id).value.trim()};b.disabled=true;try{await api('POST','/im-bridge/settings',{userNotes:notes});await load();toast('称呼已与这个QQ账号绑定，日记也会使用');}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    if ((el = $('qqInput'))) el.onkeydown = function (e) { if (e.key === 'Enter') $('qqAdd').click(); };
    if ((el = $('ownerSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var list = ($('ownersInput').value || '').split(/[,，\s]+/).filter(function (v) { return v; });
      api('POST', '/im-bridge/settings', { owners: list })
        .then(function () { toast('号主已保存（' + list.length + ' 个）'); load(); })
        .catch(function (e) { toast('保存失败：' + e.message); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-ownerperm]'), function (btn) {
      btn.onclick = async function () {
        var key = btn.getAttribute('data-ownerperm');
        var current = (data.status && data.status.ownerPerms) || { send: true, broadcast: true, schedule: true };
        var next = { send: current.send, broadcast: current.broadcast, schedule: current.schedule };
        next[key] = !current[key];
        api('POST', '/im-bridge/settings', { ownerPerms: next })
          .then(function () { toast('已保存'); load(); })
          .catch(function (e) { toast('保存失败：' + e.message); });
      };
    });
    if ((el = $('ownerUseFirst'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var first = (data.allowUsers || [])[0] || '';
      if (!first) { toast('白名单是空的'); return; }
      api('POST', '/im-bridge/settings', { owners: [first] })
        .then(function () { toast('号主设为 ' + first); load(); });
    };
    if ((el = $('qqAdd'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var v = $('qqInput').value.trim();
      if (!/^\d{5,12}$/.test(v)) { toast('QQ 号格式不对'); return; }
      var list = data.settings.whitelist.slice();
      if (list.indexOf(v) === -1) list.push(v);
      api('POST', '/im-bridge/settings', { whitelist: list }).then(function () { toast('已添加'); load(); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-delqq]'), function (btn) {
      btn.onclick = async function () {
        var list = data.settings.whitelist.filter(function (u) { return u !== btn.getAttribute('data-delqq'); });
        api('POST', '/im-bridge/settings', { whitelist: list }).then(function () { toast('已移除'); load(); });
      };
    });
    if ((el = $('groupInput'))) el.onkeydown = function (e) { if (e.key === 'Enter') $('groupAdd').click(); };
    if ($('groupSave')) $('groupSave').onclick = async function () {
      try {
        await api('POST', '/im-bridge/settings', {
          groupRequireAt: $('groupRequireAt').checked,
        });
        toast('群聊规则已保存'); await load();
      } catch (e) { toast(e.message); }
    };
    if ((el = $('groupAdd'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var v = $('groupInput').value.trim();
      if (!/^\d{5,12}$/.test(v)) { toast('群号格式不对'); return; }
      var list = (data.settings.groups || []).slice();
      if (list.indexOf(v) === -1) list.push(v);
      api('POST', '/im-bridge/settings', { groups: list }).then(function () { toast('已添加'); load(); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-delgroup]'), function (btn) {
      btn.onclick = async function () {
        var list = (data.settings.groups || []).filter(function (g) { return g !== btn.getAttribute('data-delgroup'); });
        api('POST', '/im-bridge/settings', { groups: list }).then(function () { toast('已移除'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-disgroup]'),function(btn){btn.onclick=async function(){var id=btn.getAttribute('data-disgroup'),list=(data.settings.disabledGroups||[]).slice(),index=list.indexOf(id);if(index<0)list.push(id);else list.splice(index,1);btn.disabled=true;try{await api('POST','/im-bridge/settings',{disabledGroups:list});toast(index<0?'该群已停用':'该群已启用');await load();}catch(error){toast(error.message);btn.disabled=false;}};});

    if ((el = $('sToggle'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { stickers: { enabled: !data.settings.stickers.enabled } }).then(load);
    };
    if ((el = $('sClassify'))) el.onclick = async function () {
      this.disabled=true;var status=$('sClassifyStatus');status.textContent='正在识图并分组…';
      try{var r=await api('POST','/im-bridge/stickers/classify',{limit:6});toast(r.classified?.length?'已整理 '+r.classified.length+' 张':'暂无新结果，后台会继续处理；失败图片保留');await load();}
      catch(e){status.textContent='暂未完成：'+e.message;}
      finally{if(this.isConnected)this.disabled=false;}
    };
    if ((el = $('sUpload'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var name = ($('sName').value || '').trim();
      var input = $('sFile');
      if (!name) { toast('先给表情包起个名字'); return; }
      if (!input.files || !input.files[0]) { toast('先选一张图'); return; }
      var file = input.files[0];
      if (file.size > 8 * 1024 * 1024) { toast('图片超过 8MB'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(',')[1] || '';
        api('POST', '/im-bridge/stickers', { action: 'upload', name: name, data: base64 })
          .then(function () { toast('已上传'); load(); })
          .catch(function (e) { toast('上传失败：' + e.message); });
      };
      reader.readAsDataURL(file);
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-stoggle]'), function (btn) {
      btn.onclick = async function () {
        var name = btn.getAttribute('data-stoggle');
        var list = (data.settings.stickerDisabled || []).slice();
        var i = list.indexOf(name);
        if (i === -1) list.push(name); else list.splice(i, 1);
        api('POST', '/im-bridge/settings', { stickerDisabled: list }).then(load);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.noteInput'), function (input) {
      var save = function () {
        var qq = input.getAttribute('data-note');
        var notes = Object.assign({}, data.settings.userNotes || {});
        var value = (input.value || '').trim();
        if (value === '') delete notes[qq];
        else notes[qq] = value;
        api('POST', '/im-bridge/settings', { userNotes: notes })
          .then(function () { toast('备注已保存'); load(); })
          .catch(function (e) { toast('保存失败：' + e.message); });
      };
      input.onblur = save;
      input.onkeydown = function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      };
    });
    if ((el = $('qqReveal'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      showFullQQ = !showFullQQ;
      renderPane();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-disuser]'), function (btn) {
      btn.onclick = async function () {
        var user = btn.getAttribute('data-disuser');
        var list = (data.settings.disabledUsers || []).slice();
        var index = list.indexOf(user);
        if (index === -1) list.push(user); else list.splice(index, 1);
        api('POST', '/im-bridge/settings', { disabledUsers: list }).then(function () {
          toast(index === -1 ? '已停用' : '已启用'); load();
        });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sfilter]'), function (btn) {
      btn.onclick = async function () {
        sFilter = btn.getAttribute('data-sfilter');
        renderPane();
      };
    });
    if (($('igSave'))) $('igSave').onclick=function(){return saveImagegenWithFeedback('已保存');};
    if ((el = $('igTest'))) el.onclick = async function () {
      var prompt = ($('igTestPrompt').value || '').trim();
      if (!prompt) { toast('写个提示词'); return; }
      var out = $('igOut');
      var preview = $('igPreview');
      if(studioBusy||studioPolishing||studioSaving||studioUploads)return;studioBusy=true;studioResult=null;
      var english=$('igEnglish').value,negative=$('igNegative').value,fixedPrompts=studioFixedValues();var prepared=studioPreview&&studioPreview.input===prompt?studioPreview:null;this.disabled=true;
      out.textContent = '正在润色提示词并生成图片…';
      preview.innerHTML = '';
      try {
        await saveImagegenCurrent();out=$('igOut');preview=$('igPreview');
        var v = await api('POST', '/im-bridge/imagegen', { prompt: prompt,workflow:studioSelectedWorkflow(),contextKey:operationPanelContext(),receipt:prepared?.receipt,preparedPrompt:prepared?english:undefined,preparedNegative:prepared?negative:undefined,preparedFixedPrompts:prepared?fixedPrompts:undefined });
        studioResult={name:v.name,text:'已生成：'+v.file+studioSizeNote(v.size)+'（'+Math.round(v.ms/1000)+' 秒）'};studioBusy=false;
        out.textContent = '已生成：' + v.file + studioSizeNote(v.size) + '（' + Math.round(v.ms / 1000) + ' 秒）';
        preview.innerHTML = '<img src="/im-bridge/gen/file?name=' + encodeURIComponent(v.name) + '&t=' + Date.now() +
          '" style="max-width:100%;border-radius:12px;border:1px solid var(--line)">';
        load();
      } catch (e) {
        studioResult={text:'失败：'+e.message};if($('igOut'))$('igOut').textContent = studioResult.text;
      }finally{studioBusy=false;['igTest','igPolish','igSave','rhSave','rhExampleInspect'].forEach(function(id){if($(id))$(id).disabled=false;});}
    };    if ((el = $('phSave'))) el.onclick = async function () {
      await api('POST', '/im-bridge/settings', {
        photo: {
          source: $('phSource').value,
          gender: $('phGender').value,
          appearance: $('phLook').value.trim(),
          minWidth: Number($('phMinWidth').value) || 800
        }
      });
      toast('照片来源已保存');
    };
    if ((el = $('phTest'))) el.onclick = async function () {
      var kw = ($('phTestKw').value || '').trim();
      if (!kw) { toast('写个关键词'); return; }
      var out = $('phTestOut');
      out.textContent = '找图中…';
      try {
        var v = await api('POST', '/im-bridge/photo', { keyword: kw });
        out.textContent = '拿到：' + v.file + '（' + Math.round(v.ms / 1000) + ' 秒）';
      } catch (e) {
        out.textContent = '失败：' + e.message;
      }
    };    Array.prototype.forEach.call(document.querySelectorAll('[data-newgroup]'), function (btn) {
      btn.onclick = async function () {
        var name = await askText('新分组名（例如：开心 / 生气 / 敷衍）');
        if (!name) return;
        var list = (data.settings.stickerGroups || []).slice();
        if (list.indexOf(name.trim()) === -1) list.push(name.trim());
        api('POST', '/im-bridge/settings', { stickerGroups: list })
          .then(function () { toast('已新建分组'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sdelgroup]'), function (btn) {
      btn.onclick = async function () {
        var name = btn.getAttribute('data-sdelgroup');
        if (!await askConfirm('删除分组「' + name + '」？组里的表情会变成未分组，不会被删。')) return;
        var list = (data.settings.stickerGroups || []).filter(function (g) { return g !== name; });
        var map = Object.assign({}, data.settings.stickerGroup || {});
        Object.keys(map).forEach(function (k) { if (map[k] === name) delete map[k]; });
        api('POST', '/im-bridge/settings', { stickerGroups: list, stickerGroup: map })
          .then(function () { toast('分组已删除'); if (sFilter === name) sFilter = ''; load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (box) {
      box.onchange = function () {
        var name = box.getAttribute('data-pick');
        if (box.checked) pickedStickers[name] = true;
        else delete pickedStickers[name];
        var counter = $('pickCount');
        if (counter) counter.textContent = Object.keys(pickedStickers).length;
      };
    });
    if ((el = $('pickApply'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var names = Object.keys(pickedStickers);
      if (!names.length) { toast('先勾选表情'); return; }
      var group = $('pickGroup').value;
      if (group === '__new') {
        var created = await askText('新分组名（例如：开心 / 生气 / 敷衍）');
        if (!created) return;
        group = created.trim();
      }
      var map = Object.assign({}, data.settings.stickerGroup || {});
      names.forEach(function (n) {
        if (group === '') delete map[n];
        else map[n] = group;
      });
      var declared = (data.settings.stickerGroups || []).slice();
      if (group !== '' && declared.indexOf(group) === -1) declared.push(group);
      api('POST', '/im-bridge/settings', { stickerGroup: map, stickerGroups: declared }).then(function () {
        toast('已把 ' + names.length + ' 张分到「' + (group || '未分组') + '」');
        pickedStickers = {};
        load();
      }).catch(function (e) { toast('分组失败：' + e.message); });
    };
    if ((el = $('pickClear'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      pickedStickers = {};
      renderPane();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-delsticker]'), function (btn) {
      btn.onclick = async function () {
        var name = btn.getAttribute('data-delsticker');
        if (!await askConfirm('删除表情「' + name + '」？')) return;
        api('POST', '/im-bridge/stickers', { action: 'delete', name: name }).then(function () { toast('已删除'); load(); });
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll('#msgSeg button'), function (btn) {
      btn.onclick = async function () {
        msgFilter = btn.getAttribute('data-filter');
        renderPane();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-chat]'), function (btn) {
      btn.onclick = async function () {
        msgChat = btn.getAttribute('data-chat');
        renderPane();
      };
    });
    if ((el = $('mClear'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      if (!await askConfirm('清空监听记录？图片文件不会删。')) return;
      api('POST', '/im-bridge/messages', { action: 'clear' }).then(function () { toast('已清空'); load(); });
    };

    if ((el = $('pvGo'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var text = ($('pvText').value || '').trim();
      if (!text) { toast('先说一句'); return; }
      el.disabled = true;
      $('pvMeta').textContent = '她正在想…';
      api('POST', '/im-bridge/preview', { personaId: $('pvPersona').value, text: text })
        .then(function (v) {
          $('pvMeta').textContent = v.name + ' · ' + v.ms + 'ms · 提示词 ' + v.systemChars + ' 字';
          $('pvOut').innerHTML = '<div class="msg out"><div class="meta"><span>她的回复</span></div>' +
            '<div class="body">' + esc(v.reply) + '</div></div>';
        })
        .catch(function (e) { $('pvMeta').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-pv]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-pv');
        var select = $('pvPersona');
        if (select) select.value = id;
        var box = $('pvText');
        if (box) { box.focus(); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      };
    });
    if ((el = $('baseSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { basePersona: $('basePersona').value })
        .then(function () { toast('已保存，下一条消息生效'); load(); })
        .catch(function (e) { toast('保存失败：' + e.message); });
    };
    if ((el = $('baseReset'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { basePersona: '' })
        .then(function () { toast('已恢复默认'); load(); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-iq]'), function (btn) {
      btn.onclick = async function () {
        var level = btn.getAttribute('data-iq');
        var hint = $('iqHint');
        if (hint) hint.textContent = '切换中…';
        api('POST', '/im-bridge/action', { kind: 'switchLevel', level: level })
          .then(function (v) {
            if (hint) hint.textContent = '已切到 ' + v.level + '（' + v.effort + '），结束 ' + v.retired + ' 个会话';
            toast('已切换：' + v.effort);
            load();
          })
          .catch(function (e) { if (hint) hint.textContent = '失败：' + e.message; });
      };
    });
    if ((el = $('monSearch'))) {
      el.oninput = function () {
        monQuery = this.value;
        var pos = this.selectionStart;
        renderPane();
        var again = $('monSearch');
        if (again) {
          again.focus();
          try { again.setSelectionRange(pos, pos); } catch (e) {}
        }
      };
    }
    if ((el = $('thReflect'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var on = !!(data.settings.autonomy && data.settings.autonomy.reflect === false);
      api('POST', '/im-bridge/settings', { autonomy: { reflect: on } })
        .then(function () { toast(on ? '已开启复盘' : '已关闭复盘'); load(); })
        .catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('autoSim'))) el.onclick = async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = '模拟中…';
      toast('正在按五个时间点各想一次（不会真的执行）');
      api('POST', '/im-bridge/autonomy', { action: 'simulate' })
        .then(function (v) {
          var rows = (v.results || []).map(function (r) {
            var name = { signature: '改签名', nickname: '改昵称', qzone: '发空间', chat: '找人', none: '不动' }[r.action] || r.action;
            var state = r.wouldRun ? '会执行' : (r.rejected || r.skipped || '不会执行');
            return r.slot + '  ' + name + '  [' + state + ']  ' + (r.text || '') + (r.reason ? '（' + r.reason + '）' : '');
          });
          alert('模拟结果：\n\n' + (rows.join('\n\n') || '没有结果'));
        })
        .catch(function (e) { toast('失败：' + e.message); })
        .finally(function () { btn.disabled = false; btn.textContent = '模拟一天'; });
    };
    if ((el = $('warnHide'))) el.onclick = async function () {
      var self = this;
      try { window.localStorage.setItem('qqb-warn', '1'); } catch (e) {}
      self.blur();
      renderPane();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-goautonomy]'), function (btn) {
      btn.onclick = async function () { navigate('autonomy'); };
    });
    if ((el = $('thTick'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      reportClient('点击 想法-想一次');
      // 用 this 而不是外层共享的 el：el 早被后面几十个绑定改写成别的元素了。
      var btn = this;
      btn.disabled = true;
      btn.textContent = '她在想…';
      toast('她在想…（最多等一分钟）');
      api('POST', '/im-bridge/autonomy', { action: 'tick' })
        .then(function (v) {
          var r = v.result || {};
          var label = r.action || '?';
          var extra = r.reason ? '（' + r.reason + '）' : r.rejected ? '（被拒：' + r.rejected + '）' : r.error ? '（失败：' + r.error + '）' : '';
          toast('她的决定：' + label + extra);
          load();
        })
        .catch(function (e) { toast('失败：' + e.message); })
        .finally(function () { btn.disabled = false; btn.textContent = '现在想一次'; });
    };
    if ((el = $('autoMaster'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var next = !(data.status.autonomy && data.status.autonomy.config && data.status.autonomy.config.enabled);
      api('POST', '/im-bridge/settings', { autonomy: { enabled: next } })
        .then(function () { toast(next ? '自主模式已开启' : '自主模式已关闭'); load(); })
        .catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('autoStop'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/autonomy', { action: 'stop' })
        .then(function () { toast('已紧急停止'); load(); })
        .catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('autoTick'))) el.onclick = async function () {
      var el = this, btn = this;
      reportClient('点击 自主-想一次');
      el.disabled = true;
      $('autoTick').textContent = '她在想…';
      api('POST', '/im-bridge/autonomy', { action: 'tick' })
        .then(function (v) {
          var r = v.result || {};
          var label = r.action ? (r.action + (r.rejected ? '（被拒：' + r.rejected + '）' : r.skipped ? '（额度/时段限制）' : r.ok ? '（已执行）' : '')) : '没动作';
          toast('她的决定：' + label);
          load();
        })
        .catch(function (e) { toast('失败：' + e.message); })
        .finally(function () { btn.disabled = false; btn.textContent = '现在想一次'; });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-auto]'), function (btn) {
      btn.onclick = async function () {
        var key = btn.getAttribute('data-auto');
        var patch = { autonomy: {} };
        patch.autonomy[key] = !(data.status.autonomy.config[key]);
        api('POST', '/im-bridge/settings', patch)
          .then(function () { toast('已设置'); load(); })
          .catch(function (e) { toast('失败：' + e.message); });
      };
    });
    if ((el = $('autoSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', {
        autonomy: {
          ...optionalSetting('autoIdle','chatIdleMinutes','number'),...optionalSetting('autoPrivateGap','privateMinGapMinutes','number'),...optionalSetting('autoExplore','explore','checked'),...optionalSetting('autoQzoneImages','qzoneImages','checked'),qzoneReplies:$('autoQzoneReplies').checked,
          ...optionalSetting('autoWakeA','wakeStart','number'),
          ...optionalSetting('autoWakeB','wakeEnd','number')
        }
      }).then(function () { toast('已保存'); load(); }).catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('mProvider'))) el.onchange = function () { fillModels(''); };
    if ((el = $('mSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { model: { provider: $('mProvider').value, model: $('mModel').value } })
        .then(function () { toast('已切换，下一条消息生效'); load(); })
        .catch(function (e) { toast('保存失败：' + e.message); });
    };
    if ((el = $('mReset'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { model: null })
        .then(function () { toast('已恢复默认'); load(); })
        .catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('accAdd'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var url = ($('accUrl').value || '').trim();
      if (!/^wss?:\/\//.test(url)) { toast('地址要以 ws:// 开头'); return; }
      var accounts = (data.settings.accounts || []).slice();
      accounts.push({
        id: 'acc' + Date.now(),
        name: ($('accName').value || '').trim() || ('账号 ' + (accounts.length + 1)),
        wsUrl: url,
        token: ($('accToken').value || '').trim()
      });
      api('POST', '/im-bridge/settings', { accounts: accounts }).then(function () { toast('已添加'); load(); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-accuse]'), function (btn) {
      btn.onclick = async function () {
        api('POST', '/im-bridge/settings', { activeAccountId: btn.getAttribute('data-accuse') })
          .then(function () { toast('已切换，正在重连'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-accdel]'), function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-accdel');
        if (!await askConfirm('删除这个账号？')) return;
        var accounts = (data.settings.accounts || []).filter(function (a) { return a.id !== id; });
        var patch = { accounts: accounts };
        if (data.settings.activeAccountId === id) patch.activeAccountId = '';
        api('POST', '/im-bridge/settings', patch).then(function () { toast('已删除'); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chatModel'), function (select) {
      select.onchange = function () {
        var key = select.getAttribute('data-key');
        var value = select.value;
        var map = JSON.parse(JSON.stringify(data.settings.modelByChat || {}));
        if (!value) delete map[key];
        else {
          var parts = value.split('|');
          map[key] = { provider: parts[0], model: parts[1] };
        }
        api('POST', '/im-bridge/settings', { modelByChat: map })
          .then(function () { toast('已保存，下一轮生效'); load(); });
      };
    });
    
    if ((el = $('memToggle'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { memory: { enabled: !(data.settings.memory && data.settings.memory.enabled !== false) } })
        .then(function () { toast('已保存'); load(); });
    };
    if ((el = $('memSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { memory: { schedule:'daily',mode:'auto', maxChars: Number($('memChars').value) } })
        .then(function () { toast('已保存'); load(); });
    };
    
    
    if ((el = $('cacheMove'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var dir = ($('cacheInput').value || '').trim();
      if (!dir) { toast('填一个路径'); return; }
      if (!await askConfirm('把缓存迁移到 ' + dir + ' ？会移动日志、监听历史、语音和表情包。')) return;
      el.disabled = true;
      $('cacheOut').textContent = '迁移中…';
      api('POST', '/im-bridge/settings', { cacheDir: dir })
        .then(function () { $('cacheOut').textContent = '已迁移到 ' + dir; toast('已迁移'); load(); })
        .catch(function (e) { $('cacheOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('cacheDefault'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { cacheDir: '' })
        .then(function () { toast('已恢复默认路径'); load(); });
    };
    if($('cachePreview'))$('cachePreview').onclick=async()=>{try{var r=await api('POST','/im-bridge/storage',{action:'preview-clean'});$('cacheOut').textContent='可整理 '+Number(r.removed.files)+' 个临时文件，约 '+fmtSize(r.removed.bytes)+'；收藏、作品和记忆保留。';}catch(e){toast(e.message);}};
    if($('mySpaceSave'))$('mySpaceSave').onclick=async()=>{try{await api('POST','/im-bridge/settings',{mySpaceMaxMB:Number($('mySpaceMax').value)||1024});toast('我的文件上限已保存');}catch(e){toast(e.message);}};
    if($('cachePolicy'))$('cachePolicy').onclick=async()=>{try{await api('POST','/im-bridge/settings',{mediaRetention:{enabled:$('cacheAuto').checked,days:Number($('cacheDays').value),maxMB:Number($('cacheMax').value)}});toast('临时媒体整理规则已保存');}catch(e){toast(e.message);}};
    if ((el = $('cacheClean'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      if (!await askConfirm('按当前保留策略清理过期或超额临时媒体？收藏、作品、正在发送的文件和记忆保留。')) return;
      api('POST', '/im-bridge/storage', { action: 'clean' })
        .then(function (v) { toast('已清理：' + Number(v.removed?.files||0)+' 个临时文件，'+fmtSize(v.removed?.bytes||0)); load(); })
        .catch(function (e) { toast('清理失败：' + e.message); });
    };
    if ((el = $('vSaveEngine'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', {
        voice: {
          engine: $('vEngine').value,

          customUrl: ($('vCustomUrl').value || '').trim(),
          customVoice: ($('vCustomVoice').value || '').trim()
        }
      }).then(function () { toast('已保存'); load(); });
    };
    if ((el = $('searxSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', {
        search: {
          engine: $('seEngine').value,
          searxUrl: ($('searxUrl').value || '').trim(),
          customUrl: ($('seCustomUrl').value || '').trim()
        }
      }).then(function () { toast('已保存'); load(); });
    };
    if ((el = $('memDirSave'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { memoryDir: ($('memDir').value || '').trim() })
        .then(function () { toast('记忆位置已更新'); load(); })
        .catch(function (e) { toast('失败：' + e.message); });
    };
    if ((el = $('vSamplesBtn'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      el.disabled = true;
      $('vSamples').innerHTML = '<div class="muted">生成中，约 10–20 秒…</div>';
      api('POST', '/im-bridge/voice/samples', { text: ($('vText').value || '').trim() || '喂，今天吃什么，我饿了' })
        .then(function (v) {
          var target = (data.status.chats[0] && data.status.chats[0].key) || ('private:' + (data.status.allowUsers[0] || ''));
          var html = v.samples.map(function (s) {
            if (!s.ok) return '<div class="row"><span>' + esc(s.label) + '</span><span class="muted">合成失败</span></div>';
            return '<div class="row"><span>' + esc(s.label) + '</span><span class="btnrow">' +
              '<audio controls preload="none" src="/im-bridge/audio?name=' + encodeURIComponent(s.name) + '" style="height:34px"></audio>' +
              '<button class="small" data-sendsample="' + esc(s.name) + '" data-target="' + esc(target) + '">发到QQ</button></span></div>';
          }).join('');
          $('vSamples').innerHTML = html;
          Array.prototype.forEach.call(document.querySelectorAll('[data-sendsample]'), function (btn) {
            btn.onclick = async function () {
              api('POST', '/im-bridge/audio', { name: btn.getAttribute('data-sendsample'), target: btn.getAttribute('data-target') })
                .then(function () { toast('已发到 QQ'); })
                .catch(function (e) { toast('发送失败：' + e.message); });
            };
          });
        })
        .catch(function (e) { $('vSamples').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('vToggle'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      api('POST', '/im-bridge/settings', { voice: { enabled: !(data.settings.voice && data.settings.voice.enabled) } })
        .then(function () { toast('已保存'); load(); });
    };
    
    if ((el = $('aiPersonaBtn'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var desc = ($('aiPersonaDesc').value || '').trim();
      if (!desc) { toast('先写一句描述'); return; }
      el.disabled = true;
      $('aiPersonaOut').textContent = '生成中…（约 3–10 秒）';
      api('POST', '/im-bridge/ai/persona', { description: desc }).then(function (v) {
        $('aiPersonaOut').innerHTML = '<b>' + esc(v.persona.name) + '</b> · ' + esc(v.persona.preset) + '\n' + esc(v.persona.prompt) +
          '\n\n<button class="primary small" id="aiAdopt">采用这个人设</button>';
        var adopt = $('aiAdopt');
        if (adopt) adopt.onclick = async function () {
          var personae = (data.settings.personae || []).slice();
          personae.push({ id: 'p' + Date.now(), name: v.persona.name, preset: v.persona.preset, prompt: v.persona.prompt });
          api('POST', '/im-bridge/settings', { personae: personae }).then(function () { toast('已加入列表'); load(); });
        };
      }).catch(function (e) { $('aiPersonaOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('pageGo'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var url = ($('pageUrl').value || '').trim();
      if (!/^https?:\/\//i.test(url)) { toast('贴一个 http(s) 链接'); return; }
      el.disabled = true;
      $('pageOut').textContent = '抓取中…';
      api('POST', '/im-bridge/stickers/page', {
        url: url,
        name: ($('pageName').value || '').trim() || 'page',
        limit: Number($('pageLimit').value) || 15
      })
        .then(function (v) {
          $('pageOut').textContent = '新增 ' + (v.added || []).length + ' 张：' + ((v.added || []).join('、') || '无');
          toast('收下 ' + (v.added || []).length + ' 张');
          load();
        })
        .catch(function (e) { $('pageOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('harvestGo'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var raw = ($('harvestQueries').value || '').trim();
      if (!raw) { toast('写几个关键词'); return; }
      var queries = raw.split(/[,，、\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      el.disabled = true;
      $('harvestOut').textContent = '下载并打分中，可能要一两分钟…';
      api('POST', '/im-bridge/stickers/harvest', {
        queries: queries,
        name: ($('harvestName').value || '').trim() || queries[0],
        limit: Number($('harvestLimit').value) || 12
      })
        .then(function (v) {
          $('harvestOut').textContent = '新增 ' + (v.added || []).length + ' 张：' + ((v.added || []).join('、') || '无');
          toast('收集完成，新增 ' + (v.added || []).length + ' 张');
          load();
        })
        .catch(function (e) { $('harvestOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('noteFill'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      el.disabled = true;
      $('noteMeta').textContent = '看图识别中…';
      api('POST', '/im-bridge/stickers/notes', { limit: 6 })
        .then(function (v) {
          $('noteMeta').textContent = '已识别 ' + v.described + ' / ' + v.total + ' 张';
          var lines = Object.keys(v.notes || {}).map(function (k) { return k + '：' + v.notes[k]; });
          $('noteOut').textContent = lines.join('\n') || '这次没识别出新的';
          if ((v.added || []).length) toast('识别了 ' + v.added.length + ' 张');
          load();
        })
        .catch(function (e) { $('noteMeta').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
    if ((el = $('visGo'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var input = $('visFile');
      var file = input && input.files && input.files[0];
      if (!file) { toast('先选一张图'); return; }
      if (file.size > 8 * 1024 * 1024) { toast('图别超过 8MB'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        el.disabled = true;
        $('visMeta').textContent = '看图 + 搜图中…';
        api('POST', '/im-bridge/stickers/visual', { data: String(reader.result), limit: 4 })
          .then(function (v) {
            $('visMeta').textContent = '新增 ' + (v.added || []).length + ' 张';
            $('visOut').textContent = '画面：' + (v.desc || '—') +
              '\n关键词：' + ((v.keywords || []).join('、') || '—') +
              '\n新增：' + ((v.added || []).join('、') || '无');
            load();
          })
          .catch(function (e) { $('visMeta').textContent = '失败：' + e.message; })
          .finally(function () { el.disabled = false; });
      };
      reader.readAsDataURL(file);
    };
    if ((el = $('aiStickerBtn'))) el.onclick = async function () {
      var el = this; // 捕获当次元素
      var query = ($('aiStickerQuery').value || '').trim();
      if (!query) { toast('先写关键词'); return; }
      el.disabled = true;
      $('aiStickerOut').textContent = '搜索中…';
      api('POST', '/im-bridge/ai/stickers', { query: query }).then(function (v) {
        $('aiStickerOut').textContent = '已添加：' + v.added.join('、');
        toast('已添加 ' + v.added.length + ' 张'); load();
      }).catch(function (e) { $('aiStickerOut').textContent = '失败：' + e.message; })
        .finally(function () { el.disabled = false; });
    };
  }

  var formState = createFormState();
  var formBaselines = formState.baselines;
  var pageDrafts = formState.drafts;
  var renderedEditingId = '';
  var navigationPending = false;
  var mutationEpoch = 0;
  var syncPending = false;
  var lastSnapshotAt = 0;
  var personaTool = '';

  function formKey(el) {
    if(['ctDate','ctScope','cpGraphSearch','cpGraphEvents','localParameterPicker'].includes(el.id))return '';
    if(el.id==='phPassword')return '';
    if(['piFile','piPersona'].includes(el.id))return '';
    if(el.id==='rhExample')return '';
    if(el.id==='rhQueue')return el.id+'@'+renderedRhWorkflow;
    if(el.hasAttribute('data-studio-param'))return 'studio:'+el.getAttribute('data-studio-param')+'@'+renderedRhWorkflow;
    if (el.id === 'rhChoice'||el.id==='rhPromptChoice') return '';
    if(el.id==='rhAuto')return el.id+'@'+renderedRhWorkflow;
    if (/^rh(?:Name|Note|Mode|Id|Node|Field|Instance|Extra|Style|Reference|PromptModel|FixedMode|Triggers)$/.test(el.id)) return el.id+'@'+renderedRhWorkflow;
    var featureKey = featureFieldKey(el); if (featureKey !== null) return featureKey;
    if (el.id === 'monSearch' || el.id === 'soulChat' || el.id === 'learnSearch') return '';
    if (el.id === 'pName' || el.id === 'pPrompt') return el.id + '@' + (renderedEditingId || 'new');
    return el.id || (el.hasAttribute('data-note') ? 'note:' + el.getAttribute('data-note') : el.hasAttribute('data-pick') ? 'pick:' + el.getAttribute('data-pick') : '');
  }
  function readForm() {
    var values = {};
    if (!$('pane')) return values;
    Array.prototype.forEach.call($('pane').querySelectorAll('input, textarea, select'), function (el) {
      var key = formKey(el);
      if (!key || el.readOnly) return;
      values[key] = el.type === 'file' ? { type: 'file', files: el.files, signature: Array.prototype.map.call(el.files || [], function (f) { return f.name + ':' + f.size + ':' + f.lastModified; }).join('|') } : el.type === 'checkbox' ? el.checked : el.value;
    });
    return values;
  }
  function sameValue(a, b) {
    return sameFormValue(a, b);
  }
  function rememberDraft(page) {
    if(['overview','daily','diary','star','study'].includes(page))return;
    if (!page || !formBaselines[page] || renderedTab !== page) return;
    formState.capture(page, readForm());
  }
  function startFormTracking() {
    featurePrepareFormContext();
    renderedEditingId = editingId;
    formState.begin(tab, readForm());
    var draft = pageDrafts[tab] || {};
    Array.prototype.forEach.call($('pane').querySelectorAll('input, textarea, select'), function (el) {
      var key = formKey(el);
      if (!Object.prototype.hasOwnProperty.call(draft, key)) return;
      var value = draft[key];
      if (el.type === 'file') { try { el.files = value.files; } catch (e) {} }
      else if (el.type === 'checkbox') el.checked = value;
      else el.value = value;
    });
    if ($('sendCustom') && $('sendTarget')) $('sendCustom').style.display = $('sendTarget').value === '__custom' ? '' : 'none';
    if ($('basePersona') && Object.prototype.hasOwnProperty.call(draft, 'basePersona') && $('basePersonality')) $('basePersonality').open = true;
    renderDraftNotice();
  }
  function renderDraftNotice() {
    syncFloatingSave();
    var notice = $('draftNotice');
    if (!notice) return;
    var count = Object.keys(pageDrafts[tab] || {}).length;
    notice.hidden = !count;
    if ($('draftText')) $('draftText').textContent = '有 ' + count + ' 项未保存修改';
  }
  var floatingSaveBusy=false, floatingSaveCapture=null;
  function floatingSaveTargets() {
    var dirty=pageDrafts[tab]||{},buttons=new Set();
    if(tab==='local'&&localDraftEditing&&$('localSave')&&!$('localSave').disabled)buttons.add('localSave');
    var allowed=new Set(['agSave','phSave','grSave','shSave','soulSave','vgSave','igSave','mSave','memSave','memDirSave','ownerSave','groupSave','baseSave','autoSave','vSave','vSaveEngine','vsSave','voiceStudioSave','searxSave','pickApply','mfSave','pfSave','dlSave','connectionModeSave','connectionRoutesSave','connectionSave','localSave','localInitiativeSave','cacheSave','pSave','careSave','learnSave','pcSave','wSave','accSave','lifeSave','profileSave','rlSave','rhSave']);
    var fields=Array.from($('pane')?.querySelectorAll('input,textarea,select')||[]);
    Object.keys(dirty).forEach(function(key){
      var field=fields.find(function(el){return formKey(el)===key;});if(!field)return;
      var id=field.id,target='';
      if(/^connection(?:WholeMode|Complement|TaskAssist)$/.test(id))target='connectionModeSave';
      else if(/^connection(?:Route|RoutingEnabled)/.test(id))target='connectionRoutesSave';
      else if(/^connection/.test(id))target='connectionSave';
      else if(id==='localInitiativeEnabled')target='localInitiativeSave';
      else if(/^local/.test(id))target='localSave';
      else if(/^ag/.test(id))target='agSave';
      else if(/^v(?:Engine|Custom|Mood|Mini|Breeze)/.test(id))target='vSaveEngine';
      else if(/^(?:ig|rh)/.test(id))target='igSave';
      else if(/^(?:mood|websites|videoPlus)/.test(id))target='soulSave';
      else if(id==='basePersona')target='baseSave';
      else if(id==='memDir')target='memDirSave';
      else if(/^vg/.test(id))target='vgSave';
      if(target&&$(target)&&!$(target).disabled){buttons.add(target);return;}
      var card=field.closest('.card'),options=card?Array.from(card.querySelectorAll('button[id]')).filter(function(b){return allowed.has(b.id)&&!b.disabled&&typeof b.onclick==='function';}):[];
      if(options.length===1)buttons.add(options[0].id);
    });
    if(buttons.has('connectionModeSave')&&buttons.has('connectionRoutesSave'))buttons.delete($('connectionRoutingEnabled')?.checked?'connectionModeSave':'connectionRoutesSave');
    return [...buttons];
  }
  function syncFloatingSave(message,state) {
    var button=$('saveCurrentPage'),status=$('saveDockStatus'),dock=$('saveDock'),bar=$('panelDock');if(!button||!status||!dock||!bar)return;
    var count=Object.keys(pageDrafts[tab]||{}).length,targets=floatingSaveTargets();if(tab==='local'&&localDraftEditing&&!count)count=1;
    var supported=!['prompts','overview','daily','diary','star','study','monitor','delivery','invocations','logs'].includes(tab);
    bar.hidden=!supported||!(count||floatingSaveBusy||state==='failed');
    dock.style.removeProperty('display');
    button.disabled=floatingSaveBusy||!targets.length;button.textContent=floatingSaveBusy?'正在保存…':'保存当前页';
    if(message)status.textContent=message;else if(floatingSaveBusy)status.textContent='正在提交并核对设置…';else status.textContent=count?'有 '+count+' 项修改尚未保存':'当前页已保存';
    status.title=status.textContent;dock.dataset.state=state||(count?'dirty':'saved');bar.dataset.state=dock.dataset.state;
  }
  async function saveFloatingPage() {
    if(floatingSaveBusy)return false;rememberDraft(tab);var origin=tab,targets=floatingSaveTargets();
    if(!targets.length){syncFloatingSave('本页没有可一键保存的设置；操作或草稿请使用对应按钮。');return false;}
    floatingSaveBusy=true;syncFloatingSave();var failure='';
    try{
      for(var id of targets){
        if(tab!==origin||renderedTab!==origin)break;
        var button=$(id);if(!button||button.disabled||typeof button.onclick!=='function')continue;
        floatingSaveCapture=[];
        try{await button.onclick.call(button,new Event('click'));}catch(error){failure=error.message;}
        var results=await Promise.allSettled(floatingSaveCapture);floatingSaveCapture=null;
        var rejected=results.find(function(r){return r.status==='rejected';});if(rejected)failure=rejected.reason?.message||'保存请求未成功';
        if(failure)break;
      }
    }finally{floatingSaveCapture=null;floatingSaveBusy=false;rememberDraft(tab);
      var remaining=Object.keys(pageDrafts[tab]||{}).length;if(tab==='local'&&localDraftEditing&&!remaining)remaining=1;
      syncFloatingSave(failure?'未保存成功：'+failure:remaining?'部分修改尚未保存，请检查本页对应设置。':'当前页设置已保存',failure?'failed':remaining?'dirty':'saved');
    }
    return !failure&&tab===origin&&!Object.keys(pageDrafts[origin]||{}).length&&!(origin==='local'&&localDraftEditing);
  }
  function fieldsSavedBasic(url, payload, editId) {
    var keys = [];
    function add(ids) { keys = keys.concat(ids); }
    if(url==='/im-bridge/device-profiles'&&payload.action==='save')return ['profileWsUrl','profileToken','profileClearToken','profileNapcatDir','profileLauncher'];
    if(url==='/im-bridge/directives')return Object.keys(readForm()).filter(function(key){return /^dir(?:Name|Text|Scope|Kind|Time|Stop|Confirm)/.test(key);});
    if (url === '/im-bridge/send') return ['sendText','sendVoice','sendSticker','sendTarget','sendCustom'];
    if (url === '/im-bridge/presets') return ['pName@' + (editId || 'new'), 'pPrompt@' + (editId || 'new')];
    if (url === '/im-bridge/stickers') return ['sName','sFile'];
    if(url==='/im-bridge/service-connections'&&payload.action==='save')return Object.keys(readForm()).filter(function(key){return /^connection/.test(key)&&!/^connection(?:WholeMode|Complement|TaskAssist|Route|RoutingEnabled)/.test(key);});
    if(url==='/im-bridge/service-connections'&&payload.action==='mode')return ['connectionWholeMode','connectionComplement','connectionTaskAssist','connectionRoutingEnabled','connectionRouteChat','connectionRouteImage','connectionRouteSpeech','connectionRouteVideo'];
    if(url==='/im-bridge/service-connections'&&payload.action==='routes')return ['connectionWholeMode','connectionComplement'].concat(Object.keys(readForm()).filter(function(key){return /^connection(?:Route|RoutingEnabled)/.test(key);}));
    if (url === '/im-bridge/local' && payload.action==='save') return Object.keys(readForm()).filter(function(key){return /^local/.test(key);});
    if (url !== '/im-bridge/settings') return keys;
    if ('localChat' in payload){if('enabled' in payload.localChat)add(['connectionWholeMode']);if('apiComplement' in payload.localChat)add(['connectionComplement']);if('apiTaskAssist' in payload.localChat)add(['connectionTaskAssist']);if('initiativeEnabled' in payload.localChat)add(['localInitiativeEnabled']);}
    if ('companion' in payload) add(['careEnabled','careContinuity','carePauses','careWait','careExpression','careCasual','careBubbles']);
    if ('mood' in payload) add(['moodEnabled','moodEvery','moodConfidence','moodDecay']);
    if ('learning' in payload) add(['learnEnabled','learnPassive','learnActive','learnFocus','learnInterval','learnDaily']);
    if ('websites' in payload) add(['websitesEnabled','websitesLearning','websitesAutoShare','websitesInterval','websitesSources']);
    if ('media' in payload) add(['videoPlusEnabled']);
    if ('basePersona' in payload) add(['basePersona']);
    if ('personae' in payload) add(['pName@' + (editId || 'new'), 'pPrompt@' + (editId || 'new'), 'pImport']);
    if ('owners' in payload) add(['ownersInput']);
    if ('whitelist' in payload) add(['qqInput']);
    if ('groups' in payload) add(['groupInput']);
    if ('accounts' in payload) add(['accName','accUrl','accToken']);
    if ('model' in payload) add(['mProvider','mModel']);
    if ('memory' in payload && ('everyTurns' in payload.memory || 'maxChars' in payload.memory)) add(['memTurns','memChars','memMode','memSchedule']);
    if ('life' in payload) add(['lifeEnabled','lifeExecute','lifeSleep','lifeBudget','lifeMinGap']);
    if ('realism' in payload) add(Object.keys(readForm()).filter(function(key){return /^rl/.test(key);}));
    if ('wallet' in payload) add(['wEnabled','wReactions','wMoney','wCoins']);
    if ('memoryDir' in payload) add(['memDir']);
    if ('cacheDir' in payload) add(['cacheInput']);if('mediaRetention' in payload)add(['cacheAuto','cacheDays','cacheMax']);
    if ('proactiveCfg' in payload) add(['pcStart','pcEnd','pcMax']);
    if ('search' in payload) add(['seEngine','searxUrl','seCustomUrl']);
    if ('photo' in payload) add(['phSource','phGender','phLook','phMinWidth']);
    if ('voice' in payload && Object.keys(payload.voice).some(function (k) { return k !== 'enabled'; })) add(Object.keys(readForm()).filter(function(key){return /^v(?:Engine|Custom|Mood|Mini|Breeze)/.test(key);}));
    if('qzoneAccess' in payload)add(['qzoneEnabled']);
    if('videogen' in payload)add(['vgEnabled','vgSeconds','vgSize','vgAction','vgCamera','vgProfile','vgName','vgUrl','vgKey','vgModel','vgMode','vgCreatePath','vgStatusPath','vgContentPath']);
    if ('imagegen' in payload) { add(['igEnabled','igProvider','igDir','igKey','igModel','igSize','igSteps','igCfg','igSeed','rhKey']); add(Object.keys(readForm()).concat(Object.keys(pageDrafts.imagegen||{})).filter(function(key){return /^(?:rh(?:Name|Note|Mode|Id|Node|Field|Instance|Extra|Style|Reference|PromptModel|FixedMode|Triggers|Queue|Auto)@|studio:)/.test(key);})); }
    if ('agency' in payload) add(['agEnabled','agAutonomous','agBrowser','agDesktop','agPhone','agWorkspace','agBrowserExecutable','agBrowserEngine','agBackground']);
    if ('phone' in payload) add(['phEnabled','phAutonomous','phDevice','phPayMode','phPayMethod','phAmount','phDailyAmount']);
    if('personaGrowth' in payload) add(['grEnabled','grDaily','grDailyDays','grDailyMinUser']);
    if ('autonomy' in payload && 'shareMedia' in payload.autonomy) add(['shEnabled','shVoice','shImages','shDuring','shIdle','shSchedule']);
    if ('autonomy' in payload) add(['autoWakeA','autoWakeB','autoIdle','autoExplore','autoQzoneImages','autoQzoneReplies']);
    if ('userNotes' in payload) add(Object.keys(payload.userNotes).flatMap(function (k) { return ['note:'+k,'ownerAddress_'+k]; }));
    return keys;
  }
  function markSaved(origin, submitted, keys) {
    var now = renderedTab === origin ? readForm() : null;
    formState.acknowledge(origin, submitted, keys, now);
    if (renderedTab === origin) renderDraftNotice();
  }
  /* 全局反馈：任何保存、删除、执行的结果都在屏幕下方留一句，不用回头找页面。 */
  var feedEntries = [], feedHideTimer = null, feedDedup = new Map();
  function feedHost() {
    var el = document.getElementById('globalFeedback');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalFeedback';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:1200;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;max-width:min(92vw,520px)';
      document.body.appendChild(el);
    }
    return el;
  }
  function feed(text, tone) {
    var key = String(text).slice(0, 120), now = Date.now();
    if ((feedDedup.get(key) || 0) > now - 20000) return;
    feedDedup.set(key, now);
    feedEntries.push({ at: now, text: text, tone: tone || '' });
    if (feedEntries.length > 4) feedEntries.shift();
    var box = feedHost();
    box.replaceChildren();
    feedEntries.forEach(function (item, index) {
      var row = document.createElement('div');
      row.textContent = item.text;
      row.style.cssText = 'padding:7px 13px;border-radius:11px;font-size:12px;line-height:1.5;box-shadow:0 4px 16px #0002;max-width:100%;overflow-wrap:anywhere;color:#fff;opacity:' + (index === feedEntries.length - 1 ? '1' : '.7') + ';background:' + (item.tone === 'bad' ? '#8f2f2f' : item.tone === 'good' ? '#256b47' : '#3a4250');
      box.appendChild(row);
    });
    if (feedHideTimer) clearTimeout(feedHideTimer);
    feedHideTimer = setTimeout(function () {
      feedEntries = [];
      var host = document.getElementById('globalFeedback');
      if (host) host.replaceChildren();
    }, 5000);
  }
  function feedName(url) {
    var names = {
      '/im-bridge/settings': '设置', '/im-bridge/presets': '人设卡', '/im-bridge/features/companion': '小世界',
      '/im-bridge/features/wallet': '余额', '/im-bridge/features/sharing': '分享',
      '/im-bridge/life-execution': '日程', '/im-bridge/operations': '待决定的事', '/im-bridge/directives': '长期指令',
      '/im-bridge/service-connections': '连接', '/im-bridge/device-profiles': '设备配置', '/im-bridge/device-sync': '设备同步',
      '/im-bridge/deliveries': '发送记录', '/im-bridge/qzone': '空间', '/im-bridge/website-mcp': '网站工具',
      '/im-bridge/storage': '存储', '/im-bridge/login': 'QQ 登录', '/im-bridge/local': '本地服务',
      '/im-bridge/features/phone': '手机', '/im-bridge/invocations': '调用记录'
    };
    return names[url] || String(url || '').replace('/im-bridge/', '');
  }

  function api(method, url, payload) {
    if(method==='POST'&&deviceUiPreview()&&!window.QQBridgeDeviceUI?.previewWriteAllowed(url,payload))return Promise.reject(Error('当前为另一设备的界面预览，请在实际运行设备打开插件后操作。'));
    var writes = !passiveConsoleRequest(method,url,payload);
    var origin = tab;
    var submitted = writes ? readForm() : {};
    var editId = renderedEditingId;
    if (writes) mutationEpoch += 1;
    var operation=requestApi(method, url, payload).then(function (value) {
      if(url==='/im-bridge/local'&&payload?.action==='save'&&value?.verified!==true)throw Error('后台未确认配置回读，请重启 DSH 后检查实际状态');
      if (writes) {
        mutationEpoch += 1;
        markSaved(origin, submitted, fieldsSaved(url, payload || {}, editId));
        if ((url === '/im-bridge/presets' || (url === '/im-bridge/settings' && payload && payload.personae)) && origin === 'persona') personaTool = '';
      }
      if (writes) feed((fieldsSaved(url,payload||{},editId).length?'已保存 · ':'操作完成 · ') + feedName(url), 'good');
      return value;
    }, function (error) {
      if (writes) mutationEpoch += 1;
      if (writes) feed('没成 · ' + feedName(url) + '：' + String(error && error.message || error).slice(0, 90), 'bad');
      throw error;
    });
    if(writes&&floatingSaveCapture)floatingSaveCapture.push(operation);
    return operation;
  }
  async function navigate(page, updateHash) {
    if(!pageVisible(page))page='overview';
    if (!PAGE_HEADS[page]) page = 'overview';
    if (navigationPending || (page === tab && renderedTab === tab)) return;
    var previous = tab;
    if (updateHash === false) history.replaceState(null, '', '#' + previous);
    rememberDraft(previous);
    if (Object.keys(pageDrafts[previous] || {}).length || previous==='local'&&localDraftEditing) {
      if (!$('modal').hidden) return;
      navigationPending = true;
      var canSave=floatingSaveTargets().length>0;
      var decision = showModal(canSave?'这页还有未保存的修改。保存成功后再切换；若保存失败，会留在本页供你检查。':'这页有未保存的输入，但没有可自动保存的设置。请先使用本页对应操作，或明确放弃这些输入后切换。', false, '', canSave?'保存并切换':'放弃输入并切换');
      $('modalCancel').textContent = '继续编辑';
      var leave;
      try {
        leave = await decision;
        if (leave && canSave) {
          leave = await saveFloatingPage();
          if (!leave) toast('这页还有修改没保存成功，已留在本页，请检查保存提示');
        } else if (leave) formState.discard(previous);
      } finally { navigationPending = false; }
      if (!leave) return;
    }
    groupLastPages[groupFor(page).id] = page;
    tab = page;
    closeSearch();
    if (page === 'overview' && data) {
      /* 切回首页时静默对一次数：只动数字，不重排版面。 */
      setTimeout(function () { if (tab === 'overview') { void refreshCompanionPanel(); void syncLiveSnapshot(); } }, 120);
    }
    if (updateHash === false) history.replaceState(null, '', '#' + page);
    else if (location.hash !== '#' + page) history.pushState(null, '', '#' + page);
    if (data) renderPane();
  }
  var overviewRenderSig = '';
  function overviewSignature() {
    try {
      var c = companionPanel.value || {};
      return JSON.stringify([
        data?.status?.connected, data?.status?.accountPaused, data?.status?.selfId, data?.status?.personaName,
        c.sleep === true, c.today?.day,
        c.diary?.days?.slice(-1)?.[0]?.day, c.diary?.days?.slice(-1)?.[0]?.text,
        c.decisions?.pending?.length
      ]);
    } catch (e) { return 'sig-' + Date.now(); }
  }
  function renderOverviewIfChanged() {
    var sig = overviewSignature();
    if (sig === overviewRenderSig) return;
    overviewRenderSig = sig;
    renderPane();
  }

  async function syncLiveSnapshot() {
    if (syncPending || !data || document.hidden) return;
    syncPending = true;
    var epoch = mutationEpoch;
    var wantedMessages = tab === 'overview';
    try {
      var snapshot = await Promise.all([api('GET', '/im-bridge/settings'), wantedMessages ? api('GET', '/im-bridge/messages') : Promise.resolve(null), api('GET', '/im-bridge/features').catch(function () { return null; }), tab === 'connection' ? api('GET', '/im-bridge/login').catch(function () { return null; }) : Promise.resolve(null)]);
      if (epoch !== mutationEpoch) return;
      var oldStatus = data.status;
      var oldQqLoggedIn = login && login.qqLoggedIn;
      if (snapshot[3]) login = snapshot[3];
      data = snapshot[0]; var previousUiDevice=uiDevice; mobileUiPolicy();if(previousUiDevice!==uiDevice){rememberDraft(renderedTab);initNavigation();renderPane();}
      if (snapshot[2]) featureData = snapshot[2];
      if (snapshot[1]) monitor = snapshot[1];
      lastSnapshotAt = Date.now();
      renderPill();
      var modalOpen = !$('modal').hidden;
      if ($('liveSnapshot')) $('liveSnapshot').textContent = '实时同步状态 · ' + new Date(lastSnapshotAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      updateHomeNumbers();
      /* 首页自动同步只更新文字，不整页重画：重画会让整页跳一下。 */
      if (tab === 'connection' && !modalOpen && !Object.keys(pageDrafts.connection || {}).length && (oldStatus.connected !== data.status.connected || oldStatus.accountPaused !== data.status.accountPaused || oldStatus.manuallyLoggedOut !== data.status.manuallyLoggedOut || oldQqLoggedIn !== (login && login.qqLoggedIn))) {
        renderPane();
      }
    } catch (error) {
      if ($('liveSnapshot')) $('liveSnapshot').textContent = '暂未同步，稍后自动重试';
    } finally { syncPending = false; }
  }
  function bindEnhancements() {
    bindCalendarWallet();bindSharedMemory();bindMusicCard();
    if($('shTest'))$('shTest').onclick=async function(){var button=$('shTest'),result=$('shTestResult');button.disabled=true;result.textContent='正在结合最近的对话理解…';try{var response=await api('POST','/im-bridge/features/sharing',{action:'preview',key:$('shTestContext').value,text:$('shTestText').value}),intent=response.intent||{},kinds=intent.kinds||[],form=intent.form||(kinds.indexOf('image')>=0&&kinds.indexOf('voice')>=0?'voice_image':kinds[0]||'text'),label={text:'文字',voice:'语音',image:'图片',voice_image:'图片 → 语音'}[form]||'文字';result.textContent=(intent.source==='direct'?'明确要求：':'她的判断：')+label+'；'+(intent.reason?intent.reason+'。':'')+'参考了 '+Number(response.contextCount||0)+' 条近期消息。'+(kinds.some(function(k){return response.available?.[k]===false;})?' 对应的媒体功能当前关闭，启用后才能发送。':'')+(response.scene?' 当前场景：'+response.scene.activity:'');}catch(error){result.textContent=error.message;}finally{button.disabled=false;}};
    if($('grSave'))$('grSave').onclick=async function(){try{await api('POST','/im-bridge/settings',{personaGrowth:{enabled:$('grEnabled').checked,daily:$('grDaily').checked,dailyDays:Number($('grDailyDays').value)||14,dailyMinUser:Number($('grDailyMinUser').value)||4}});await load();toast('成长设置已保存');}catch(e){toast(e.message);}};
    if($('grScope'))$('grScope').onchange=function(){rememberDraft('persona');growthSelection=this.value;renderPane();};
    if($('grProcess'))$('grProcess').onclick=async function(){try{await api('POST','/im-bridge/features/persona-growth',{action:'process'});await load();toast('已检查已归档的日观察和月度成长');}catch(e){toast(e.message);}};
    document.querySelectorAll('[data-growth-revert]').forEach(function(button){button.onclick=async function(){try{var scope=(featureData.personaGrowth?.scopes||[]).filter(function(s){return (s.meta.key||'')+'|'+s.meta.personaId===growthSelection;})[0];await api('POST','/im-bridge/features/persona-growth',{action:'revert',id:button.getAttribute('data-growth-revert'),key:scope.meta.key||'',personaId:scope.meta.personaId});await load();toast('这次成长已回退');}catch(e){toast(e.message);}};});
    bindVisualPanel();
    if($('agSave'))$('agSave').onclick=async function(){try{if($('agBackground')&&typeof data.settings.agency?.preferBackground!=='boolean')throw Error('后台优先设置需要新版后台，请先自行重启 DSH；原设置未改。');if($('agBrowserExecutable')&&typeof data.settings.agency?.browserExecutable!=='string')throw Error('浏览器路径设置需要新版后台，请先自行重启 DSH 再保存；原有设置已保留。');await api('POST','/im-bridge/settings',{agency:{enabled:$('agEnabled').checked,autonomous:$('agAutonomous').checked,browser:$('agBrowser').checked,...optionalSetting('agDesktop','desktop','checked'),...optionalSetting('agPhone','phone','checked'),...optionalSetting('agBackground','preferBackground','checked'),...optionalSetting('agWorkspace','workspace','value'),...($('agBrowserEngine')?.value?{browserEngine:$('agBrowserEngine').value}:{}),...($('agBrowserExecutable')?{browserExecutable:$('agBrowserEngine')?.value==='dsh'?'':$('agBrowserExecutable').value.trim()}:{})}});await load();toast('设备权限已保存');}catch(e){toast(e.message);}};
    if($('phStatus'))$('phStatus').onclick=async function(){try{await api('POST','/im-bridge/features/phone',{action:'status'});await load();toast('手机连接已检查');}catch(e){toast(e.message);}};
    if($('phObserve'))$('phObserve').onclick=async function(){var result=$('phResult');try{var r=await api('POST','/im-bridge/features/phone',{action:'observe'});result.textContent=r.ui||r.note||'DSH Go 已返回当前屏幕。';}catch(e){result.textContent=e.message;}};
    if($('phObserveShared'))$('phObserveShared').onclick=async function(){
      var result=$('phResult'),preview=$('phPreview');
      this.disabled=true;preview.hidden=true;preview.removeAttribute('src');
      try{
        var response=await api('POST','/im-bridge/visual-session',{action:'observe',key:$('vsKey')?.value});
        preview.src=response.preview;preview.hidden=false;
        result.textContent='已取得共享画面 · '+new Date(response.capturedAt).toLocaleTimeString();
      }catch(error){result.textContent=error.message;}finally{this.disabled=false;}
    };
    if($('shSave'))$('shSave').onclick=async function(){if(featureData?.mediaSharingRevision!=='20261026-sharing-v2')return toast('请完整退出并重新打开DSH后再设置主动分享');try{await api('POST','/im-bridge/settings',{autonomy:{shareMedia:{...optionalSetting('shEnabled','enabled','checked'),...optionalSetting('shVoice','voice','checked'),...optionalSetting('shImages','images','checked'),...optionalSetting('shDuring','duringChat','checked'),...optionalSetting('shIdle','idle','checked'),schedule:$('shSchedule').checked}}});await load();toast('语音与图片设置已保存');}catch(error){toast(error.message);}};
    bindCompanion();
    bindPersonaImages();
    bindWorkflowLibrary();
    bindImageStudio();
    if ($('discardDraft')) $('discardDraft').onclick = async function () {
      if (!await askConfirm('放弃本页尚未保存的修改？')) return;
      formState.discard(tab);
      if (tab === 'imagegen') { imagegenDraft = null; imagegenTypedKeys = {}; }
      if (tab === 'persona') { editingId = ''; personaTool = ''; }
      renderPane();
    };
    if ($('btnLogout')) $('btnLogout').onclick = async function () {
      var button = this;
      if (!await showModal('手动登出将停止 NapCat 和机器人 QQ，并暂停自动重连。本地登录凭据、插件配置与聊天记录保留，之后可用「启动 NapCat / 扫码登录」重新上线。确定登出？', false, '', '确认登出')) return;
      button.disabled = true;
      button.textContent = '正在登出…';
      if ($('logoutHint')) $('logoutHint').textContent = '正在停止机器人，请稍候…';
      try {
        await api('POST', '/im-bridge/logout', {});
        await load();
        toast('已手动登出，自动重连已暂停');
      } catch (error) {
        if ($('logoutHint')) $('logoutHint').textContent = '登出失败：' + error.message;
        toast('登出失败：' + error.message);
      } finally { if (button.isConnected) { button.disabled = false; button.textContent = '手动登出'; } }
    };
    bindPersonaTools();
  }
  function initEnhancements() {
    $('saveCurrentPage').onclick=saveFloatingPage;
    $('modal').setAttribute('role', 'dialog');
    $('modal').setAttribute('aria-modal', 'true');
    $('modal').setAttribute('aria-labelledby', 'modalMsg');
    ['input', 'change'].forEach(function (name) {
      $('pane').addEventListener(name, function () { rememberDraft(tab); renderDraftNotice(); });
    });
    window.addEventListener('beforeunload', function (event) {
      rememberDraft(renderedTab);
      if (!Object.keys(pageDrafts).length) return;
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) void syncLiveSnapshot(); });
  }

  function viewPersona() {
    var html = viewPersonaContent();
    var template = document.createElement('template');
    template.innerHTML = html;
    var cards = Array.prototype.slice.call(template.content.children).filter(function (el) { return el.classList.contains('card'); });
    function findCard(title) { return cards.filter(function (card) { var h = card.querySelector('h2'); return h && h.textContent.indexOf(title) === 0; })[0]; }
    var selfCard = findCard('自我卡');
    var library = findCard('人设卡');
    var editor = template.content.querySelector('#personaForm');
    var transfer = findCard('导入 / 导出');
    var ai = findCard('AI 生成人设');
    var preview = findCard('试聊预览');
    if (!selfCard || !library || !editor || !transfer || !ai || !preview) return html;
    library.querySelector('h2').textContent = '人设卡（cosplay）';
    var cardActive = (data.status && data.status.persona && data.status.persona.id) ? data.status.persona.id !== 'config' : !!(data.settings.activePersonaId && data.settings.activePersonaId !== 'self');
    var name = cardActive ? (data.status.personaName || data.status.preset || '人设卡') : '自我（空卡）';
    var out = '<div class="persona-toolbar"><span class="persona-current">' + icon('whale') + (cardActive ? '当前穿着 <b>' + esc(name) + '</b>' : '当前 <b>自我（空卡）</b>') + '</span><div class="btnrow">' + (cardActive ? '<button data-self="1">脱下角色卡</button>' : '') + '<button class="primary" data-persona-tool="edit">＋ 新建人设卡</button><button data-persona-tool="ai">' + icon('spark') + 'AI 生成</button><button data-persona-tool="transfer">导入 / 导出</button></div></div>';
    out += companionMarkup()+personaImageMarkup()+growthMarkup();
    out += '<div class="persona-layout"><div class="persona-library">' + selfCard.outerHTML + library.outerHTML + '<div class="effect-note">穿上人设卡后，下一条消息按卡片演；脱下后回到自我。</div></div><aside class="persona-preview">' + preview.outerHTML + '<div class="preview-note">' + icon('shield') + '<span>试聊只在这里预览，不会发送到 QQ，也不改变真实对话。</span></div></aside></div>';
    var titles = { edit: editingId ? '编辑人设卡' : '新建人设卡', ai: 'AI 生成人设卡', transfer: '导入与导出' };
    out += '<div class="persona-drawer" id="personaDrawer"' + (personaTool ? '' : ' hidden') + '><div class="drawer-backdrop" data-close-persona="1"></div><section class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="personaToolTitle"><header class="drawer-header"><div><span class="page-eyebrow">角色工具</span><h2 id="personaToolTitle">' + esc(titles[personaTool] || '角色工具') + '</h2></div><button class="icon-button" data-close-persona="1" aria-label="关闭角色工具">×</button></header><div class="drawer-content"><section data-tool-panel="edit"' + (personaTool === 'edit' ? '' : ' hidden') + '>' + editor.outerHTML + '</section><section data-tool-panel="ai"' + (personaTool === 'ai' ? '' : ' hidden') + '>' + ai.outerHTML + '</section><section data-tool-panel="transfer"' + (personaTool === 'transfer' ? '' : ' hidden') + '>' + transfer.outerHTML + '</section></div><footer class="drawer-footer">未保存的内容仅暂存在当前窗口。</footer></section></div>';
    return out;
  }
  function openPersonaTool(tool) {
    rememberDraft('persona');
    if (tool === 'edit' && editingId) editingId = '';
    personaTool = tool;
    renderPane();
    var input = tool === 'edit' ? $('pName') : tool === 'ai' ? $('aiPersonaDesc') : $('pImport');
    if (input) input.focus({ preventScroll: true });
  }
  function bindPersonaTools() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-persona-tool]'), function (button) {
      button.onclick = function () { openPersonaTool(button.getAttribute('data-persona-tool')); };
    });
    function closeDrawer() {
      rememberDraft('persona');
      personaTool = '';
      $('personaDrawer').hidden = true;
      document.body.classList.remove('drawer-open');
      var trigger = $('pane').querySelector('[data-persona-tool="edit"]');
      if (trigger) trigger.focus({ preventScroll: true });
      renderDraftNotice();
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-close-persona]'), function (button) { button.onclick = closeDrawer; });
    document.body.classList.toggle('drawer-open', tab === 'persona' && !!personaTool);
    if ($('personaDrawer')) $('personaDrawer').onkeydown = function (event) {
      if (!$('modal').hidden || this.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
      if (event.key === 'Tab') {
        var focusable = Array.prototype.filter.call(this.querySelectorAll('button,input,textarea,select,[tabindex="0"]'), function (el) { return !el.disabled && el.getClientRects().length; });
        var first = focusable[0]; var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
  }

  var featureData = null;
  var memoryChat = ''; var memoryEditId = ''; var memoryFilter = 'all'; var renderedMemoryContext = '';
  var profileChat = ''; var renderedProfileContext = '';
  var auditId = ''; var renderedAuditContext = ''; var correctionDrafts = {};
  var backupBundle = null; var backupToken = ''; var fullBackupBundle = null; var fullBackupToken = '';
  function featureChats() { return featureData?.knownChats || [...new Set([...(data.status.allowUsers||[]).map(id=>'private:'+id),...(data.status.allowGroups||[]).map(id=>'group:'+id)])]; }
  function featureOptions(current) { return featureChats().map(key=>'<option value="'+esc(key)+'"'+(key===current?' selected':'')+'>'+esc(notesLabel(key))+'</option>').join(''); }
  function unavailableFeatures() { return '<div class="card"><h2>新功能尚未加载</h2><p class="muted">请将 QQ / IM 桥接插件关闭再开启一次，然后刷新管理面板。</p></div>'; }
  function viewMemory(){return viewMemoryBasic()+sharedMemoryMarkup()+(featureData?calendarMemoryMarkup():unavailableFeatures())+'<div class="card"><h2>学习记忆</h2><p class="muted">学习到的语境、表达和梗知识保存后立即可检索，学习过程参与日终归档。</p><button id="memLearning">查看学了什么与使用情况</button></div>';}
  function viewProfiles() {
    if(!featureData)return unavailableFeatures();if(!profileChat||featureChats().indexOf(profileChat)===-1)profileChat=featureChats()[0]||'';
    var profile=featureData.profiles[profileChat]||{};var route=data.status.modelByChat?.[profileChat];
    var personae=presets.map(p=>({id:p.id,name:data.settings.presetNames?.[p.id]||p.name||p.id})).concat(data.settings.personae||[]);
    return '<div class="card"><h2>按对话独立配置</h2><p class="muted">私聊与每个群分别保存配置和记忆。留空的选项跟随全局设置。普通联系人需单独允许主动消息；加入白名单只允许接收和回复，不自动授权主动联系。</p><label class="field">对话<select id="pfChat">'+featureOptions(profileChat)+'</select></label><div class="form-two"><label class="field">人设<select id="pfPersona"><option value="">跟随全局人设</option>'+personae.map(p=>'<option value="'+esc(p.id)+'"'+(profile.personaId===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><label class="field">模型<select id="pfModel">'+chatModelOptions(profileChat)+'</select></label><label class="field">语音开关<select id="pfVoice"><option value="inherit">跟随全局</option><option value="true"'+(profile.voiceEnabled===true?' selected':'')+'>本对话开启</option><option value="false"'+(profile.voiceEnabled===false?' selected':'')+'>本对话关闭</option></select></label><label class="field">音色<input id="pfVoiceName" value="'+esc(profile.voiceName||'')+'" placeholder="留空跟随全局；例如 zh-CN-XiaoxiaoNeural"></label><label class="field">回复长度偏好（字，0 跟随全局）<input id="pfChars" type="number" min="0" max="2000" value="'+Number(profile.replyChars||0)+'"></label><label class="field">允许主动消息<select id="pfProactive"><option value="inherit">默认：号主允许，普通联系人禁止</option><option value="true"'+(profile.proactive===true?' selected':'')+'>允许（仍受全局开关约束）</option><option value="false"'+(profile.proactive===false?' selected':'')+'>本对话禁止</option></select></label></div><button class="primary" id="pfSave"'+(!profileChat?' disabled':'')+'>保存对话配置</button><p class="muted">人设或模型变更后，下一条消息会开启使用新配置的会话。</p></div>';
  }
  var DELIVERY_LABELS={queued:'等待发送',sending:'等待平台回执',sent:'QQ已接收',unknown:'送达状态待确认',failed:'发送失败',cancelled:'已取消',withdrawn:'已撤回',admitted:'已提交',processing:'正在处理',uncertain:'提交状态待确认'};
  function deliveryCheckLabel(job){if(job.status!=='sent')return DELIVERY_LABELS[job.status]||job.status;return job.verification?.state==='observed'?'已在QQ记录读回':job.verification?.state==='checking'?'QQ已接收，正在核对':job.verification?.state==='pending'?'QQ已接收，等待核对':'QQ已接收，尚未读回核对';}
  function deliveryRows(jobs){if(!jobs.length)return '<div class="empty">还没有发送记录</div>';return jobs.map(function(job){return '<article class="delivery-item"><div class="section-heading"><b>'+esc(notesLabel(job.chat))+'</b><span class="tag">'+esc(deliveryCheckLabel(job))+'</span></div><p>'+esc(job.preview)+'</p><div class="muted">'+esc(new Date(job.at).toLocaleString())+(job.messageId?' · 消息ID '+esc(job.messageId):'')+'</div>'+(job.verification?'<p class="muted">'+esc(job.verification.reason||'正在后台核对')+(job.verification.checkedAt?' · '+esc(new Date(job.verification.checkedAt).toLocaleTimeString()):'')+'</p>':'')+(job.status==='sent'?'<p class="muted">'+(job.verification?.recipient==='reply_observed'?(job.kind==='group'?'已有成员引用回复，其他成员接收情况未知':'对方已引用回复此消息'):'对方接收：尚无回执')+'；是否读完：未知</p>':'')+(job.error?'<p class="delivery-error">'+esc(job.error)+'</p>':'')+((job.status==='sent'||job.status==='unknown')&&job.messageId?'<button class="small" data-delivery-check="'+esc(job.id)+'">再次核对</button>':'')+(['failed','unknown','cancelled'].includes(job.status)?'<button class="small" data-delivery-retry="'+esc(job.id)+'">'+(job.status==='unknown'?'核实后重发':'重新发送')+'</button>':'')+'</article>';}).join('');}
  function bindDeliveryActions(){document.querySelectorAll('[data-delivery-check]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{await requestApi('POST','/im-bridge/features/delivery-check',{id:button.getAttribute('data-delivery-check')});await refreshDeliveryRows();}catch(e){toast(e.message||'暂未核对成功');}finally{button.disabled=false;}};});document.querySelectorAll('[data-delivery-retry]').forEach(function(button){button.onclick=async function(){var id=button.getAttribute('data-delivery-retry'),job=(featureData.outbox||[]).find(function(j){return j.id===id;});if(!job)return;if(!await askConfirm(job.status==='unknown'?'原消息可能已经发出。确认仍要重发？':'重新发送这条消息？'))return;await featurePost('retry',{id:id,confirmUncertain:true},button);await refreshDeliveryRows();};});}
  var deliveryPollBusy=false;
  async function refreshDeliveryRows(){if(tab!=='delivery'||!$('deliveryRecords')||deliveryPollBusy)return;deliveryPollBusy=true;try{var v=await requestApi('GET','/im-bridge/deliveries');if(tab!=='delivery'||!$('deliveryRecords'))return;featureData.outbox=v.jobs||[];$('deliveryRecords').innerHTML=deliveryRows(featureData.outbox.slice().reverse());bindDeliveryActions();}catch{}finally{deliveryPollBusy=false;}}
  function viewDelivery() {
    if(!featureData)return unavailableFeatures();var out='<div class="card"><h2>消息处理规则</h2><p class="muted">按平台消息 ID 去重。同一个人连续发来的消息会合并处理；链接、图片、命令和不同群成员的消息保持边界。手机版的文字分句会先保存整组再发送；确定尚未提交的断线消息会有限续发。已提交但回执不明确的消息不会自动重发。</p><label class="field">回复前停顿（毫秒，0 关闭；有新消息会重新计时）<input id="dlDelay" type="number" min="0" max="15000" step="500" value="'+Number(featureData.reliability.replyDelayMs??3000)+'"></label><p class="muted">默认 3000 毫秒：最后一条消息到达后等 3 秒再提交模型，期间再来消息会重新等 3 秒，给对方留出连续打字的窗口。</p><button class="primary" id="dlSave">保存</button></div><div class="card"><div class="section-heading"><h2>发送队列与回执</h2><span class="muted">每2秒更新发送与核对结果</span></div>';
    var jobs=(featureData.outbox||[]).slice().reverse();out+='<div id="deliveryRecords">'+deliveryRows(jobs)+'</div>';
    out+='</div>';
    var withheld=(featureData.audits||[]).filter(a=>!a.outboxIds?.length&&a.deliveryReason&&['withheld','failed','generated'].includes(a.deliveryState)).slice(-10).reverse();
    if(withheld.length)out+='<div class="card"><h2>已生成但尚未转发</h2><p class="muted">生成文字与 QQ 发送分开记录。这里显示未进入发送队列的原因；不会自动把内部任务、已取消的旧回复补发出去。</p>'+withheld.map(a=>'<article class="delivery-item"><b>'+esc(notesLabel(a.chat))+'</b><p>'+esc(a.deliveryReason)+'</p><span class="muted">'+esc(new Date(a.at).toLocaleString())+'</span></article>').join('')+'</div>';
    out+='<div class="card"><h2>接收处理记录</h2>';var inbox=(featureData.inbox||[]).slice(-50).reverse();if(!inbox.length)out+='<div class="empty">还没有接收记录</div>';inbox.forEach(job=>{out+='<div class="row"><span>'+esc(notesLabel(job.key))+'<br><span class="muted">'+esc(DELIVERY_LABELS[job.status]||job.status)+(job.error?' · '+esc(job.error):'')+'</span></span>'+(['failed','uncertain'].includes(job.status)?'<button class="small" data-inbox-retry="'+esc(job.id)+'">重新处理</button>':'')+'</div>';});return out+'</div>';
  }
  var invocationView='requests',invocationRequestSignature='';
  var invocationTimer=null,invocationBusy=false,invocationBackend='',invocationKindFilter='',invocationRows=[],invocationSignature='';
  function viewInvocations(){return '<section class="card"><h2>提示词与调用记录</h2><p class="muted">显示实际提交的正向词、反向词、工作流节点参数、工具请求和回执。来源可区分本地与 API；记录不自动重放操作。保留最近 240 条，凭据与媒体原始数据已隐藏。</p><div class="form-two"><label class="field">来源<select id="ivBackend"><option value="">全部</option><option value="local"'+(invocationBackend==='local'?' selected':'')+'>本地</option><option value="api"'+(invocationBackend==='api'?' selected':'')+'>API</option></select></label><label class="field">类型<select id="ivKind"><option value="">全部</option>'+[['chat','聊天与后台模型'],['image','生图'],['video','生视频'],['speech','语音'],['tool','其他工具']].map(function(pair){return '<option value="'+pair[0]+'"'+(invocationKindFilter===pair[0]?' selected':'')+'>'+pair[1]+'</option>';}).join('')+'</select></label></div><label class="field">查看方式<select id="ivView"><option value="requests"'+(invocationView==='requests'?' selected':'')+'>按请求看完整过程</option><option value="calls"'+(invocationView==='calls'?' selected':'')+'>单次调用明细</option></select></label><button id="ivRefresh">刷新记录</button><p class="muted" id="ivHint" role="status">正在读取…</p><div id="ivRoutes"></div><div id="ivRecords"></div></section>';}
  function invocationModelDetails(row){
    var out='<p><b>用途：</b>'+esc(row.purpose||row.tool||'执行工具')+'</p>';
    if(row.billing)out+='<p class="muted">'+esc(row.billing)+'</p>';
    if(row.mediaExecution)out+='<p><b>媒体执行：</b>'+esc(({none:'无媒体任务',pending:'仍在生成或发送',failed:'媒体任务失败',partial:'部分媒体失败',unknown:'结果待核对',accepted:'QQ已接收，等待读回',observed:'已在发送端记录读回，对方是否收到仍未知'})[row.mediaExecution.state]||row.mediaExecution.state)+'</p>';
    if(row.executionSummary)out+='<p><b>执行摘要：</b>'+esc(row.executionSummary)+'</p>';
    if(row.model||row.actualModel)out+='<p>模型：'+esc(typeof row.model==='string'?row.model:row.model?.model||'')+' '+esc(row.actualModel?JSON.stringify(row.actualModel):'')+'</p>';
    if(row.elapsedMs!==undefined)out+='<p>耗时：'+esc((row.elapsedMs/1000).toFixed(1))+' 秒</p>';
    if(row.input!==undefined)out+='<details open><summary>聊天或分析输入</summary><pre class="audit-text">'+esc(typeof row.input==='string'?row.input:JSON.stringify(row.input,null,2))+'</pre></details>';
    if(row.output!==undefined)out+='<details open><summary>最终输出</summary><pre class="audit-text">'+esc(row.output||'尚未返回最终输出')+'</pre></details>';
    if(row.modelExplanation)out+='<details><summary>模型实际返回的思考或说明</summary><pre class="audit-text">'+esc(row.modelExplanation)+'</pre></details>';
    if(row.usage)out+='<details><summary>接口返回的用量</summary><pre class="audit-text">'+esc(JSON.stringify(row.usage,null,2))+'</pre></details>';
    if(row.systemPrompt)out+='<details><summary>本次系统提示词</summary><pre class="audit-text">'+esc(row.systemPrompt)+'</pre></details>';
    if(row.kind==='chat')out+='<p class="muted">这里显示输入、输出和可核实的执行摘要；没有返回的内部思考不作推测。</p>';
    return out;
  }
  function invocationExtraDetails(row){
    var args=row.submittedArguments||{},ref=row.reference||{},plan=row.imagePlan||{},out='';
    if(row.preparedSpeech)out+='<section class="card"><h3>实际语音台词与发声指令</h3><p>台词</p><pre class="audit-text">'+esc(row.preparedSpeech.text||'')+'</pre><p>发声指令（已由模型理解表达偏好）</p><pre class="audit-text">'+esc(row.preparedSpeech.instructions||'')+'</pre><p>来源：'+esc(row.preparedSpeech.engine||row.preparedSpeech.source||'')+' · 模型：'+esc(row.preparedSpeech.model||'服务默认')+'</p><p class="muted">时长检查不等于逐字内容核验；默认不追加付费转写。</p></section>';
    if(row.kind==='image'||row.tool==='image'){
      var refText=ref.mode==='text-to-image'?'文生图，不传参考图':ref.verified===true?'已上传并连接到输出分支':ref.selected===true?'已选中，尚未确认上传绑定':ref.used===true?(args.referenceImage===true?'已传入工作流（旧记录）':'已选用，尚无工作流提交确认'):ref.used===false?'未使用':args.referenceImage===true?'已传入参考图（旧记录未区分来源）':args.referenceImage===false?'未使用':'旧记录未保存此信息';
      var reasons={text_to_image_selected:'当前手动选择的是文生图工作流，按文字人设外观、当前场景和工作流触发词生成；没有上传参考图，不代表接口失败。',image_plan_missing_reference_not_bypassed:'已配置人设图，但本轮缺少画面主体规划，已暂停并确认主体，没有降级为无参考图生成',subject_needs_clarification:'拍摄主体不明确，已先确认，没有提交无参考图的生成任务',persona_reference_bound_to_submitted_workflow:'参考图已上传，文件名与最终工作流输入一致，且连到输出分支；这项校验不代表最终画面必然保持身份',not_selected_by_subject_check:'本轮主体检查没有识别为当前角色，因此未选择人设图；这不表示参考图已上传',no_saved_reference:'当前人设没有已保存的参考图',reference_preparation_failed:'参考图读取或校验没有成功',no_image_plan:'本轮没有提供画面规划',no_persona_reference:'本轮没有提供人设参考图',model_selected_another_source:'模型选择了本轮其他图片',reference_prepared:'参考图已准备',persona_reference_selected:'已选择人设图作为输入'};
      out+='<section class="card"><h3>人设参考图：'+esc(refText)+'</h3><p>参考图要求：'+esc(ref.mode==='text-to-image'?'按文生图方式生成':ref.required===true?'必须沿用，不能被聊天模型省略':ref.selectionPolicy==='subject-unresolved'?'主体未确认':ref.selectionPolicy==='scene-or-other'?'本轮未判定为当前角色':'旧记录未保存传输要求')+'</p><p>'+esc(reasons[ref.reason]||ref.reason||'旧记录未保存选择原因，不能补推。')+'</p>'+(ref.configured!==undefined?'<p>已保存人设图：'+(ref.configured?'是':'否')+' · 已准备：'+(ref.prepared?'是':'否')+'</p>':'')+(ref.referenceFile||ref.sha256?'<p class="audit-text">参考图标识：'+esc(ref.referenceFile||ref.sha256)+'</p>':'')+(args.submittedNodes?.image?'<p>图片输入节点：'+esc(args.submittedNodes.image.node||'未映射')+' / '+esc(args.submittedNodes.image.field||'未映射')+' · 实际文件：'+esc(args.submittedNodes.image.value||'没有传入')+'</p>':'')+'</section>';
      if(ref.uploadedImage)out+='<p class="audit-text">已上传参考图：'+esc(ref.uploadedImage)+' · 输出分支连通：'+(ref.onOutputPath?'是':'否')+'</p>';
      if(ref.subjectResolution)out+='<p>拍摄主体依据：'+esc({current:'本轮明确要求','recent-human-photo':'沿用同一对话中最近的人类拍摄要求','needs-subject':'需要确认拍摄主体'}[ref.subjectResolution.source]||ref.subjectResolution.source||'未记录')+'</p>';
    }
    if(row.workflowSelection)out+='<p>实际选择工作流：'+esc(row.workflowSelection.name||row.workflowSelection.id)+'</p>';
    if(row.promptId)out+='<p class="audit-text">ComfyUI 任务编号：'+esc(row.promptId)+'</p>';
    if(row.imagePlan)out+='<details><summary>画面规划、人设与日程</summary><pre class="audit-text">'+esc(JSON.stringify(plan,null,2))+'</pre></details>';
    if(row.promptPreparation)out+='<details><summary>本地提示词草稿、语言修正与核对过程</summary><pre class="audit-text">'+esc(JSON.stringify(row.promptPreparation,null,2))+'</pre></details>';
    if(row.preparedPrompt||row.modelProfile)out+='<details><summary>提示词准备结果与模型配置</summary><pre class="audit-text">'+esc(JSON.stringify({prompt:row.preparedPrompt,modelProfile:row.modelProfile},null,2))+'</pre></details>';
    if(row.workflowDetails)out+='<details><summary>最终工作流、模型、采样参数与节点连接</summary><p class="muted">这是提交副本的参数和连线；连线存在不等于生成结果一定保持身份。</p><pre class="audit-text">'+esc(JSON.stringify(row.workflowDetails,null,2))+'</pre></details>';
    var outputs=row.outputs||[];
    out+='<section class="card"><h3>输出结果</h3>';
    if(!outputs.length)out+='<p class="muted">'+(['started','submitted'].indexOf(row.status)>=0?'结果尚未返回。':'本条记录没有可预览的媒体文件；文字或原始工具结果见下方。')+'</p>';
    outputs.forEach(function(item){
      var url=typeof item.url==='string'&&item.url.indexOf('/im-bridge/invocation-output?')===0?item.url:'',delivery=item.delivery||{},label={sent:'QQ已接收，接收方状态未知',queued:'等待发送 QQ',sending:'正在发送 QQ',failed:'QQ 发送失败',unknown:'QQ 送达状态不明',cancelled:'发送已取消',unrecorded:'没有对应的 QQ 发送记录'}[delivery.status]||'没有对应的 QQ 发送记录';
      out+='<div data-invocation-output="'+esc(item.index)+'"><p>'+esc(item.name||'媒体结果')+(item.bytes?' · '+esc((item.bytes/1024).toFixed(1))+' KB':'')+'</p>';
      if(item.available&&url){
        if(item.kind==='image')out+='<a href="'+esc(url)+'" target="_blank" rel="noopener"><img src="'+esc(url)+'" alt="生成结果预览" loading="lazy" style="display:block;max-width:100%;max-height:480px;object-fit:contain"></a>';
        else if(item.kind==='video')out+='<video controls preload="none" src="'+esc(url)+'" style="max-width:100%;max-height:480px"></video>';
        else if(item.kind==='speech')out+='<audio controls preload="none" src="'+esc(url)+'" style="max-width:100%"></audio>';
        out+='<p><a href="'+esc(url)+'" download="'+esc(item.name||'result')+'">保存结果文件</a></p>';
      }else out+='<p class="muted">'+esc(item.reason||'结果文件暂时不可用')+'</p>';
      out+='<p>'+esc(label)+(delivery.messageIds?.length?' · 消息编号：'+esc(delivery.messageIds.join('、')):'')+'</p></div>';
    });
    return out+'</section>';
  }
  var INVOCATION_TOOL_LABELS={'voice.synthesis':'合成并检查语音','bridge_companion':'持续视听陪伴','companion.understand':'理解陪伴画面','companion.reaction':'陪伴互动','companion.action':'游戏实际操作','companion.error':'陪伴错误','companion.started':'开始陪伴','companion.paused':'暂停陪伴','companion.stopped':'结束陪伴','companion.ended':'视频播放结束','companion.halted':'陪伴已暂停排错','bridge_watch':'看视频','bridge_bilibili':'刷B站','bridge_search':'搜索','bridge_read':'读网页','bridge_browser':'浏览器','bridge_device':'操作设备','bridge_drawing':'画画','bridge_art':'AI 生图','bridge_life_qq':'发QQ消息','bridge_life_share':'分享','bridge_life_adjust':'调整日程','bridge_life_finish':'结束日程','bridge_life_checkpoint':'保存进度','bridge_qq_read':'读QQ消息','bridge_qq_profile':'QQ空间','bridge_audio':'分析音频','bridge_storage':'整理存储','bridge_task':'查看任务','bridge_website_mcp':'调用网站','bridge_game':'玩游戏','bridge_screen_share':'发截图','bridge_social_image':'准备配图','bridge_workspace':'文件操作','bridge_native':'原生工具','bridge_capabilities':'查看能力','bridge_life_artifact':'登记作品','bridge_life_request':'询问本人','chat.reply':'聊天回复','qq.qzone.publish':'空间发布','qq.qzone.comment':'空间评论','qq.qzone.reply':'空间回复','local.chat':'本地聊天','bash':'命令行','qq.message.verify':'核对送达','model.complete':'模型生成','edit':'改文件','read':'读文件','write':'写文件','plugin_manager':'插件管理','mcp__phone__screen':'读屏','mcp__phone__tap':'点屏幕','mcp__phone__open':'开应用','bridge_context':'读上下文'};
  function invocationToolLabelOf(key,row){
    if(INVOCATION_TOOL_LABELS[key])return INVOCATION_TOOL_LABELS[key];
    var base=String(key||'').replace(/^bridge_/,'');
    if(!base||base==='tool')return '未标注的工具';
    return base;
  }
  function invocationToolLabel(group){return group.label||invocationToolLabelOf(group.key,group.rows[group.rows.length-1]);}
  function invocationPurpose(row){
    if(row.purpose)return String(row.purpose).slice(0,60);
    var key=String(row.tool||row.kind||''),kind=String(row.kind||'');
    if(kind==='chat')return '回复'+(String(row.chat||'').indexOf('group:')===0?'群聊':'私聊');
    if(kind==='image')return '生成图片';
    if(kind==='video')return '生成视频';
    if(kind==='speech')return '合成语音';
    var label=invocationToolLabelOf(key,row);
    var args=row.arguments||row.submittedArguments||{};
    var hint=String(args.query||args.url||args.bvid||args.name||args.action||'').slice(0,40);
    return label+(hint?'：'+hint:'');
  }
  function invocationStatusText(row){
    var map={started:'开始调用',submitted:'已提交',returned:'已返回',deferred:'暂缓',failed:'失败',cancelled:'已取消',rejected:'被拒绝',unknown:'结果未知'};
    return map[String(row.status||'')]||String(row.status||'');
  }
  function invocationCostText(cost){
    var value=Number(cost)||0;
    if(value<=0)return '';
    if(value<0.0001)return '<0.0001 元';
    return (value<1?value.toFixed(4):value.toFixed(2))+' 元';
  }
  function invocationResultText(row){
    var text=String(row.error||row.executionSummary||row.coverage||'').trim();
    if(!text&&row.status==='returned')text='已返回结果';
    return invocationPlainText(text).slice(0,120);
  }
  function invocationSummaryLine(group){
    var rows=group.rows,last=rows[rows.length-1];
    var parts=[];
    if(rows.length>1){var ok=0;rows.forEach(function(row){if(row.status==='returned')ok+=1;});parts.push('连续 '+rows.length+' 次调用，其中 '+ok+' 次返回');}
    var result=invocationResultText(last);
    if(result)parts.push('结果：'+result);
    var cost=rows.reduce(function(sum,row){return sum+(Number(row.cost)||0);},0);
    if(cost>0)parts.push('花费 '+invocationCostText(cost));
    return parts.length?'<p class="muted">'+esc(parts.join(' · '))+'</p>':'';
  }
  function invocationMetaText(){return '';}
  function invocationPlainText(value){
    return String(value==null?'':value).replace(/\[已省略\]/g,'内容过大，已省略').replace(/\s+/g,' ').slice(0,140);
  }
  function groupInvocations(rows){
    var groups=[],MERGE_WINDOW=20*60*1000;
    (rows||[]).forEach(function(row){
      var key=String(row.tool||row.kind||'工具');
      var mergeable=['image','video','speech'].indexOf(String(row.kind||''))<0;
      var last=groups[groups.length-1];
      var gap=last?Math.abs(Number(row.at)-Number(last.rows[last.rows.length-1].at)):Infinity;
      if(last&&last.key===key&&last.mergeable&&mergeable&&gap<=MERGE_WINDOW&&String(row.chat||'')===String(last.chat||'')){last.rows.push(row);return;}
      groups.push({key:key,label:invocationToolLabelOf(key,row),mergeable:mergeable,chat:row.chat||'',purpose:invocationPurpose(row),rows:[row],at:row.at});
    });
    groups.forEach(function(group){if(group.rows.length>1)group.purpose=invocationToolLabel(group)+(String(group.rows[0].kind||'')==='chat'?' · '+group.rows.length+' 条':'');});
    return groups;
  }
  function invocationDetail(row,index){
    var args=row.submittedArguments||row.arguments||{};
    var prompt=args.prompt||(args.nodeInfoList||[]).filter(function(node){return /text|prompt/i.test(node.fieldName);}).map(function(node){return node.fieldValue;}).join('\n')||'';
    var negative=args.negativePrompt||args.negative_prompt||'';
    return '<button data-invocation-record-copy="'+index+'">复制完整记录</button>'+invocationModelDetails(row)+invocationExtraDetails(row)+(row.workflow?'<p>工作流：'+esc(row.workflow)+'</p>':'')+(row.chat?'<p class="muted">对话：'+esc(notesLabel(row.chat))+'</p>':'')+(prompt?'<h3>'+esc(row.submittedArguments?'实际提交提示词':'记录中的提示词（未保存独立提交快照）')+'</h3><textarea readonly data-invocation-prompt="'+index+'" style="min-height:140px">'+esc(prompt)+'</textarea><button data-invocation-copy="'+index+'">复制提示词</button>':'')+(negative?'<h3>反向提示词</h3><pre class="audit-text">'+esc(negative)+'</pre>':'')+'<details><summary>完整参数与实际节点值</summary><pre class="audit-text">'+esc(JSON.stringify(args,null,2).replace(/\[已省略\]/g,'内容过大，已省略'))+'</pre>'+(row.submittedArguments&&row.arguments?'<p>模型原始工具参数</p><pre class="audit-text">'+esc(JSON.stringify(row.arguments,null,2))+'</pre>':'')+'</details>'+(row.result?'<details><summary>工具返回结果</summary><pre class="audit-text">'+esc(JSON.stringify(row.result,null,2))+'</pre></details>':'')+(row.error?'<p>'+esc(row.error)+'</p>':'');
  }
  var INVOCATION_TOOL_NOTES={'bridge_watch':'实际播放视频并连续读画面，用来看清一段内容','bridge_bilibili':'B站账号通道，找视频、取字幕和评论','bridge_search':'上网搜索，返回真实链接','bridge_read':'只读一个网页的正文','bridge_browser':'操作独立浏览器页面','bridge_device':'把动作交给手机或电脑去执行','bridge_drawing':'在自己画布上一笔一笔画，导出 PNG','bridge_art':'AI 生图（要花钱）','bridge_life_qq':'把话真正发到 QQ','bridge_life_share':'分享作品或读过的链接','bridge_life_adjust':'调整自己的日程安排','bridge_life_finish':'结束一次日程任务','bridge_life_checkpoint':'保存进行中的进度','bridge_qq_read':'读取聊天里的图片、语音和转发','bridge_qq_profile':'QQ 空间：签名、动态、评论','bridge_audio':'取实际音频波形与频谱再分析','bridge_storage':'整理临时媒体占用','bridge_task':'查看还没做完的任务','bridge_website_mcp':'调用已添加网站的工具','bridge_game':'打开游戏并真实操作','bridge_screen_share':'把截图发给你','bridge_social_image':'给空间动态准备配图','bridge_workspace':'读写工作区文件','bridge_native':'调用宿主原生工具','bridge_capabilities':'查看当前有哪些可用工具','bridge_life_artifact':'登记自己做好的作品','bridge_life_request':'需要你确认时来问你','chat.reply':'模型生成一轮回复（按 token 计费）','get_status':'心跳：定时确认 QQ 连接还在，掉线才知道要重连','send_msg':'发送消息，把内容真正发到 QQ','get_friend_msg_history':'回读发送记录，核对到底送没送到','get_msg':'读取收到的消息','get_group_msg_history':'读取群消息记录','get_login_info':'确认 QQ 登录状态','get_credentials':'取 QQ 空间登录用的凭据','get_cookies':'取登录 cookie','get_csrf_token':'取提交表单要用的令牌','qq.qzone.publish':'发布 QQ 空间动态','qq.qzone.comment':'评论空间动态','qq.qzone.reply':'回复空间评论','local.chat':'本地模型生成回复','bash':'在运行环境里执行一条命令（读写文件、跑脚本）','qq.message.verify':'核对一条消息是否真的送达','model.complete':'模型生成一轮文字，按 token 计费','edit':'修改一个文本文件','write':'写入一个文本文件','read':'读取一个文件','plugin_manager':'安装或启停插件','mcp__phone__screen':'读取手机当前屏幕','mcp__phone__tap':'点击手机屏幕','mcp__phone__open':'打开手机应用','bridge_context':'读取自己的服装、场景和记忆设定'};
  function invocationToolNote(group){
    var key=String(group.key||'');
    return INVOCATION_TOOL_NOTES[key]||INVOCATION_TOOL_NOTES[String(group.labelledKey||key)]||'';
  }
  function paintInvocations(value){
    if(!$('ivRecords'))return;invocationRows=value.records||[];
    $('ivHint').textContent='已读取 '+invocationRows.length+' 条，每 2 秒更新；按明确请求编号关联，模型返回、媒体生成与 QQ 送达分开核对。';
    var routes=(value.routes||[]).slice(-5).reverse();$('ivRoutes').innerHTML=routes.length?'<details><summary>最近的模型选择原因</summary>'+routes.map(function(row){return '<p>'+esc(new Date(row.at).toLocaleTimeString())+' · '+esc({local:'本地',api:'API 补全',unavailable:'本地暂不可用'}[row.target]||row.target)+' · '+esc(row.reason)+'</p>';}).join('')+'</details>':'';
    if(invocationView==='requests'){
      var requestSignature=JSON.stringify([value.requests,invocationRows.map(function(row){return [row.id,row.updatedAt,row.status,row.outputs];})]);
      if(invocationRequestSignature!==requestSignature){invocationRequestSignature=requestSignature;paintExecutionRequests($('ivRecords'),value.requests||[],invocationRows,invocationDetail);bindInvocationCopyButtons();}
      return;
    }
    var signature=JSON.stringify(invocationRows.map(function(row){return [row.id,row.updatedAt,row.status,row.outputs];}));if(signature===invocationSignature)return;invocationSignature=signature;
    var expanded=Array.prototype.map.call(document.querySelectorAll('[data-invocation][open]'),function(el){return el.dataset.invocation;});
    var groups=groupInvocations(invocationRows);
    $('ivRecords').innerHTML=invocationRows.length?groups.map(function(group){
      var rows=group.rows,first=rows[0],last=rows[rows.length-1],cost=rows.reduce(function(sum,row){return sum+(Number(row.cost)||0);},0);
      var status=invocationStatusText(last),meta=invocationMetaText(group),open=rows.some(function(row){return expanded.indexOf(row.id)>=0;})||groups.indexOf(group)===0;
      var head=esc(new Date(first.at).toLocaleTimeString())+(rows.length>1?' — '+esc(new Date(last.at).toLocaleTimeString()):'')+' · '+(last.backend==='local'?'本地':'API')+' · '+esc(invocationToolLabel(group))+(rows.length>1?' ×'+rows.length:'')+' · '+esc(group.purpose)+(cost>0?' · '+esc(invocationCostText(cost)):'');
      var note=invocationToolNote(group);
      return '<div class="invocation-box" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0;background:var(--panel,#fff)">'+(note?'<p class="muted" style="margin:0 0 6px">'+esc(note)+'</p>':'')+'<details class="delivery-item" data-invocation="'+esc(last.id)+'"'+(open?' open':'')+'><summary>'+head+'</summary>'+invocationSummaryLine(group)+rows.map(function(row){var index=invocationRows.indexOf(row);return '<details class="delivery-item" data-invocation="'+esc(row.id)+'"><summary>'+esc(new Date(row.at).toLocaleTimeString())+' · '+esc(invocationStatusText(row))+(row.cost>0?' · '+esc(invocationCostText(row.cost)):'')+'</summary>'+invocationDetail(row,index)+'</details>';}).join('')+'</details></div>';
    }).join(''):'<p class="muted">暂无符合筛选的调用。更新后的新任务会出现在这里。</p>';
    bindInvocationCopyButtons();
  }
  function bindInvocationCopyButtons(){
    document.querySelectorAll('[data-invocation-record-copy]').forEach(function(button){button.onclick=async function(){try{await navigator.clipboard.writeText(JSON.stringify(invocationRows[Number(button.dataset.invocationRecordCopy)],null,2));toast('完整记录已复制');}catch{toast('复制失败，可展开参数后手动复制');}};});
    document.querySelectorAll('[data-invocation-copy]').forEach(function(button){button.onclick=async function(){var field=document.querySelector('[data-invocation-prompt="'+button.dataset.invocationCopy+'"]');if(!field)return;try{await navigator.clipboard.writeText(field.value);toast('提示词已复制，可粘贴后调整');}catch{field.focus();field.select();toast('已选中提示词，按 Ctrl+C 复制');}};});
  }
  function refreshInvocations(){
    if(invocationBusy||!$('ivRecords'))return;invocationBusy=true;
    var requested=JSON.stringify([invocationView,invocationBackend,invocationKindFilter]),current=function(){return requested===JSON.stringify([invocationView,invocationBackend,invocationKindFilter]);};
    api('GET','/im-bridge/invocations?view='+encodeURIComponent(invocationView)+'&backend='+encodeURIComponent(invocationBackend)+'&kind='+encodeURIComponent(invocationKindFilter)).then(function(value){if(current())paintInvocations(value);}).catch(function(error){if(current()&&$('ivHint'))$('ivHint').textContent='读取暂未完成：'+error.message;}).finally(function(){invocationBusy=false;if(!current())refreshInvocations();});
  }
  function bindInvocations(){if(!$('ivRecords'))return;invocationSignature='';invocationRequestSignature='';$('ivView').onchange=function(){invocationView=this.value;invocationSignature='';invocationRequestSignature='';refreshInvocations();};$('ivBackend').onchange=function(){invocationBackend=this.value;invocationSignature='';refreshInvocations();};$('ivKind').onchange=function(){invocationKindFilter=this.value;invocationSignature='';refreshInvocations();};$('ivRefresh').onclick=refreshInvocations;refreshInvocations();invocationTimer=setInterval(refreshInvocations,2000);}

  var directiveState={items:[],conflicts:[],chats:[],editing:null,loaded:false};
  function directiveTriggerLabel(item){
    var t=item.trigger||{},kind={manual:'手动',daily:'每天',hourly:'间隔',event:'事件触发'}[t.kind]||'手动';
    return kind+(t.time?' '+t.time:'');
  }
  function viewDirectives(){
    var d=directiveState,items=d.items||[],editing=d.editing||{};
    var rows=items.map(function(item){
      var warn=(d.conflicts||[]).some(function(c){return c.a===item.id||c.b===item.id;});
      return '<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0">'+
        '<div class="row"><span><b>'+esc(item.name||'未命名')+'</b> '+(item.enabled===false?'<span class="tag">已停用</span>':'<span class="tag">生效中</span>')+(warn?' <span class="tag" style="color:#b42318">有冲突</span>':'')+
        '<small class="muted" style="display:block">'+esc(directiveTriggerLabel(item))+' · 作用：'+esc(item.scope==='*'?'全部对话':item.scope)+(item.stopWhen?' · 结束条件：'+item.stopWhen:'')+'</small></span>'+
        '<span><button class="small" data-dir-edit="'+esc(item.id)+'">编辑</button> <button class="small" data-dir-toggle="'+esc(item.id)+'">'+(item.enabled===false?'启用':'停用')+'</button> <button class="danger small" data-dir-del="'+esc(item.id)+'">删除</button></span></div>'+
        '<p style="white-space:pre-wrap;margin:8px 0 0">'+esc(item.text||'')+'</p></div>';
    }).join('')||'<p class="muted">还没有长期指令。写一条就会开始生效。</p>';
    var conflicts=(d.conflicts||[]).map(function(c){
      var a=items.filter(function(i){return i.id===c.a;})[0],b=items.filter(function(i){return i.id===c.b;})[0];
      return '<p>⚠ '+esc((a&&a.name)||c.a)+' 与 '+esc((b&&b.name)||c.b)+'：'+esc(c.reason||'要求冲突')+'</p>';
    }).join('');
    var scopeOptions='<option value="*">全部对话</option>'+(d.chats||[]).map(function(k){return '<option value="'+esc(k)+'"'+(editing.scope===k?' selected':'')+'>'+esc(k)+'</option>';}).join('');
    return '<section class="card"><div class="section-heading"><h2>长期指令</h2><button class="small" id="dirRefresh">刷新</button></div>'+
      '<p class="muted">生效中的指令每轮都会带上。和当前要求或彼此冲突时，她会先说明冲突，再问保留哪一条。</p>'+
      (conflicts?'<div class="banner">'+conflicts+'</div>':'')+rows+'</section>'+
      '<section class="card"><h2>'+(editing.id?'编辑指令':'新建指令')+'</h2>'+
      '<label class="field">名字<input id="dirName" maxlength="40" value="'+esc(editing.name||'')+'"></label>'+
      '<label class="field">内容<textarea id="dirText" rows="4" maxlength="2000" placeholder="用平时说话写清楚要做什么，什么时候不用做">'+esc(editing.text||'')+'</textarea></label>'+
      '<div class="form-two"><label class="field">作用对象<select id="dirScope">'+scopeOptions+'</select></label>'+
      '<label class="field">触发<select id="dirKind">'+[['manual','手动'],['daily','每天'],['hourly','间隔'],['event','事件触发']].map(function(pair){return '<option value="'+pair[0]+'"'+(((editing.trigger&&editing.trigger.kind)||'manual')===pair[0]?' selected':'')+'>'+pair[1]+'</option>';}).join('')+'</select></label>'+
      '<label class="field">时间（如 08:30 或 6h）<input id="dirTime" maxlength="20" value="'+esc((editing.trigger&&editing.trigger.time)||'')+'"></label>'+
      '<label class="field">结束条件（可选）<input id="dirStop" maxlength="400" value="'+esc(editing.stopWhen||'')+'"></label></div>'+
      '<label class="check-field"><input type="checkbox" id="dirConfirm"'+(editing.requiresConfirm?' checked':'')+'>执行前先问我一次</label>'+
      '<div class="btnrow"><button class="primary" id="dirSave">保存</button><button id="dirClear">清空表单</button></div>'+
      '<p class="muted" id="dirStatus" role="status"></p></section>';
  }
  function loadDirectives(force){
    return api('GET','/im-bridge/directives').then(function(value){
      directiveState.items=value.directives||[];directiveState.conflicts=value.conflicts||[];directiveState.chats=value.chats||[];directiveState.loaded=true;
      renderPane();
    }).catch(function(error){if($('dirStatus'))$('dirStatus').textContent='读取失败：'+error.message;});
  }
  function bindDirectives(){
    if(!$('dirSave'))return;
    if(!directiveState.loaded)void loadDirectives();
    if($('dirRefresh'))$('dirRefresh').onclick=function(){this.disabled=true;loadDirectives().finally(()=>{if(this.isConnected)this.disabled=false;});};
    if($('dirClear'))$('dirClear').onclick=function(){directiveState.editing=null;renderPane();};
    if($('dirSave'))$('dirSave').onclick=async function(){
      this.disabled=true;
      try{
        var directive={id:directiveState.editing&&directiveState.editing.id||'',name:$('dirName').value,text:$('dirText').value,scope:$('dirScope').value,stopWhen:$('dirStop').value,requiresConfirm:$('dirConfirm').checked,trigger:{kind:$('dirKind').value,time:$('dirTime').value}};
        var value=await api('POST','/im-bridge/directives',{action:'save',directive:directive});
        directiveState.items=value.directives||[];directiveState.conflicts=value.conflicts||[];directiveState.editing=null;
        ['dirName','dirText','dirStop','dirTime'].forEach(function(id){var box=$(id);if(box)box.value='';});
        toast('长期指令已保存');renderPane();
      }catch(error){toast('保存失败：'+error.message);}
      finally{if(this.isConnected)this.disabled=false;}
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-dir-edit]'),function(button){button.onclick=function(){directiveState.editing=directiveState.items.filter(function(i){return i.id===button.dataset.dirEdit;})[0]||null;renderPane();};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-dir-toggle]'),function(button){button.onclick=async function(){var item=directiveState.items.filter(function(i){return i.id===button.dataset.dirToggle;})[0];if(!item)return;button.disabled=true;try{var value=await api('POST','/im-bridge/directives',{action:'toggle',id:item.id,enabled:item.enabled===false});directiveState.items=value.directives||[];directiveState.conflicts=value.conflicts||[];renderPane();}catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-dir-del]'),function(button){button.onclick=async function(){if(!await askConfirm('删除这条长期指令？之后她不会再照着做。'))return;button.disabled=true;try{var value=await api('POST','/im-bridge/directives',{action:'delete',id:button.dataset.dirDel});directiveState.items=value.directives||[];directiveState.conflicts=value.conflicts||[];if(directiveState.editing&&directiveState.editing.id===button.dataset.dirDel)directiveState.editing=null;renderPane();}catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}};});
  }
  function viewActivity() {
    if(!featureData)return unavailableFeatures();var audits=(featureData.audits||[]).slice().reverse();if(!audits.length)return '<div class="card"><div class="empty">新产生的模型回复会记录人设、记忆、链接读取结果与发送回执。</div></div>';
    var audit=audits.filter(a=>a.id===auditId)[0]||audits[0];auditId=audit.id;
    audit=Object.assign({},audit);['memoryIds','links','references','messageIds'].forEach(function(key){if(!Array.isArray(audit[key]))audit[key]=[];});
    var out='<div class="card"><h2>回复依据</h2><p class="muted">卡片可提供标题、简介、歌名与歌手等资料。网页读取包含可取得的文字；增强环境可在本机抽样读视频画面，先分析声音再转写可辨人声，并注明读取范围。</p><label class="field">选择一轮回复<select id="afAudit">'+audits.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===auditId?' selected':'')+'>'+esc(notesLabel(a.chat)+' · '+new Date(a.at).toLocaleTimeString()+' · '+String(a.input).slice(0,35))+'</option>').join('')+'</select></label><div class="audit-meta"><span class="tag">人设 '+esc(audit.persona)+'</span><span class="tag">'+esc(audit.model?.model||'默认模型')+'</span><span class="tag">使用 '+audit.memoryIds.length+' 条记忆</span>'+(audit.activity?'<span class="tag">当时在：'+esc(audit.activity)+'</span>':'')+'<span class="tag">'+(audit.usedSearch?'补充搜索':'未补充搜索')+'</span></div><h3>用户输入</h3><pre class="audit-text">'+esc(audit.input)+'</pre><h3>原回复</h3><pre class="audit-text">'+esc(audit.answer||'尚未生成回复')+'</pre><details><summary>查看注入的记忆条目</summary><ul>'+audit.memoryIds.map(id=>{var item=(audit.memoryItems||featureData.memories[audit.chat]?.items||[]).filter(i=>i.id===id)[0];return '<li>'+esc(item?item.text:'该条目已被修改或删除（ID '+id+'）')+'</li>';}).join('')+'</ul></details>';
    if(audit.videos?.length)out+='<h3>视频读取</h3>'+audit.videos.map(function(v){return '<p class="muted">'+esc(v.status==='sampled'?'已抽样 '+v.frames.length+' 帧（'+v.frames.join('、')+' 秒），音轨未读取':v.reason||'未取得画面')+'</p>';}).join('');
    if(audit.links.length){out+='<h3>链接读取结果</h3>';audit.links.forEach(link=>{out+='<div class="source-item"><b>'+esc(link.title||'未取得标题')+'</b><div class="mono">'+esc(link.finalUrl||link.url)+'</div><p class="muted">'+esc(({read:'读取到网页文字',disabled:'链接读取已关闭',metadata:'仅有元信息',restricted:'需要登录或验证',failed:'读取失败',empty:'未提取到内容'})[link.status]||link.status)+(link.error?' · '+esc(link.error):'')+'</p><p>'+esc(link.excerpt||link.description||'')+'</p></div>';});}
    if(audit.references.length)out+='<h3>引用与转发</h3>'+audit.references.map(ref=>'<p class="muted">'+esc(ref.type+' · '+ref.id+' · '+(ref.status==='read'?'已读取':ref.error||'未读取'))+'</p>').join('');
    out+='<div class="btnrow" style="margin-top:18px"><button class="danger" id="afWithdraw"'+(!audit.messageIds.length?' disabled':'')+'>向 QQ 申请撤回这轮回复</button></div><p class="muted">撤回是否成功由 QQ / NapCat 决定，结果会在这里反馈。下面的重新生成只做预览，确认发送后才会发到 QQ。</p><div id="afResult" class="muted" role="status"></div></div><div class="card"><h2>生成与发送修正版</h2><label class="field">修正要求<input id="afInstruction" placeholder="例如：只依据链接正文回答，不要猜测人物身份。"></label><button id="afRegenerate">生成修正版预览</button><label class="field">修正版内容<textarea id="afDraft" maxlength="10000">'+esc(correctionDrafts[auditId]||'')+'</textarea></label><button class="primary" id="afSend">确认发送修正版</button><p class="muted">发送会使用纯文字，不解释为配置或代发指令。</p></div>';return out;
  }
  function viewBackup() {
    if(!featureData)return unavailableFeatures();return '<div class="card"><h2>导出备份</h2><p class="muted">包含人设、学习经验、日／月／年记忆、模拟日程、联系人备注与对话偏好、表情分组。待归档日记账需同时勾选聊天记录。账号密钥、连接地址、服务地址、系统路径与运行队列不导出。</p><label class="check-field"><input id="bfAssets" type="checkbox">附带表情图片（合计最多 32MB）</label><label class="check-field"><input id="bfHistory" type="checkbox">附带聊天文字记录</label><button class="primary" id="bfExport">下载 JSON 备份</button></div><div class="card"><h2>预览与合并恢复</h2><p class="muted">先检查备份内容，再确认恢复。相同 ID 的现有角色和记忆会保留；恢复前自动保存一份不含密钥的检查点。</p><input id="bfFile" type="file" accept="application/json,.json"><div class="btnrow"><button id="bfPreview">检查备份</button></div><div id="bfPreviewResult" class="backup-preview" role="status"></div><label class="check-field"><input id="bfPreferences" type="checkbox">恢复通用性格、记忆规则与勿扰时段</label><label class="check-field"><input id="bfContacts" type="checkbox">合并联系人与群白名单（会增加允许访问机器人的对象，不恢复号主权限）</label><label class="check-field"><input id="bfMessages" type="checkbox">合并备份中的聊天文字</label><button class="primary" id="bfRestore"'+(!backupToken?' disabled':'')+'>确认合并恢复</button></div>' +
      '<div class="card"><h2>全部同步（含密钥与密码）</h2><div class="banner"><b>高风险：</b>完整同步包含插件版本、全部设置、DeepSeek API Key、生图/语音 API Key、QQ/NapCat 连接 token、支付密码密文和加密密钥、全部聊天记录、记忆、素材与人设图。只保存到可信设备，不要发给别人。恢复会覆盖当前全部数据，并在恢复前自动保存一份完整检查点。</div>' +
      '<p class="muted">适用于换手机或整机迁移；普通备份仍是不含密钥的合并备份。</p>' +
      '<button class="primary" id="bfFullExport">下载完整同步 JSON</button>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">' +
      '<input id="bfFullFile" type="file" accept="application/json,.json"><div class="btnrow"><button id="bfFullPreview">检查完整同步</button></div>' +
      '<div id="bfFullResult" class="backup-preview" role="status"></div>' +
      '<label class="check-field"><input id="bfFullConfirm" type="checkbox">我已了解：恢复会覆盖当前全部设置、密钥、聊天与记忆</label>' +
      '<button class="danger" id="bfFullRestore" disabled>确认完整恢复（覆盖）</button>' +
      '<p class="muted">恢复后建议完整退出并重新打开 DSH Go，旧会话、连接和插件版本才会完全切换。</p></div>';
  }
  function featurePrepareFormContext() { renderedMemoryContext=memoryChat+'|'+(memoryEditId||'new');renderedProfileContext=profileChat;renderedAuditContext=auditId; }
  function featureFieldKey(el) {
    if(['mfChat','pfChat','afAudit','ctScope','lifePersona','learnChat'].includes(el.id))return '';
    if(/^mf(?:Text|Kind|Pinned|Id)$/.test(el.id))return el.id+'@'+renderedMemoryContext;
    if(/^pf/.test(el.id))return el.id+'@'+renderedProfileContext;
    if(/^af/.test(el.id))return el.id+'@'+renderedAuditContext;
    return null;
  }
  function fieldsSaved(url,payload,editId) {
    if(url==='/im-bridge/features/memory'&&payload.action==='save')return ['mfText','mfKind','mfPinned','mfId'].map(id=>id+'@'+payload.key+'|'+(payload.id||'new'));
    if(url==='/im-bridge/features/profile')return ['pfPersona','pfModel','pfVoice','pfVoiceName','pfChars','pfProactive'].map(id=>id+'@'+payload.key);
    if(url==='/im-bridge/features/reliability')return ['dlDelay'];
    if(url==='/im-bridge/features/correction')return ['afDraft','afInstruction'].map(id=>id+'@'+payload.id);
    if(url==='/im-bridge/features/backup-restore')return ['bfFile','bfPreferences','bfContacts','bfMessages'];
    return fieldsSavedBasic(url,payload,editId);
  }
  async function featurePost(route,body,button) {
    if(button)button.disabled=true;
    try{return await api('POST','/im-bridge/features/'+route,body)}catch(error){toast(error.message);return null}finally{if(button?.isConnected)button.disabled=false}
  }
  function bindFeatureUI() {
    bindLearning();
    if($('soulChat'))$('soulChat').onchange=function(){soulChat=this.value;renderPane();};
    if($('websitesReadNow'))$('websitesReadNow').onclick=async function(){this.disabled=true;try{var result=await api('POST','/im-bridge/websites/read',{});toast('取得 '+result.read+' 个页面的信息，未直接发送QQ消息');await load();}catch(e){toast(e.message);}finally{if($('websitesReadNow'))$('websitesReadNow').disabled=false;}};
    if($('soulSave'))$('soulSave').onclick=async function(){try{await api('POST','/im-bridge/settings',{mood:{enabled:$('moodEnabled').checked,everyTurns:Number($('moodEvery').value),confidence:Number($('moodConfidence').value),halfLifeHours:Number($('moodDecay').value)},websites:{enabled:$('websitesEnabled').checked,learning:$('websitesLearning').checked,autoShare:$('websitesAutoShare').checked,intervalMinutes:Number($('websitesInterval').value),sources:$('websitesSources').value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{var parts=line.split('|'),url=parts.pop().trim(),name=parts.join('|').trim();try{var u=new URL(url);if(!/^https?:$/.test(u.protocol))throw Error();}catch{throw Error('来源地址无效：'+url);}return {url:url,name:name,enabled:true};})},media:{videoPlus:$('videoPlusEnabled').checked}});toast('情绪与学习设置已保存');await load();}catch(e){toast(e.message);}};
    if($('soulReset'))$('soulReset').onclick=async function(){if(!soulChat)return;const r=await featurePost('companion-state',{key:soulChat,action:'reset-mood'},this);if(r){toast('当前对话心情已回稳');await load();}};
    if($('soulForget'))$('soulForget').onclick=async function(){if(!soulChat)return;const r=await featurePost('companion-state',{key:soulChat,action:'forget-learning'},this);if(r){toast('这些理解不再影响当前对话');await load();}};
    var el;
    if((el=$('mfChat')))el.onchange=function(){rememberDraft('memory');memoryChat=this.value;memoryEditId='';renderPane();};
    Array.prototype.forEach.call(document.querySelectorAll('[data-memory-filter]'),button=>{button.onclick=function(){memoryFilter=button.getAttribute('data-memory-filter');renderPane();};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-memory-edit]'),button=>{button.onclick=function(){rememberDraft('memory');memoryEditId=button.getAttribute('data-memory-edit');renderPane();$('mfText').focus();};});
    if((el=$('mfCancel')))el.onclick=function(){rememberDraft('memory');memoryEditId='';renderPane();};
    if((el=$('mfSave')))el.onclick=async function(){var result=await featurePost('memory',{key:memoryChat,id:memoryEditId,action:'save',text:$('mfText').value,kind:$('mfKind').value,pinned:$('mfPinned').checked},this);if(result){memoryEditId='';toast('记忆已更新，后续对话使用新内容');await load();}};
    ['confirm','pin','delete'].forEach(action=>Array.prototype.forEach.call(document.querySelectorAll('[data-memory-'+action+']'),button=>{button.onclick=async function(){var id=button.getAttribute('data-memory-'+action);var item=featureData.memories[memoryChat].items.filter(i=>i.id===id)[0];if(action==='delete'&&!await askConfirm('删除这条记忆？后续会话将不再注入它，历史聊天记录仍保留。'))return;var result=await featurePost('memory',{key:memoryChat,id,action,kind:item.proposedKind,pinned:!item.pinned},button);if(result)await load();};}));
    if((el=$('pfChat')))el.onchange=function(){rememberDraft('profiles');profileChat=this.value;renderPane();};
    if((el=$('pfSave')))el.onclick=async function(){var value=$('pfModel').value.split('|');var bool=id=>$(id).value==='inherit'?null:$(id).value==='true';var result=await featurePost('profile',{key:profileChat,profile:{personaId:$('pfPersona').value,voiceEnabled:bool('pfVoice'),voiceName:$('pfVoiceName').value,replyChars:Number($('pfChars').value),proactive:bool('pfProactive')},model:value.length===2?{provider:value[0],model:value[1]}:null},this);if(result){toast('对话配置已保存');await load();}};
    if((el=$('dlSave')))el.onclick=async function(){var result=await featurePost('reliability',{replyDelayMs:Number($('dlDelay').value)},this);if(result)await load();};
    bindDeliveryActions();
    Array.prototype.forEach.call(document.querySelectorAll('[data-inbox-retry]'),button=>{button.onclick=async function(){if(!await askConfirm('重新提交这条输入？如果之前已经生成过回复，可能会再次回复。'))return;var result=await featurePost('inbox-retry',{id:button.getAttribute('data-inbox-retry'),confirmUncertain:true},button);if(result)await load();};});
    if((el=$('afAudit')))el.onchange=function(){rememberDraft('activity');auditId=this.value;renderPane();};
    if((el=$('afWithdraw')))el.onclick=async function(){if(!await askConfirm('向 QQ 申请撤回这轮已确认发送的消息？'))return;var result=await featurePost('withdraw',{id:auditId},this);if(result)$('afResult').textContent=result.results.map(r=>r.messageId+'：'+(r.ok?'已撤回':r.error)).join('；');};
    if((el=$('afRegenerate')))el.onclick=async function(){var id=auditId;var result=await featurePost('regenerate',{id,instruction:$('afInstruction').value},this);if(result){correctionDrafts[id]=result.draft;if(tab==='activity'&&auditId===id){$('afDraft').value=result.draft;rememberDraft('activity');renderDraftNotice();}toast('已生成预览，尚未发送');}};
    if((el=$('afSend')))el.onclick=async function(){if(!$('afDraft').value.trim())return toast('先填写或生成修正版');if(!await askConfirm('把当前修正版发送到这轮回复对应的 QQ 对话？'))return;var result=await featurePost('correction',{id:auditId,text:$('afDraft').value},this);if(result)toast('修正版已加入发送队列');};
    if((el=$('bfExport')))el.onclick=async function(){var result=await featurePost('backup-export',{includeAssets:$('bfAssets').checked,includeMessages:$('bfHistory').checked},this);if(!result)return;var url=URL.createObjectURL(new Blob([JSON.stringify(result.bundle,null,2)],{type:'application/json'}));var anchor=document.createElement('a');anchor.href=url;anchor.download='qq-bridge-backup-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('备份已下载');};
    if((el=$('bfFile')))el.onchange=function(){backupBundle=null;backupToken='';$('bfRestore').disabled=true;$('bfPreviewResult').textContent='';};
    if((el=$('bfPreview')))el.onclick=async function(){var file=$('bfFile').files[0];if(!file)return toast('请选择备份 JSON 文件');try{if(file.size>48*1024*1024)throw new Error('备份文件超过 48MB');backupBundle=JSON.parse(await file.text());var result=await featurePost('backup-preview',{bundle:backupBundle},this);if(result){backupToken=result.token;$('bfRestore').disabled=false;$('bfPreviewResult').textContent='角色 '+result.counts.personae+' 个 · 联系人 '+result.counts.contacts+' 个 · 记忆 '+result.counts.memories+' 条 · 图片 '+result.counts.assets+' 张 · 聊天文字 '+result.counts.messages+' 条。已有角色冲突 '+result.conflicts.personae+' 个，将保留现有内容。默认不恢复访问名单，只有明确勾选后才合并联系人与群白名单；号主权限不恢复。';}}catch(error){backupToken='';toast(error.message);}};
    if((el=$('bfRestore')))el.onclick=async function(){if(!backupToken||!backupBundle)return toast('请先检查备份');if(!await askConfirm('按当前勾选项合并恢复？同 ID 现有角色与记忆会保留，恢复前将保存检查点。'))return;var result=await featurePost('backup-restore',{bundle:backupBundle,token:backupToken,restorePreferences:$('bfPreferences').checked,restoreContacts:$('bfContacts').checked,restoreMessages:$('bfMessages').checked},this);backupToken='';if(result){backupBundle=null;toast('合并恢复完成，恢复前检查点已保存');await load();}else if($('bfRestore'))$('bfRestore').disabled=true;};
    if((el=$('bfFullExport')))el.onclick=async function(){var result=await featurePost('backup-export',{fullSync:true},this);if(!result?.bundle)return;var url=URL.createObjectURL(new Blob([JSON.stringify(result.bundle,null,2)],{type:'application/json'}));var anchor=document.createElement('a');anchor.href=url;anchor.download='qq-bridge-full-sync-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('完整同步已下载，请妥善保管');};
    if((el=$('bfFullFile')))el.onchange=function(){fullBackupBundle=null;fullBackupToken='';if($('bfFullRestore'))$('bfFullRestore').disabled=true;if($('bfFullResult'))$('bfFullResult').textContent='';};
    if((el=$('bfFullPreview')))el.onclick=async function(){var file=$('bfFullFile').files[0];if(!file)return toast('请选择完整同步 JSON');try{if(file.size>48*1024*1024)throw new Error('完整同步文件超过 48MB');fullBackupBundle=JSON.parse(await file.text());var result=await featurePost('backup-preview',{bundle:fullBackupBundle},this);if(!result?.fullSync)throw new Error('这不是完整同步文件');fullBackupToken=result.token;if($('bfFullRestore'))$('bfFullRestore').disabled=false;if($('bfFullResult'))$('bfFullResult').textContent='插件版本 '+(result.pluginVersion||'未知')+' · 角色 '+result.counts.personae+' 个 · 联系人 '+result.counts.contacts+' 个 · 群 '+result.counts.groups+' 个 · 记忆范围 '+result.counts.memories+' 个 · 聊天 '+result.counts.messages+' 条 · 素材 '+result.counts.assets+' 个 · 日历文件 '+result.counts.calendarFiles+' · 学习文件 '+result.counts.learningFiles+' · 成长文件 '+result.counts.growthFiles+' · 支付秘密 '+result.counts.phoneSecrets+' 个 · DeepSeek Key '+(result.counts.deepseekKey?'有':'无')+'。'+result.warning;}catch(error){fullBackupToken='';toast(error.message);}};
    if((el=$('bfFullRestore')))el.onclick=async function(){if(!fullBackupToken||!fullBackupBundle)return toast('请先检查完整同步');if(!$('bfFullConfirm').checked)return toast('请先勾选确认覆盖');if(!await askConfirm('完整恢复会覆盖当前全部设置、密钥、聊天、记忆和素材。确定继续？'))return;var result=await featurePost('backup-restore',{bundle:fullBackupBundle,token:fullBackupToken,fullSync:true,restoreFull:true},this);fullBackupToken='';if(!result)return;fullBackupBundle=null;if($('bfFullRestore'))$('bfFullRestore').disabled=true;if($('bfFullResult'))$('bfFullResult').textContent='完整恢复完成。'+((result.notes||[]).join('；'))+'。恢复前检查点：'+(result.checkpoint||'已保存');toast('完整恢复完成，请重载插件');await load();};
  }

  var companionPanel={updatedAt:0,value:null,key:'',busy:false,error:'',evidence:null,search:'',showEvents:false,signature:''};
  function companionScopeSignature(){return JSON.stringify([data.settings.activeAccountId,data.settings.activePersonaId,data.settings.personae,data.settings.contactProfiles]);}
  function companionPanelKey(){return companionPanel.key||((data.settings.owners||[])[0]?'private:'+data.settings.owners[0]:(featureData?.knownChats||[])[0]||'');}
  async function refreshCompanionPanel(options){
    if(companionPanel.busy)return;var signature=companionScopeSignature();companionPanel.signature=signature;companionPanel.busy=true;companionPanel.error='';
    try{var r=await api('POST','/im-bridge/features/companion',{action:'snapshot',key:companionPanelKey()});if(signature===companionScopeSignature()){companionPanel.value=r;companionPanel.key=r.key;companionPanel.updatedAt=Date.now();}}catch(e){companionPanel.error=e.message;}finally{companionPanel.busy=false;if(options?.render!==false){if(tab==='overview'){updateHomeNumbers();renderOverviewIfChanged();}else if(['daily','diary','star','study','songs'].includes(tab))renderPane();}}
  }
  function companionPanelToolbar(){
    if(companionPanel.signature&&companionPanel.signature!==companionScopeSignature()){companionPanel.value=null;companionPanel.key='';companionPanel.evidence=null;companionPanel.error='';}
    if(!companionPanel.value&&!companionPanel.busy&&!companionPanel.error)setTimeout(refreshCompanionPanel,0);
    return '<div id="cpPanelState" class="companion-load" role="status"'+(!companionPanel.busy&&!companionPanel.error?' hidden':'')+'>'+esc(companionPanel.error||'正在翻开她的小世界…')+'</div>';
  }
  function companionEvidenceMarkup(){var e=companionPanel.evidence;return e?'<div class="card" id="cpEvidence"><h2>来源原文</h2><p>'+esc(e.date||'')+' · '+esc(e.source?.key||'')+' · '+esc(e.speakerName||e.speakerId||e.personaName||'')+'</p><div class="diary-text">'+esc(e.text||'')+'</div><p class="muted">'+esc(e.status||'')+'</p></div>':'';}
  function learningNotebookMarkup(l){
    var subjects=['全部','日常表达','网络梗','音乐','绘画','游戏','工具与操作','其他知识'];
    var rows=l.items||[];
    return '<section class="card learning-notebook"><h2>她的学习本</h2><p class="muted">按内容自动分册，保留理解、使用场合和来源；仅展示来自实际交流和任务的学习结果。</p><div class="btnrow">'+subjects.map(s=>'<button class="small" data-notebook-subject="'+esc(s)+'">'+esc(s)+(s==='全部'?'':' '+Number(l.subjects?.[s]||0))+'</button>').join('')+'</div><div id="cpNotebookRows">'+rows.slice(0,40).concat(rows.filter(i=>i.subject==='网络梗').slice(-20).filter(i=>!rows.slice(0,40).includes(i))).map(i=>'<details class="msg" data-notebook-row="'+esc(i.subject||'其他知识')+'"><summary>'+esc(i.summary)+' <small>· '+esc(i.subject||'其他知识')+'</small></summary><p>适合：'+esc(i.when)+'</p><p>留意：'+esc(i.avoid)+'</p>'+(i.example?'<p>练习：'+esc(i.example)+'</p>':'')+'<small>依据：'+esc(i.quote||'')+' · '+esc(i.source?.title||'')+'</small></details>').join('')+(!rows.length?'<p class="muted">还没有核对完成的笔记。</p>':'')+'</div><p class="muted">这里展示最近笔记。固定任务由你提出后登记到长期任务，实际答复和评价记录在下方。</p></section>';
  }
  function viewStudy(){
    var l=companionPanel.value?.learning||{},e=companionPanel.value?.expression||{},effects=l.effects||{},apps=(l.applications||[]),expressionApps=e.applications||[];
    apps=apps.map(a=>({...a,sources:a.sources||[]}));expressionApps.forEach(a=>{if(!apps.some(b=>b.auditId===a.auditId))apps.push({...a,sources:a.ids||[],reply:'本轮使用了 '+(a.ids||[]).length+' 条表达方法'});});apps.sort((a,b)=>b.at-a.at);
    return companionPanelToolbar()+learningNotebookMarkup(l)+'<div class="card"><h2>学习有没有用</h2><p>已存 '+(l.items||[]).length+' 条 · 召回 '+Number(effects.retrieved||0)+' 次 · 已评价 '+Number(effects.reviewed||0)+' 轮 · 暂停使用 '+Number(effects.suspended||0)+' 条</p><p class="muted">召回表示交给模型参考；生成、QQ确认送达和你的评价分别记录。纠正会关联到这次实际使用的经验。</p></div><div class="card"><h2>最近应用到的答复</h2>'+apps.slice(0,20).map(a=>'<article class="msg"><p>'+esc(a.reply||'已召回，等待答复结果')+'</p><small>'+esc(a.status)+' · '+a.sources.length+' 条经验'+(a.feedback?' · '+(a.feedback.rating>0?'有帮助':'不合适'):'')+'</small>'+(['generated','delivered'].includes(a.status)?'<div class="btnrow"><button data-cp-feedback="'+esc(a.auditId)+'" data-cp-rating="1">这次有帮助</button><button data-cp-feedback="'+esc(a.auditId)+'" data-cp-rating="-1">这次用得不对</button></div>':'')+'</article>').join('')+(!apps.length?'<p class="muted">新版开始记录具体使用结果，不把旧召回次数冒充已验证效果。</p>':'')+'</div><details class="card"><summary>已提炼的表达方法 '+(e.items||[]).length+' 条</summary>'+(e.items||[]).slice().reverse().map(i=>'<article class="msg"><b>'+esc(i.situation)+'</b><p>'+esc(i.style)+'</p><small>召回 '+Number(i.uses||0)+' 次</small></article>').join('')+'</details><div class="btnrow"><button data-go="thoughts">管理来源与学习设置</button></div>';
  }
  function viewSongs(){return '<div data-rh-audio="sing"></div>';}
  async function openCompanionEvidence(id){try{var r=await api('POST','/im-bridge/features/companion',{key:companionPanelKey(),action:'evidence',id});companionPanel.evidence=r.result;renderPane();$('cpEvidence')?.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){toast(e.message);}}
  function bindCompanionPanel(){
    document.querySelectorAll('[data-notebook-subject]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-notebook-row]').forEach(row=>row.hidden=b.dataset.notebookSubject!=='全部'&&row.dataset.notebookRow!==b.dataset.notebookSubject);});


    async function life(body){try{await api('POST','/im-bridge/life-execution',{personaId:companionPanel.value?.diary?.personaId,...body});await refreshCompanionPanel();}catch(e){toast(e.message);}}
    if($('cpCheckTasks'))$('cpCheckTasks').onclick=()=>life({action:'run'});document.querySelectorAll('[data-cp-wake]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await life({action:'wake',minutes:15});}finally{if(b.isConnected)b.disabled=false;}});if($('cpRest'))$('cpRest').onclick=()=>life({action:'rest'});
    document.querySelectorAll('[data-cp-life-q]').forEach(b=>b.onclick=()=>life({action:'answer',id:b.dataset.cpLifeQ,answer:b.dataset.cpAnswer}));
    document.querySelectorAll('[data-cp-decision]').forEach(b=>b.onclick=async()=>{try{await api('POST','/im-bridge/operations',{action:'answer',id:b.dataset.cpDecision,answer:b.dataset.cpAnswer});await refreshCompanionPanel();}catch(e){toast(e.message);}});
    document.querySelectorAll('[data-cp-resume]').forEach(b=>b.onclick=()=>life({action:'resume',id:b.dataset.cpResume,observed:false}));
    if($('cpJournal'))$('cpJournal').onclick=async function(){this.disabled=true;try{const written=await api('POST','/im-bridge/features/companion',{key:companionPanelKey(),action:'journal'});if(written.result?.reason)toast(written.result.reason);await refreshCompanionPanel();}catch(e){toast(e.message);}finally{if(this.isConnected)this.disabled=false;}};
    document.querySelectorAll('[data-cp-evidence]').forEach(b=>b.onclick=()=>openCompanionEvidence(b.dataset.cpEvidence));
    document.querySelectorAll('[data-cp-relation]').forEach(b=>b.onclick=()=>{var id=b.getAttribute('data-cp-relation');if(id)openCompanionEvidence(id);else toast('这条关系还没有可打开的原话');});
    if($('cpGraphSearch'))$('cpGraphSearch').oninput=function(){companionPanel.search=this.value;drawRebuiltGraph();};if($('cpGraphEvents'))$('cpGraphEvents').onchange=function(){companionPanel.showEvents=this.checked;drawRebuiltGraph();};if($('cpGraph'))drawRebuiltGraph();
    document.querySelectorAll('[data-cp-feedback]').forEach(b=>b.onclick=async()=>{try{await api('POST','/im-bridge/features/companion',{key:companionPanelKey(),action:'feedback',id:b.dataset.cpFeedback,rating:Number(b.dataset.cpRating)});await refreshCompanionPanel();}catch(e){toast(e.message);}});

  }

// Perspective projection of stable, evidence-backed nodes. No external assets or telemetry.
function mountCompanionConstellation(stage,graph,{search='',showEvents=false,onSelect=()=>{}}={}){
 const all=new Map((graph.nodes||[]).map(n=>[n.id,n])),raw=graph.edges||[],primary=(graph.nodes||[]).find(n=>n.type==='persona'&&n.personaId===graph.personaId)||(graph.nodes||[]).find(n=>n.type==='persona'),events=new Set(raw.filter(e=>e.source===primary?.id&&all.get(e.target)?.sourceId).map(e=>e.target));
 const degree=new Map();for(const e of raw){degree.set(e.source,(degree.get(e.source)||0)+(e.count||1));degree.set(e.target,(degree.get(e.target)||0)+(e.count||1));}
 const ordered=(graph.nodes||[]).filter(n=>degree.has(n.id)&&n.type!=='persona').sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0));
 const keep=[...(primary?[primary]:[]),...ordered.slice(0,84)];
 const nodes=keep.map(n=>({...n})),visible=new Set(nodes.map(n=>n.id)),links=new Map();
 const connect=(a,b,proof)=>{if(a===b||!visible.has(a)||!visible.has(b))return;const key=[a,b].sort().join('|');if(!links.has(key))links.set(key,{a,b,proof:new Set()});for(const id of proof||[])links.get(key).proof.add(id);};for(const e of raw)connect(e.source,e.target,e.sourceIds);
 if(!showEvents)for(const event of events){const neighbours=raw.filter(e=>e.source===event||e.target===event).map(e=>({id:e.source===event?e.target:e.source,proof:e.sourceIds||[]})).filter(x=>visible.has(x.id));for(const n of neighbours)if(n.id!==primary?.id)connect(primary?.id,n.id,n.proof);}
 stage.replaceChildren();const canvas=document.createElement('canvas'),labels=document.createElement('div');canvas.setAttribute('aria-hidden','true');labels.className='star-labels';stage.append(canvas,labels);
 const ctx=canvas.getContext('2d'),seed=s=>[...String(s)].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7),rand=(s,k)=>{let n=seed(s+':'+k);n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;};
 const palette={persona:[192,211,255],person:[142,210,231],group:[190,167,239],'private-chat':[225,204,166],topic:[225,167,204],memory:[163,186,225],activity:[152,215,190]},query=search.trim().toLowerCase(),matches=new Set(nodes.filter(n=>n.label?.toLowerCase().includes(query)).map(n=>n.id)),near=new Set(matches);
 if(query)for(const l of links.values())if(matches.has(l.a)||matches.has(l.b)){near.add(l.a);near.add(l.b);}
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),listeners=[];let width=1,height=1,dpr=1,yaw=-.26,pitch=.18,zoom=1,drag=null,moved=false,hover='',selected='',raf=0,last=0,closed=false,paused=false,frameCount=0;
 const dust=Array.from({length:680},(_,i)=>{const angle=rand('dust'+i,1)*Math.PI*2,radius=75+rand('dust'+i,2)*440;return{x:Math.cos(angle)*radius,y:(rand('dust'+i,3)-.5)*360,z:Math.sin(angle)*radius,size:.3+rand('dust'+i,4)*.8,alpha:.14+rand('dust'+i,5)*.42};});
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],theta=i*2.39996323+rand(n.id,1)*.65,v=(i+.5)/Math.max(nodes.length,1),yy=1-2*v,ring=Math.sqrt(Math.max(0,1-yy*yy)),radius=155+rand(n.id,2)*100;
  n.x=n.type==='persona'?0:Math.cos(theta)*ring*radius;n.y=n.type==='persona'?0:yy*radius*.68;n.z=n.type==='persona'?0:Math.sin(theta)*ring*radius;n.color=palette[n.type]||palette.memory;
  const button=document.createElement('button');button.type='button';button.setAttribute('role','button');button.className='star-label'+(n.type==='persona'?' star-primary':'');button.textContent=n.label||'未命名记忆';button.setAttribute('aria-label',(n.label||'记忆')+'，查看记忆来源');button.title=n.label||'';button.dataset.nodeId=n.id;
  button.onclick=e=>{if(moved&&e.detail!==0)return;selected=n.id;onSelect(n);draw();};button.onfocus=()=>{hover=n.id;draw();};button.onblur=()=>{hover='';draw();};button.onpointerenter=()=>{hover=n.id;draw();};button.onpointerleave=()=>{hover='';draw();};labels.append(button);n.button=button;
 }
 if(!nodes.length){const empty=document.createElement('p');empty.className='star-empty';empty.textContent='故事慢慢发生，星星也会慢慢亮起来。';labels.append(empty);}
 const positions=new Map();
 function project(p){const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),x=p.x*cy+p.z*sy,z=p.z*cy-p.x*sy,y=p.y*cp-z*sp,depth=z*cp+p.y*sp,scale=650/(650+depth),fit=Math.min(width/690,height/490)*zoom;return{x:width/2+x*scale*fit,y:height/2+y*scale*fit,scale,depth};}
 function light(x,y,r,rgb,alpha){if(!ctx)return;const gradient=ctx.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,'rgba('+rgb+','+alpha+')');gradient.addColorStop(.22,'rgba('+rgb+','+(alpha*.38)+')');gradient.addColorStop(1,'rgba('+rgb+',0)');ctx.fillStyle=gradient;ctx.fillRect(x-r,y-r,r*2,r*2);}
 function draw(){
  if(closed||!ctx)return;frameCount++;stage.dataset.frames=String(frameCount);stage.dataset.yaw=yaw.toFixed(4);ctx.clearRect(0,0,width,height);ctx.fillStyle='#0c1224';ctx.fillRect(0,0,width,height);
  light(width*.36,height*.53,width*.57,'70,84,147',.15);light(width*.71,height*.4,width*.37,'89,62,123',.12);light(width*.52,height*.62,height*.64,'37,99,126',.08);
  for(const p of dust){const s=project(p);if(s.x<0||s.y<0||s.x>width||s.y>height)continue;ctx.beginPath();ctx.arc(s.x,s.y,Math.max(.25,p.size*s.scale),0,Math.PI*2);ctx.fillStyle='rgba(185,207,237,'+Math.min(.7,p.alpha*s.scale)+')';ctx.fill();}
  positions.clear();for(const n of nodes)positions.set(n.id,project(n));
  for(const l of links.values()){const a=positions.get(l.a),b=positions.get(l.b),highlight=[l.a,l.b].includes(hover||selected),alpha=query&&!(near.has(l.a)&&near.has(l.b))?.018:highlight?.4:.105;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(161,182,230,'+alpha+')';ctx.lineWidth=highlight?.85:.55;ctx.stroke();}
  for(const n of [...nodes].sort((a,b)=>positions.get(b.id).depth-positions.get(a.id).depth)){
   const p=positions.get(n.id),active=n.id===hover||n.id===selected,dim=query&&!near.has(n.id),r=(n.type==='persona'?4.5:n.type==='memory'||n.type==='activity'?1.7:2.8)*p.scale;
   light(p.x,p.y,(active?27:n.type==='persona'?29:17)*p.scale,n.color.join(','),dim?.1:active?.8:.52);
   ctx.beginPath();ctx.arc(p.x,p.y,Math.max(.7,r),0,Math.PI*2);ctx.fillStyle='rgba('+n.color+','+(dim?.15:.95)+')';ctx.fill();
   if(active){ctx.beginPath();ctx.arc(p.x,p.y,r+5,0,Math.PI*2);ctx.strokeStyle='rgba('+n.color+',.45)';ctx.lineWidth=.7;ctx.stroke();}
   const b=n.button;b.style.left=p.x+'px';b.style.top=(p.y+r+7)+'px';b.style.opacity=String(dim?.18:Math.min(1,.5+p.scale*.25));b.style.zIndex=String(Math.round(1000-p.depth));b.style.fontSize=(n.type==='persona'?14:Math.max(10,Math.min(12,11*p.scale)))+'px';b.classList.toggle('is-active',active);b.classList.toggle('is-subtle',!active&&!['persona','person','group','topic'].includes(n.type));
  }
 }
 function resize(){if(closed)return;const rect=stage.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx?.setTransform(dpr,0,0,dpr,0,0);draw();}
 function frame(time){raf=0;if(closed||paused||document.hidden||reduced.matches||!stage.isConnected)return;if(time-last>=40){const delta=Math.min(100,time-(last||time));last=time;if(!drag&&!hover)yaw+=delta*.000015;draw();}raf=requestAnimationFrame(frame);}
 function run(){if(!raf&&!closed&&!paused&&!document.hidden&&!reduced.matches&&stage.isConnected){last=0;raf=requestAnimationFrame(frame);}}
 const on=(target,name,fn,options)=>{target.addEventListener(name,fn,options);listeners.push([target,name,fn,options]);};
 on(stage,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw,pitch};moved=false;});
 on(stage,'selectstart',e=>e.preventDefault());on(stage,'dragstart',e=>e.preventDefault());
 on(stage,'pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved||=Math.hypot(dx,dy)>5;if(moved){e.preventDefault();stage.classList.add('is-dragging');if(!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);yaw=drag.yaw+dx*.006;pitch=Math.max(-1.25,Math.min(1.25,drag.pitch+dy*.005));draw();}});
 const end=e=>{if(drag?.id!==e.pointerId)return;drag=null;stage.classList.remove('is-dragging');if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);};on(stage,'pointerup',end);on(stage,'lostpointercapture',e=>{if(drag?.id===e.pointerId){drag=null;moved=true;stage.classList.remove('is-dragging');}});on(stage,'pointercancel',e=>{moved=true;end(e);});
 on(stage,'wheel',e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2.2,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
 on(stage,'keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){yaw=-.26;pitch=.18;zoom=1;}else if(e.key==='+'||e.key==='-')zoom=Math.max(.5,Math.min(2.2,zoom*(e.key==='+'?1.1:.9)));else if(e.key==='ArrowLeft'||e.key==='ArrowRight')yaw+=e.key==='ArrowLeft'?-.12:.12;else pitch=Math.max(-1.25,Math.min(1.25,pitch+(e.key==='ArrowUp'?-.12:.12)));draw();});
 on(document,'visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else run();});on(reduced,'change',()=>{cancelAnimationFrame(raf);raf=0;draw();run();});
 const observer=new ResizeObserver(resize);observer.observe(stage);stage.dataset.renderer='3d-particles';stage.tabIndex=0;resize();run();
 return {resetView(){yaw=-.26;pitch=.18;zoom=1;selected='';draw();},toggleMotion(){paused=!paused;if(paused){cancelAnimationFrame(raf);raf=0;}else run();return paused;},destroy(){closed=true;cancelAnimationFrame(raf);observer.disconnect();for(const [target,name,fn,options]of listeners)target.removeEventListener(name,fn,options);stage.replaceChildren();}};
}

  function companionWhale(){return '<svg viewBox="0 0 120 105" aria-hidden="true"><path d="M18 58C9 24 69 13 83 47c3 7 4 16 0 24 12 1 20-6 25-18 8 27-12 38-33 34-29 9-54-4-57-29Z" fill="#92b8ee" stroke="#697bb4" stroke-width="2.5"/><path d="M42 30c-5-9-1-17 6-19m3 18c-1-9 4-14 11-15" fill="none" stroke="#8aa7db" stroke-width="3" stroke-linecap="round"/><ellipse cx="36" cy="63" rx="7" ry="4" fill="#eebbd7"/><circle cx="40" cy="54" r="3" fill="#46537b"/><path d="M42 69q11 8 21-2" fill="none" stroke="#56658f" stroke-width="2.5" stroke-linecap="round"/><path d="m83 15 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#f0d29b"/></svg>';}
  function currentCompanion(){var v=companionPanel.value||{},life=v.life||{},online=v.online??(data.status.connected&&!data.status.accountPaused),sleep=!online||life.sleeping;return {v,life,online,sleep,title:!online?'设备未连接':sleep?'正在休息':(life.scene?.planned?'打算：':'')+(life.scene?.activity||'正在安排今天'),name:data.status.personaName||data.status.persona?.name||'小鲸'};}
  function companionHero(){var c=currentCompanion(),clock=c.v.today?.clock||new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());return '<section class="life-hero"><div class="life-avatar">'+companionWhale()+'</div><div class="life-copy"><span class="life-eyebrow">'+esc(c.name)+'的小小世界 · <span id="heroClock">'+esc(clock)+'</span></span><h2>'+esc(c.sleep?c.title:'今天也在这里')+'</h2><p>'+esc(!c.online?'离线的时间就是睡眠，不补编生活。':c.sleep?'正在按自己的作息休息。':c.title)+'</p><div class="life-state"><i class="status-dot '+(c.online?'online':'')+'"></i>'+esc(c.online?'QQ 已连接':'QQ 未连接')+' <span>·</span> '+esc(c.v.today?.day||'上海时间')+'</div>'+(!c.online?'<div class="hero-wake"><button data-go="connection">先连接 QQ</button></div>':c.sleep?'<div class="hero-wake"><button class="primary" data-cp-wake>叫醒她 · 15 分钟</button><small>也可以在号主 QQ 私聊里说“醒醒”，或直接告诉她现在想做什么。</small></div>':'')+'</div><span class="hero-star" aria-hidden="true">✧</span></section>';}
  var LIFE_CAPABILITY_LABELS={group:'群聊参与',draw:'画画',browse:'浏览',listen:'听歌',social:'QQ交流',write:'写作',digital:'数字操作',local:'本机操作',sleep:'睡眠',rest:'休息',unsupported:'跳过实体活动',physical:'跳过实体活动'};
  var LIFE_JOB_LABELS={planned:'计划中',queued:'等待执行',running:'正在执行',participating:'群参与中',waiting_user:'等你决定',completed:'已完成',failed:'未能完成',ended:'已结束',unsupported:'已跳过',sleeping:'睡眠',budget:'今日额度已用完',interrupted:'已中断',incomplete:'未确认结果',cancelled:'已取消',paused:'进度已保存',needs_reconcile:'需要核对',user_request:'按你的请求安排'};
  function mergeDisplaySlots(input){
    var rows=[];
    (input||[]).forEach(function(slot){
      var previous=rows.at(-1),same=previous&&Number(previous.end)===Number(slot.start)&&String(previous.activity||'').trim()===String(slot.activity||'').trim()&&String(previous.taskKind||'')===String(slot.taskKind||'')&&Boolean(previous.offline)===Boolean(slot.offline)&&Boolean(previous.planOnly)===Boolean(slot.planOnly)&&JSON.stringify(previous.groupIds||[])===JSON.stringify(slot.groupIds||[])&&String(previous.leaveWhen||'')===String(slot.leaveWhen||'');
      if(same){previous.end=slot.end;previous.endClock=slot.endClock;previous._displaySlots.push(slot);if(slot.state==='current')previous.state='current';}
      else rows.push({...slot,_displaySlots:[slot]});
    });
    return rows;
  }
  function slotJob(c,slot){var day=c.v.today?.day||'';return (c.life.jobs||[]).find(function(j){return j.scene&&j.scene.date===day&&j.scene.start===slot.startClock&&j.scene.activity===slot.activity;})||null;}
  function slotCapability(slot,job){var kind=slot.taskKind||job?.kind||'';return LIFE_CAPABILITY_LABELS[kind]||'';}
  function slotGroupNote(slot){var ids=Array.isArray(slot.groupIds)?slot.groupIds:[],parts=[];if(ids.length)parts.push('群 '+ids.slice(0,3).join('、')+(ids.length>3?' 等 '+ids.length+' 个':''));if(slot.leaveWhen)parts.push('离开：'+slot.leaveWhen);return parts.join(' · ');}
  function slotRealState(c,slot){
    var originals=slot._displaySlots||[slot],jobs=originals.map(function(s){return slotJob(c,s);}).filter(Boolean),active=originals.find(function(s){return s.state==='current';}),job=active?slotJob(c,active):jobs.at(-1);
    if(c.sleep&&slot.state==='current')return c.life.filteringOrdinaryMessages?'睡眠中，明确请求可以唤醒':'正在休息，你发私聊仍能接话';
    if(slot.state==='current'&&c.life.scene?.conversation)return c.life.scene.activity+(c.life.scene.topic?' · 话题：'+c.life.scene.topic:'')+'；原计划暂缓，未记为完成';
    if(job){
      if(job.group)return job.group.open?'群参与已开启'+((job.group.ids||[]).length?' · '+job.group.ids.length+' 个群':''):'群参与已结束'+(job.group.reason?' · '+job.group.reason:'');
      var label=LIFE_JOB_LABELS[job.status]||job.status||'未知';
      var evidence=(job.evidence||[]).filter(function(e){return e.ok&&e.substantive;}).length;
      var reason=['failed','needs_reconcile','paused','interrupted','incomplete','budget','ended'].indexOf(job.status)!==-1&&job.reason?' · '+job.reason:'';
      return label+(evidence?' · '+evidence+' 条实际结果':'')+reason;
    }
    if(slot.offline||slot.state==='offline')return '离线睡眠，不执行';
    if(slot.planOnly||slot.taskKind==='rest')return '日常安排 · 仅计划';
    if(slot.taskKind==='group')return slot.state==='current'?'群参与未开启':slot.state==='upcoming'?'还没到点':'没有执行记录';
    if(slot.state==='current')return '还没开始执行';
    if(slot.state==='upcoming')return '还没到点';
    return '没有执行记录';
  }
  function compactTimeline(limit){var c=currentCompanion(),today=c.v.today||{},slots=mergeDisplaySlots(today.slots||[]),filtered=limit?slots.filter(s=>s.end>today.minute).slice(0,limit):slots;if(!filtered.length)return '<div class="empty-soft">'+(c.online?'正在准备接下来的安排，稍后自动更新。':'离线睡眠中，连接后只安排接下来的时间。')+'</div>';return '<ol class="life-timeline">'+filtered.map(function(s){var job=slotJob(c,s),cap=slotCapability(s,job),groupNote=(s.taskKind||job?.kind)==='group'?slotGroupNote(s):'',talking=s.state==='current'&&c.life.scene?.conversation,state=talking?'正在聊天（实际）':({current:'原定此时',upcoming:'打算接着',past:'先前计划',offline:'离线睡眠'}[s.state]||'计划');return '<li class="life-slot '+(s.state==='current'?'life-now':'')+' '+(s.offline?'life-offline':'')+'"><time>'+esc(s.startClock)+'<small>'+esc(s.endClock)+'</small></time><span class="timeline-dot"></span><div><span class="slot-state">'+state+'</span>'+(cap?' <span class="tag">'+esc(cap)+'</span>':'')+'<h3>'+esc(talking?c.life.scene.activity:s.activity)+'</h3>'+(talking?'<p>原计划：'+esc(s.activity)+'（暂缓）</p>':'')+(s.goal&&!s.offline?'<p>'+esc(s.goal)+'</p>':'')+(groupNote?'<p class="muted">'+esc(groupNote)+'</p>':'')+'<p class="slot-real">真实状态：'+esc(slotRealState(c,s))+'</p></div></li>';}).join('')+'</ol>';}
  function lifeExecutionDetails(c){
    var jobs=(c.life.jobs||[]).filter(function(j){return j.status!=='planned'&&j.kind!=='sleep';}).slice(0,6),talks=(c.v.today?.conversations||[]).filter(function(r){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(r.startedAt))===c.v.today?.day;}).slice(-4);
    var clock=function(at){return at?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at)):'—';};
    var labels={started:'正在执行',confirmed:'本步骤已核实',failed:'执行失败',not_applied:'确定未执行',unknown:'结果待核对'},effects={read:'读取与观察',local:'本地操作',send:'发送',publish:'发布',comment:'评论',input:'输入',gesture:'界面操作'};
    var out='<details class="life-execution-details" style="min-width:0;overflow-wrap:anywhere"><summary>实际活动与步骤</summary><p class="muted">聊天按真实收信与发送记录更新，不额外调用模型；原计划保留，尚未完成的事不会被写成做完。</p>';
    if(talks.length)out+='<details open><summary>最近的实际聊天</summary>'+talks.map(function(r){return '<p><b>'+esc(clock(r.startedAt))+'～'+esc(clock(r.lastAt))+'</b> · '+esc(r.key.startsWith('group:')?'群聊':'私聊')+(r.topic?' · '+esc(r.topic):'')+'<br><span class="muted">'+esc(r.status==='sent'?'QQ 已接收回复，未代表对方已读':'消息已收到，未确认回复送达')+'</span></p>';}).join('')+'</details>';
    out+=jobs.map(function(j){var d=j.details||{},cp=d.checkpoint||j.checkpoint;return '<details><summary>'+esc(j.scene?.activity||'日程任务')+' · '+esc(LIFE_JOB_LABELS[j.status]||j.status)+'</summary><p>目标：'+esc(d.goal||j.scene?.goal||'未填写')+'</p><p>'+esc(d.note||j.note||d.reason||j.reason||'尚无新结果')+'</p>'+(cp?'<p>已保存进度：'+esc(cp.summary||'未填写')+'<br>下一步：'+esc(cp.next||'等待明确下一步')+'</p>':'')+'<p class="muted">最近 8 个实际步骤</p><ol>'+(d.steps||[]).map(function(step){return '<li><b>'+esc(clock(step.at))+' · '+esc(labels[step.status]||step.status)+'</b> · '+esc(INVOCATION_TOOL_LABELS[step.tool]||effects[step.effect]||step.tool||step.effect)+'<p>'+esc(step.target||'未提供具体目标')+(step.coverage?'<br>'+esc(step.coverage):'')+(step.serviceTask?'<br>原服务任务：'+esc(step.serviceTask.taskId)+' · '+esc(step.serviceTask.status):'')+(step.error?'<br>'+esc(step.error):'')+'</p></li>';}).join('')+'</ol><p class="muted">'+esc(d.dispatchCount||0)+' 次启动或续做；最近启动 '+esc(clock(d.lastDispatchAt))+(d.nextDispatchAt?'；最早下次检查 '+esc(clock(d.nextDispatchAt)):'')+'</p></details>';}).join('');return out+'</details>';
  }
  function homeWalletRows(accounts){
    return (accounts||[]).map(function(a){var amount=walletAmountText(a);return '<div class="row"><span><b>'+esc(a.label)+'</b>'+(a.stale?' <span class="tag">旧数据</span>':'')+(a.provider==='runninghub'?'<small class="muted" style="display:block">'+esc(a.reason||'积分与钱包分别展示；数据来自账户接口')+'</small>':'')+'</span><span>'+esc(amount)+' <span class="tag">'+esc(walletStateText(a))+'</span></span></div>';}).join('');
  }
  function homeWalletCard(c){
    var rows=homeWalletRows(featureData?.wallet?.accounts||[]);
    return '<section class="card" id="homeWallet"><div class="section-heading"><h2>口粮与今日花费</h2><div class="btnrow"><button class="small" id="homeWalletSettings">余额设置</button><button class="small" id="homeSpendRefresh">刷新</button></div></div><div id="homeWalletRows">'+(rows||'<p class="muted">余额尚未查询，可在“余额感知”里刷新。</p>')+'</div><div id="homeSpend" data-scope="'+esc(homeSpendScope())+'" class="muted" role="status">正在统计今日花费…</div><label class="check-field"><input type="checkbox" id="homeLifeExecute"'+(c.life.config?.execute!==false?' checked':'')+'>真实执行日程内容</label><p class="muted">关闭后保留日程计划，只暂停日程驱动的工具操作；你在聊天里明确提出的请求仍会执行。</p></section>';
  }
  function updateHeroClock(){
    var clock=$('heroClock');if(!clock)return;
    var value=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
    if(clock.textContent!==value)clock.textContent=value;
  }
  var lastHomeSpendAt = 0;
  /* 首页只换数字：余额、花费、时间，不重建整页。 */
  function updateHomeNumbers(){
    var box=$('homeWalletRows');
    if(box){var html=homeWalletRows(featureData?.wallet?.accounts||[])||'<p class="muted">余额尚未查询，可在“余额感知”里刷新。</p>';if(box.innerHTML!==html)box.innerHTML=html;}
    updateHeroClock();
    if($('homeSpend')&&Date.now()-lastHomeSpendAt>15000){lastHomeSpendAt=Date.now();void loadHomeSpend();}
  }
  function homeSpendScope(){return JSON.stringify([data?.settings?.activeAccountId||'',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())]);}
  async function loadHomeSpend(){
    if(!$('homeSpend'))return;
    var scope=homeSpendScope();
    function paint(markup){var box=$('homeSpend');if(!box||box.dataset.scope!==scope||scope!==homeSpendScope()||box._spendMarkup===markup)return;var view=capturePanelView(box);box.innerHTML=markup;box._spendMarkup=markup;restorePanelView(box,view);}
    try{
      var value=await api('GET','/im-bridge/invocations?backend=&kind=');
      var spend=value.spend||{};
      if(!spend.day){paint('今日花费统计要等插件重载后生效（重启一次 App 即可）');return;}
      var requestCosts=(spend.requests||[]).filter(function(r){return r.calls>0;}).slice(0,12).map(function(r){return '<p>'+esc((r.purposes||[]).join('、')||'模型调用')+' · '+esc(Number(r.cost||0).toFixed(5))+' 元<br><small>'+esc(r.chat||'后台')+' · '+Number(r.calls||0)+' 次调用 · '+esc(String(r.id||'').slice(-8))+'</small></p>';}).join('');
      paint('今日模型花费 '+esc(spend.totalText||'0 元')+'<br>聊天与日程执行 '+esc(spend.chatText||'0 元')+' · 辅助分析 '+esc(spend.toolText||'0 元')+'<br><span class="muted">按插件单价估算，图片、语音、视频的服务费及积分另计，以服务商账单为准。历史辅助费用仅能补计仍保留的记录。</span>'+(requestCosts?'<details><summary>按请求查看近期明细</summary>'+requestCosts+'</details>':''));
    }catch(error){paint('今日花费暂时读不到：'+esc(error.message));}
  }
  function homeLauncherCard(){
    return '<section class="card" id="homeLauncher"><div class="section-heading"><h2>QQ 桥接悬浮条</h2></div><p class="muted">网页上那个“QQ 桥接”小条，现在固定在页面上，关不掉。按住可以拖动换位置，位置会自动记住；点下面的按钮回到默认位置。</p><div class="btnrow"><button class="primary" id="homeLauncherRestore">回到默认位置</button></div><p class="muted" id="homeLauncherState" role="status"></p></section>';
  }
  function companionHome(){var c=currentCompanion(),days=c.v.diary?.days||[],last=days.at(-1),waiting=(c.v.decisions?.pending||[]).length+(c.life.waiting||[]).filter(j=>!j.question?.details?.operationDecisionId).length;companionPanelToolbar();var tiles=[['daily','clock','今天的安排','看看她正在做什么'],['diary','book','翻开小日记','一天，记住一两件事'],['star','spark','关系星图','谁来过，聊过什么'],['study','bulb','她学到了什么','看实际使用与反馈'],['songs','audio','听她唱歌','RunningHub 唱歌与翻唱'],['connection','link','账号与设备','连接、登录、桌面操作']];return '<div class="home-focus">'+companionHero()+homeWalletCard(c)+'</div>'+(waiting?'<button class="waiting-banner" data-go="daily">有 '+waiting+' 件事等你决定 <span>去看看 →</span></button>':'')+'<div class="companion-grid">'+tiles.map(t=>'<button class="quick-tile" data-go="'+t[0]+'"><span class="tile-icon">'+icon(t[1])+'</span><b>'+t[2]+'</b><small>'+t[3]+'</small><span class="tile-arrow">↗</span></button>').join('')+'</div><div class="companion-columns"><section class="card"><div class="section-heading"><h2>接下来的小事</h2><button class="ghost small" data-go="daily">完整日程 →</button></div>'+compactTimeline(3)+'</section><section class="card diary-peek"><span class="life-eyebrow">最近的一页</span><h2>'+esc(last?.day||'还没有日记')+'</h2><p class="diary-preview">'+esc(last?.text||'等生活里有了值得记下的小事，就写在这里。')+'</p><button class="ghost" data-go="diary">翻开日记 →</button></section></div><details class="card advanced-home"><summary>连接状态与高级管理</summary>'+homeLauncherCard()+viewOverview()+'</details>';}
  function companionMediaHistory(v){var names={pending:'准备中',waiting_service:'服务忙，稍后再试',generated:'已生成',queued:'等QQ确认',sent:'QQ已接收',failed:'未完成',unknown:'需要核对',confirmed:'已确认'};return '<div class="media-history">'+(v.mediaTasks||[]).slice(-8).reverse().map(t=>'<p>'+esc(t.kind==='image'?'图片':'语音')+' · '+esc(names[t.status]||t.status)+'</p>').join('')+(v.actions||[]).slice(-8).reverse().map(a=>'<p>'+esc(a.action||a.tool||'设备操作')+' · '+esc(names[a.status]||a.status||'待核对')+'</p>').join('')+(!(v.mediaTasks||[]).length&&!(v.actions||[]).length?'<p class="muted">暂无新的操作记录。</p>':'')+'</div>';}
  function scheduleLocator(){var c=currentCompanion(),today=c.v.today||{},slot=(today.slots||[]).find(s=>s.state==='current'),scene=c.life.scene,clock=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()),label=c.sleep?'正在睡眠':scene&&!scene.planned?scene.activity:slot?'原定：'+slot.activity:'正在安排';return '<aside class="schedule-locator" id="scheduleLocator" aria-label="当前日程定位"><span>现在 · '+esc(clock)+'</span><b>'+esc(label||'暂无当前活动')+'</b><button type="button" id="scheduleLocateNow">当前时段 ↑</button></aside>';}
  function rebuiltDaily(){var c=currentCompanion(),v=c.v,decisions=v.decisions?.pending||[],waiting=c.life.waiting||[],recoverable=c.life.recoverable||[];var out=scheduleLocator()+companionHero()+companionPanelToolbar()+'<section class="card schedule-content"><div class="section-heading"><div><h2>今天的安排</h2><label class="check-field"><input id="cpActualTasks" type="checkbox"'+(c.life.config?.execute!==false?' checked':'')+'>执行实际任务</label><p class="muted">关闭后保留日程计划，暂停日程驱动的工具操作；你在聊天中明确提出的请求仍可执行。只有核对到真实结果才记为完成。</p><p class="muted">这里是她自己写的打算。日常安排留在时间线上，有真实结果的活动可展开看步骤。</p></div><button id="cpSchedule">刷新日程</button></div>'+compactTimeline()+lifeExecutionDetails(c)+'<div class="btnrow"><button id="cpRest">让她休息</button></div></section>';if(decisions.length||waiting.length){out+='<section class="card decision-card"><h2>这笔付款想听你的意见</h2>';decisions.forEach(d=>out+='<article class="decision-item"><p>'+esc(d.question||'这件事需要你确认')+'</p><details><summary>具体操作和内容</summary><pre>'+esc(JSON.stringify(d.operation,null,2))+'</pre></details><div class="btnrow"><button class="primary" data-cp-decision="'+esc(d.id)+'" data-cp-answer="同意">允许这一次</button><button data-cp-decision="'+esc(d.id)+'" data-cp-answer="拒绝">先不要</button></div></article>');waiting.filter(j=>!j.question?.details?.operationDecisionId).forEach(j=>out+='<article class="decision-item"><p>'+esc(j.question?.question||'待决定事项')+'</p><button data-cp-life-q="'+esc(j.question.id)+'" data-cp-answer="同意">同意</button><button data-cp-life-q="'+esc(j.question.id)+'" data-cp-answer="拒绝">暂不</button></article>');out+='</section>';}if(recoverable.length)out+='<section class="card"><h2>还留着的进度</h2>'+recoverable.map(j=>'<article class="decision-item"><b>'+esc(j.activity||'未完的小事')+'</b><p>'+esc(j.checkpoint?.summary||j.reason||'恢复前先核对当前状态')+'</p><button data-cp-resume="'+esc(j.id)+'">继续这件事</button></article>').join('')+'</section>';return out+'<details class="card"><summary>图片、语音与操作记录</summary>'+companionMediaHistory(v)+'</details>';}
  function diaryDate(day,index){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day);if(!match)return '<time class="diary-date">'+esc(day)+'</time>';return '<time class="diary-date" datetime="'+esc(day)+'"><b>'+match[3]+'</b><span>'+match[1]+'.'+match[2]+'</span><small>第 '+String(index+1).padStart(2,'0')+' 页</small></time>';}
  var diaryPage=-1;
  function journalWhale(kind){
    return '<svg class="journal-whale" viewBox="0 0 140 95" fill="none" aria-hidden="true"><path d="M20 52C15 29 36 20 63 23c18 2 27 12 32 26 12 1 20-5 26-16 4 18 0 29-14 34-18 9-46 11-67 2C28 65 23 60 20 52Z" fill="#e6f2ff" stroke="currentColor" stroke-width="2.5"/><path d="M26 55c21 12 43 14 66 8" stroke="#adc9e5" stroke-width="2"/><path d="M57 57q13 13 22 3" fill="#d3e7fa" stroke="currentColor" stroke-width="2"/><circle cx="42" cy="43" r="2.8" fill="#566b8a"/><path d="M49 50q5 4 9-1" stroke="#647d9b" stroke-width="2" stroke-linecap="round"/><ellipse cx="35" cy="51" rx="6" ry="3" fill="#f0ced2"/><path d="M62 16v-7m0 6q-8-10-11-3m11 3q5-12 10-7" stroke="#9fc2e5" stroke-width="2.5" stroke-linecap="round"/><path d="m14 23 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z" fill="#dcebff" stroke="#d8b576"/><path d="m110 17 1-4 2 4 4 1-4 2-2 4-1-4-4-2Z" fill="#dcebff" stroke="#d8b576"/><path d="M8 80q10-6 20 0t20 0m47 0q10-6 20 0t18-1" stroke="#afcbe6" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  function journalBow(){return '<svg class="journal-bow" viewBox="0 0 100 45" fill="none" aria-hidden="true"><path d="M43 14Q10-10 4 10q-2 18 37 17L27 42l20-12m10-16q33-24 39-4 2 18-37 17l14 15-20-12" fill="#dcecff" stroke="currentColor" stroke-width="2"/><rect x="40" y="12" width="20" height="18" rx="7" fill="#eef6ff" stroke="currentColor" stroke-width="2"/></svg>';}
  function rebuiltDiary(){
    const allDays=(companionPanel.value?.diary?.days||[]).slice().sort((a,b)=>String(a.day).localeCompare(String(b.day)));
    if(!allDays.length)diaryPage=-1;
    else if(diaryPage<0||diaryPage>allDays.length-1)diaryPage=allDays.length-1;
    const d=allDays[diaryPage],sources=d&&Array.isArray(d.sourceIds)?d.sourceIds:[];
    const pager=allDays.length>1?'<div class="diary-pager"><button id="diaryPrev"'+(diaryPage<=0?' disabled':'')+'>← 上一页</button><span>'+(diaryPage+1)+' / '+allDays.length+' 页</span><button id="diaryNext"'+(diaryPage>=allDays.length-1?' disabled':'')+'>下一页 →</button></div>':'';
    let book='<section class="whale-journal" aria-label="私人手账"><header class="journal-masthead">'+journalBow()+journalWhale()+'<div><h2>私人手账</h2><p>把小小的日子，收进蓝色的海里</p></div></header>';
    if(d){
      const c=currentCompanion(),slots=c.v.today?.day===d.day?(c.v.today.slots||[]).filter(s=>!s.offline).slice(0,3):[];
      const records=slots.length?slots.map(s=>'<div class="journal-record">'+esc((s.startClock||s.start||'')+' '+s.activity)+'</div>').join(''):'<p>这一页记下的，都是有迹可循的小事。</p>';
      book+='<div class="journal-spread"><aside class="journal-aside"><section class="journal-card"><h3>这一天的小事 ♡</h3>'+records+(slots.length?'<small>来自当天日程，计划不代表已经完成</small>':'')+'</section><section class="journal-card journal-note"><h3>页边小记</h3><p>'+esc(typeof d.kaomoji==='string'&&d.kaomoji?d.kaomoji.slice(0,24):'慢慢记录，也慢慢长大。')+'</p><small>'+sources.length+' 条真实依据<br>第 '+String(diaryPage+1).padStart(2,'0')+' 页 · '+(d.finalized?'已写好':'往日摘记')+'</small></section></aside><article class="diary-sheet" aria-label="'+esc(d.day)+'的日记"><div class="journal-pageheading">'+diaryDate(d.day,diaryPage)+'<span class="journal-daymark">私人日记 ♡</span></div>'+(d.title?'<h2 class="diary-title">'+esc(d.title)+'</h2>':'')+'<p class="diary-text">'+esc(d.text||'')+'</p><div class="journal-pagefooter"><span class="journal-footer-caption">一页小日子，一点小欢喜。</span>'+journalWhale()+'</div><div class="diary-actions"><span class="muted">随心记录 · '+(d.finalized?'已写好':'往日摘记')+'</span><details><summary>'+sources.length+' 条真实依据</summary><div class="btnrow">'+sources.slice(0,30).map(id=>'<button class="small" data-cp-evidence="'+esc(id)+'">查看原文</button>').join('')+'</div></details></div><span class="diary-page-number" aria-hidden="true">— '+String(diaryPage+1).padStart(2,'0')+' —</span></article></div>';
    }else book+='<div class="journal-empty">'+journalWhale()+'<p>这一页还空着，<br>等一点值得记住的小事。</p></div>';
    return companionPanelToolbar()+pager+book+'</section><section class="card"><p class="muted">想记的时候再写，可以记今天，也可以回头记一件事；没有强制日结，不写也不会丢失聊天记忆。同一天的新经历可以另写一页，旧日记保留。</p><p class="muted">'+Number(companionPanel.value?.diary?.availableDays||0)+' 天有可供回顾的经历，不是待办任务。</p><button id="cpJournal"'+(Number(companionPanel.value?.diary?.availableDays||0)?'':' disabled')+'>让她考虑写一页</button></section>'+companionEvidenceMarkup();
  }


  var constellationMount=null;

  var constellationMount=null;
  function rebuiltStar(){
    var v=companionPanel.value||{},g=v.graph||{},relations=Array.isArray(g.relations)?g.relations:[],topics=Array.isArray(g.topTopics)?g.topTopics:[];
    var relRows=relations.length?relations.map(function(r){
      var ins=r.insight||{},when=r.lastAt?new Date(r.lastAt).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'';
      var fallback=[(r.scopes||[]).join(' · '),r.together+' 条记录',r.topics&&r.topics.length?'常聊 '+r.topics.join('、'):'',when?'最近 '+when:''].filter(Boolean).join(' · ');
      var id=(r.sourceIds||[]).slice(-1)[0]||'';
      return '<div class="relation-item"><div class="relation-head"><b>'+esc(r.label)+'</b><small>'+esc(fallback)+'</small></div>'+
        (ins.relation||ins.view?'<p class="relation-say">'+esc(ins.relation||'')+(ins.relation&&ins.view?'<br>':'')+(ins.view?'<span class="muted">'+esc(ins.view)+'</span>':'')+'</p>':'<p class="relation-say muted">还在想……第一次要花一会儿，想好会自己出现。</p>')+
        (id?'<button type="button" class="ghost small" data-cp-relation="'+esc(id)+'">看原话</button>':'')+'</div>';
    }).join(''):'<p class="muted">还没有画出关系。等有真实的对话和共同话题，这里会长出第一根线。</p>';
    var topicChips=topics.length?'<div class="relation-topics">'+topics.map(function(t){var ins=t.insight||{};return '<button type="button" class="relation-chip" title="'+esc(ins.view||'')+'" data-cp-relation="'+esc((t.sourceIds||[]).slice(-1)[0]||'')+'">'+esc(t.label)+' <span>'+Number(t.count||0)+'</span></button>'+(ins.relation?'<small class="relation-note">'+esc(ins.relation)+'</small>':'');}).join('')+'</div>':'';
    return companionPanelToolbar()+'<section class="card constellation-card"><div class="section-heading"><div><span class="life-eyebrow">我在中心，周围是我遇见的人和事</span><h2>关系星图</h2></div><div class="star-actions"><button id="cpGraphMotion" class="small" aria-pressed="false">暂停流动</button><button id="cpGraphReset" class="small">回到中心</button></div></div><div class="graph-toolbar"><label class="field">找一个人或话题<input id="cpGraphSearch" value="'+esc(companionPanel.search)+'" placeholder="人名、音乐、绘画…"></label></div><div class="graph-stage"><div id="cpGraph" aria-label="关系星图，可拖动旋转、滚轮缩放；方向键旋转，加减键缩放，Home回到中心" role="group"></div><div class="graph-legend"><span>● 人物</span><span>◆ 场合</span><span>✧ 话题</span><small>线表示真的一起出现过；越密，来往越多</small></div></div><p id="cpGraphInfo" class="muted"></p><div id="cpGraphSelection" class="graph-selection">点亮一颗星：这是我怎么看这个人、这件事。</div></section><section class="card relation-card"><div class="section-heading"><h2>关系近况</h2><small class="muted">按实际记录条数排，不猜亲密度</small></div>'+relRows+topicChips+'</section>'+companionEvidenceMarkup();
  }
  function drawRebuiltGraph(){var svg=$('cpGraph'),graph=companionPanel.value?.graph;if(!svg||!graph)return;constellationMount?.destroy();constellationMount=mountCompanionConstellation(svg,graph,{search:companionPanel.search,showEvents:false,onSelect:n=>{var kind={person:'人物',persona:'我自己',topic:'话题',group:'群聊','private-chat':'私聊'}[n.type]||'来源',ins=n.insight||{},box=$('cpGraphSelection'),id=n.sourceId||(n.sourceIds||[]).slice(-1)[0]||(graph.edges||[]).find(e=>(e.source===n.id||e.target===n.id)&&e.sourceIds?.length)?.sourceIds.slice(-1)[0];if(!box)return;box.innerHTML='<b>'+esc(n.label)+'</b><span class="selection-kind">'+esc(kind)+(n.count?' · 出现 '+Number(n.count)+' 次':'')+'</span>'+(ins.relation?'<p>'+esc(ins.relation)+'</p>':'')+(ins.view?'<p class="muted">'+esc(ins.view)+'</p>':'')+(!ins.relation&&!ins.view?'<p class="muted">'+(n.type==='persona'?'这就是我。':'还在想……过一会儿再点我看看。')+'</p>':'')+(id?'<button type="button" class="ghost small" data-selection-evidence="'+esc(id)+'">看原话</button>':'');var b=box.querySelector('[data-selection-evidence]');if(b)b.onclick=function(){openCompanionEvidence(b.getAttribute('data-selection-evidence'));};}});var people=(graph.nodes||[]).filter(function(n){return n.type==='person';}).length,topics=(graph.nodes||[]).filter(function(n){return n.type==='topic';}).length;$('cpGraphInfo').textContent='图里有 '+people+' 个人、'+topics+' 个话题，来自 '+graph.displayedSources+' 条真实记录；连线代表一起出现或提到，不代表亲密程度。';}
  function bindRebuiltCompanion(){if($('homeWalletSettings'))$('homeWalletSettings').onclick=function(){var target=$('wRhBilling');if(!target)return;for(var parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;target.scrollIntoView({block:'center',behavior:'auto'});target.focus();};if($('homeLauncherRestore')){$('homeLauncherState').textContent=(function(){try{var v=JSON.parse(localStorage.getItem('qq-bridge-launcher-v1')||'{}')||{};return '固定显示中';}catch{return '';}})();$('homeLauncherRestore').onclick=function(){try{var v={};try{v=JSON.parse(localStorage.getItem('qq-bridge-launcher-v1')||'{}')||{};}catch{}v.enabled=true;delete v.x;delete v.y;localStorage.setItem('qq-bridge-launcher-v1',JSON.stringify(v));toast('已恢复，正在刷新');location.reload();}catch(error){toast('恢复失败：'+error.message);}};}if($('homeSpendRefresh'))$('homeSpendRefresh').onclick=async function(){var btn=this;btn.disabled=true;try{await api('POST','/im-bridge/features/wallet',{});await refreshCompanionPanel();await loadHomeSpend();toast('余额与花费已刷新');}catch(e){toast(e.message);}finally{if(btn.isConnected)btn.disabled=false;}};if($('homeLifeExecute'))$('homeLifeExecute').onchange=async function(){var wanted=this.checked;this.disabled=true;try{await api('POST','/im-bridge/settings',{life:{execute:wanted}});toast(wanted?'已开启日程实际任务':'已关闭日程实际任务，计划仍保留');}catch(e){this.checked=!wanted;toast('保存未完成：'+e.message);}finally{if(this.isConnected)this.disabled=false;}};if($('homeSpend'))loadHomeSpend();if($('cpActualTasks'))$('cpActualTasks').onchange=async function(){var wanted=this.checked;this.disabled=true;try{await api('POST','/im-bridge/settings',{life:{execute:wanted}});await refreshCompanionPanel();toast(wanted?'已开启日程实际任务':'已关闭日程实际任务，计划仍保留');}catch(e){this.checked=!wanted;toast('保存未完成：'+e.message);}finally{if(this.isConnected)this.disabled=false;}};if($('scheduleLocateNow'))$('scheduleLocateNow').onclick=function(){var target=document.querySelector('.life-now')||document.querySelector('.life-timeline')||document.querySelector('.life-hero');target?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});};if($('diaryPrev'))$('diaryPrev').onclick=function(){diaryPage=Math.max(0,diaryPage-1);renderPane();};if($('diaryNext'))$('diaryNext').onclick=function(){diaryPage++;renderPane();};if($('cpSchedule'))$('cpSchedule').onclick=async function(){this.disabled=true;try{await api('POST','/im-bridge/features/companion',{key:companionPanelKey(),action:'schedule'});await refreshCompanionPanel();}catch(e){toast(e.message);}finally{this.disabled=false;}};document.querySelectorAll('[data-cp-compact]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('POST','/im-bridge/features/companion',{key:companionPanelKey(),action:'compact-journal',day:b.dataset.cpCompact});await refreshCompanionPanel();}catch(e){toast(e.message);}finally{b.disabled=false;}});if($('cpGraphReset'))$('cpGraphReset').onclick=()=>constellationMount?.resetView();if($('cpGraphMotion'))$('cpGraphMotion').onclick=function(){const paused=constellationMount?.toggleMotion();this.textContent=paused?'继续流动':'暂停流动';this.setAttribute('aria-pressed',String(!!paused));};}

  /* Beginner setup: one action per screen; secrets stay in memory only. */
  var ONBOARD_RECOMMENDATIONS={image:'https://www.runninghub.cn?inviteCode=7q4hxxql',voice:'https://breezeblue.ai/zh?code=BDD9YP'};
  var MEDIA_TUTORIALS={
    image:{name:'图片教程',provider:'RunningHub',steps:[
      {id:'image-start',title:'先打开 RunningHub',text:'这是负责生成图片的网站。先注册或登录，完成后回到这里。',detail:'下方是作者（本插件提供者）的邀请码链接：7q4hxxql。注册不等于已经开通 API；是否需要余额、会员或企业 Key，以平台当前规则为准。',site:true,next:'我已登录，下一步'},
      {id:'image-key',title:'在网站复制 API Key',text:'在 RunningHub 的个人账户或 API 页面查找“API Key”，复制你自己的密钥。',detail:'API Key 就是允许插件调用你账户的钥匙。不要把它贴进 QQ 或截图。找不到时，在站内帮助搜索“API Key”；网站菜单可能随版本调整。',site:true,next:'密钥已复制'},
      {id:'image-provider',title:'把图片服务商选为 RunningHub',text:'回到插件，只改“服务商”这一项，选 RunningHub（工作流 / AI 应用）。',detail:'选完会出现 RunningHub 专用输入框。暂时不用管模型、节点、JSON 和机型。',page:'imagegen',target:'#igProvider',instruction:'在蓝框的“服务商”下拉框中，选择 RunningHub（工作流 / AI 应用）。',next:'已经选好 RunningHub'},
      {id:'image-new',title:'默认用作者同款 Qwen2.1',text:'不用自己找工作流，先载入作者正在用的 Qwen2.1 图像编辑应用。',detail:'真实应用 ID：2102644452430008321。它是图生图，不是只写一句话就能生成的文生图。预设不含作者的密钥或参考图片；你的旧配置也会保留。点载入只是修改当前页草稿，后面还要保存。',preset:true,next:'我已选好这条 Qwen2.1 配置'},
      {id:'image-paste-key',title:'把密钥粘贴到插件',text:'把刚才复制的 RunningHub API Key，粘贴到同名的密码框。',detail:'这里只填 Key，不是注册链接，也不是应用 ID。若页面提示已保存，沿用旧 Key 时可留空。',page:'imagegen',target:'#rhKey',instruction:'在“RunningHub API Key”密码框粘贴自己的 Key。已保存且不更换时可留空。',next:'密钥已经填好'},
      {id:'image-inputs',title:'给 Qwen2.1 准备参考图',text:'这是图生图应用。先在“需要的素材与参数”里准备 image1、image2 对应的图片，按应用用途上传。',detail:'比如给图 1 的人物换上图 2 的衣服，就用人物图和衣服图。不要使用作者旧账户里的图片文件名。已有人设参考图时，插件可能代为补入对应节点；第一次建议亲自核对。尺寸先用预设的 9:16、2MP、1 张。',page:'imagegen',target:'[data-studio-upload]',instruction:'在“需要的素材与参数”上传 image1、image2 参考图。按应用用途选择自己的图片，不沿用作者的图片文件名。',next:'参考图已准备好',url:'https://www.runninghub.cn/ai-detail/2102644452430008321',site:true},
      {id:'image-save',title:'点一次保存配置库',text:'回到“工作流配置库”，点“保存配置库”，等页面提示保存成功。',detail:'保存的是 Key、当前配置和输入参数。只识别示例而不保存，聊天时可能仍用旧设置。若你另开过“用于图片”的通用 API 来源，要先核对它是否覆盖了本页选择。',page:'imagegen',target:'#rhSave',instruction:'点蓝框里的“保存配置库”，等保存成功的提示。',next:'已看到保存成功'},
      {id:'image-test',title:'手动生成第一张图',text:'参考图准备好后，在测试描述里写你想怎么修改，例如“图1人物换上图2的衣服”，再点“生成一张”。',detail:'这次会真实调用图片服务，可能扣除余额或积分。由你亲自点击；向导不会自动生成。排队或处理中先等结果，避免反复点击。看到图片后再继续。',page:'imagegen',target:'#igTestPrompt',instruction:'先确认参考图已上传，再写“图1人物换上图2的衣服”（按你的图片修改），手动点“生成一张”。可能计费，等图片结果。',next:'我已经看到生成的图片',trouble:'没有出图，怎么看？'},
      {id:'image-done',title:'图片接通了',text:'你刚才确认看到了真实生成的图片。以后可以在 QQ 里请她“画一张……”。',detail:'如果面板能出图、QQ 却没收到，先查发送记录，不要反复更换密钥。想保持角色长相，再去图片页设置人设参考图；图生图还要选支持参考图片的应用。',finish:true}
    ]},
    voice:{name:'语音教程',provider:'BreezeBlue',steps:[
      {id:'voice-start',title:'先打开 BreezeBlue',text:'这是负责把文字读成声音的网站。先注册或登录，再回这里继续。',detail:'下方是作者（本插件提供者）的推荐码链接：BDD9YP。API 和网页工作台使用同一 Breeze 账户；额度和费用按平台当前规则。先不用购买不确定的套餐。',site:true,next:'我已登录，下一步'},
      {id:'voice-key',title:'复制 Breeze 的 API Key',text:'在 BreezeBlue 开发者控制台，找到 API 密钥管理，创建或复制自己的 API Key。',detail:'网站登录密码不是 API Key。把密钥留在自己手里，下一步会告诉你填到哪里；不要发到 QQ。',site:true,next:'密钥已准备好'},
      {id:'voice-voice',title:'再准备一个音色 ID',text:'在网站选用可通过 API 使用的音色，或设计、克隆并保存一个音色，然后复制它的 Voice ID。',detail:'音色名字不是 ID。官方示例的 ID 形如 voc_…；请用自己账户里真实可用的那串，不要照抄示例。如果有音频，先在网站试听是否是你想要的声音。',site:true,next:'音色 ID 已准备好'},
      {id:'voice-engine',title:'在插件选 Breeze TTS 2',text:'打开语音页，把“语音服务”选成 Breeze TTS 2。',detail:'接入方式选“Breeze 官方 API”，不是自建服务。这项配置用于说话。',page:'voice',target:'#vEngine',instruction:'“语音服务”选 Breeze TTS 2，再在下方“接入方式”选 Breeze 官方 API。',next:'已选择 Breeze 官方 API'},
      {id:'voice-paste-key',title:'粘贴语音 API Key',text:'把 BreezeBlue 的 Key 填进 Breeze TTS 2 区域里的“API Key”框。',detail:'不要填到 MiniMax 或通用连接的密钥框。Key 已保存且不更换时可以留空；这里也不是填写推荐链接。',page:'voice',target:'#vBreezeKey',instruction:'在 Breeze TTS 2 区域的“API Key”框粘贴 BreezeBlue 密钥，不是 MiniMax 的框。',next:'密钥已经填好'},
      {id:'voice-paste-voice',title:'粘贴刚才的音色 ID',text:'把你在网站复制的 Voice ID，粘贴到“音色 ID”。',detail:'填整串真实 ID，不填音色昵称，不填网页链接。若要换声音，以后只需换成另一个自己可使用的音色 ID。',page:'voice',target:'#vBreezeVoice',instruction:'在“音色 ID”填网站复制的整串 Voice ID，例如 voc_ 开头的实际 ID，不是音色名字。',next:'音色 ID 已填好'},
      {id:'voice-defaults',title:'地址和模型按官方模式填写',text:'官方接口地址填 https://api.breeze.blue；模型填 breeze-tts-2；语言代码填 zh。',detail:'BreezeBlue 的注册网站和 API 地址不同。不要把带推荐码的首页链接填到接口地址，也不要在地址末尾手动加语音请求路径。官方当前文档的模型示例是 breeze-tts-2。',page:'voice',target:'#vBreezeBase',instruction:'官方模式：接口地址 https://api.breeze.blue；模型 breeze-tts-2；语言 zh。其余参数先保留。',next:'地址和模型已填好'},
      {id:'voice-save',title:'保存语音设置',text:'点“保存语音设置”，等页面提示保存成功。',detail:'这一步保存服务和音色，不会自动试听或发送 QQ。若曾在通用连接中点击“用于语音”，也需要核对实际语音来源，避免旧路由覆盖本页。',page:'voice',target:'#vSaveEngine',instruction:'点“保存语音设置”，等页面提示成功再继续。',next:'已看到保存成功'},
      {id:'voice-test',title:'亲自试听一句话',text:'试听方式选“说话”，输入“你好，我在这里”，再点试听按钮。',detail:'这会实际调用语音 API，可能扣除积分。只在当前页提供音频播放，不自动发送 QQ；生成音频后点播放，确认声音正确再继续。',page:'voice',target:'#vText',instruction:'输入“你好，我在这里”，试听方式选“说话”，手动点击试听。可能计费；点返回前确认已经听到声音。',next:'我已经听到声音',trouble:'没有声音，怎么看？'},
      {id:'voice-enable',title:'想让她在 QQ 发语音，再开这个',text:'在语音页把“允许她发语音”切到“已开”。',detail:'开关允许使用语音，不代表每条消息都会转成语音。之后在 QQ 对她说“请用语音说一句你好”测试；如果只想本页试听，不开也可以。',page:'voice',target:'#vToggle',instruction:'需要 QQ 语音就把“允许她发语音”切到“已开”；只试听可以保持关闭。',next:'已经设置好，或只想试听'},
      {id:'voice-done',title:'声音接通了',text:'你刚才确认已经听到真实的试听音频。现在可以回 QQ 请她用语音说句话。',detail:'试听成功和 QQ 送达是两件事。QQ 没收到时，先查消息与发送记录；想换声音，再改音色 ID 后保存。',finish:true}
    ]}
  };
  var ONBOARD_KEY='qqb-onboard-v1',ONBOARD_PROGRESS='qqb-onboard-progress-v3',ONBOARD_HIDE='qqb-onboard-hide-v1';
  var onboardingController=null;
  function showOnboarding(track){
    if(onboardingController){onboardingController.open(track);return;}
    var step='welcome',back=[],draft={apiKey:'',baseUrl:'',chatModel:'',type:'auto',models:[]},ownerDraft='',savedProfileId='',savedProfileSignature='',busy=false,closed=false,observer=null,target=null;
    try{var saved=JSON.parse(localStorage.getItem(ONBOARD_PROGRESS)||'null');if(saved&&['welcome','tutorials','login','scan','owner','brain','test','done'].concat(Object.values(MEDIA_TUTORIALS).flatMap(function(t){return t.steps.map(function(x){return x.id;});})).includes(saved.step))step=saved.step;}catch(e){}
    if(MEDIA_TUTORIALS[track])step=MEDIA_TUTORIALS[track].steps[0].id;else if(track==='menu')step='tutorials';else if(track==='chat')step='welcome';
    var before=document.activeElement,layer=document.createElement('div');layer.id='onbLayer';layer.className='onb-layer';document.body.appendChild(layer);
    function remember(){try{localStorage.setItem(ONBOARD_PROGRESS,JSON.stringify({step:step.indexOf('api-')===0?'brain':step}));}catch(e){}}
    function cleanTarget(){if(observer){observer.disconnect();observer=null;}if(target){target.classList.remove('onb-target');target=null;}document.body.classList.remove('onb-guiding');$('onbCoach')?.remove();}
    function close(){closed=true;cleanTarget();remember();layer.remove();draft.apiKey='';$('onbResume')?.remove();onboardingController=null;before?.focus();}
    function resume(){cleanTarget();$('onbResume')?.remove();layer.hidden=false;draw();}
    function open(track){rememberInput();if(track){back=[];if(MEDIA_TUTORIALS[track])step=MEDIA_TUTORIALS[track].steps[0].id;else if(track==='menu')step='tutorials';else if(track==='chat')step='welcome';}resume();}
    onboardingController={resume:resume,open:open};
    function move(next){if(busy)return;cleanTarget();back.push(step);step=next;draw();}
    function owners(){return data?.settings?.owners?.length?data.settings.owners:(data?.status?.owners||[]);}
    function connected(){return data?.status?.connected===true;}
    function message(text,isError){var box=$('onbMessage');if(box){box.textContent=text;box.dataset.error=String(!!isError);}}
    function rememberInput(){if($('onbOwnerInput'))ownerDraft=$('onbOwnerInput').value;if($('onbApiUrl'))draft.baseUrl=$('onbApiUrl').value.trim();if($('onbApiKey'))draft.apiKey=$('onbApiKey').value.trim();if($('onbApiModel'))draft.chatModel=$('onbApiModel').value.trim();if($('onbApiType'))draft.type=$('onbApiType').value;}
    async function run(task){if(busy)return;rememberInput();busy=true;layer.querySelectorAll('button').forEach(function(b){b.disabled=true;});message('正在处理，请稍等…');try{await task();}catch(e){message('这一步还没有完成。'+String(e.message||e),true);}finally{busy=false;if(!closed&&layer.isConnected){layer.querySelectorAll('button').forEach(function(b){b.disabled=false;});}}}
    function advance(next){busy=false;move(next);}
    function button(id,text,primary){return '<button type="button" id="'+id+'"'+(primary?' class="primary"':'')+'>'+esc(text)+'</button>';}
    function help(title,text){return '<details class="onb-help"><summary>'+esc(title)+'</summary><p>'+esc(text)+'</p></details>';}
    function bind(id,fn){var el=$(id);if(el)el.onclick=fn;}
    function guide(page,selector,instruction,after){
      return run(async function(){
        if(!data)throw Error('页面资料还在加载，稍等几秒后再点一次。');
        layer.hidden=true;
        try{await navigate(page);}catch(error){layer.hidden=false;throw error;}
        if(closed)return;
        if(typeof tab!=='undefined'&&tab!==page){layer.hidden=false;message('还没有切换页面。先处理未保存的设置，再点一次定位按钮。');return;}
        cleanTarget();document.body.classList.add('onb-guiding');
        var coach=document.createElement('section');coach.id='onbCoach';coach.className='onb-coach';coach.setAttribute('aria-label','当前操作提示');
        coach.innerHTML='<div><b>现在只做这一件事</b><p id="onbCoachText"></p></div><div class="onb-coach-actions">'+button('onbLocate','定位按钮')+button('onbReturn','做完了，继续',true)+button('onbCoachClose','收起向导')+'</div>';
        document.body.appendChild(coach);$('onbCoachText').textContent=instruction;
        function mark(scroll){var found=document.querySelector(selector);if(found!==target){if(target)target.classList.remove('onb-target');target=found;if(target)target.classList.add('onb-target');}if(scroll&&target){for(var d=target.parentElement;d;d=d.parentElement)if(d.tagName==='DETAILS')d.open=true;target.scrollIntoView({block:'center',behavior:'auto'});}if(!target)$('onbCoachText').textContent=instruction+'（这个入口还没出现；请先等页面加载。已登录时不会再显示启动按钮。）';else $('onbCoachText').textContent=instruction;}
        mark(true);observer=new MutationObserver(function(){mark(false);});if($('pane'))observer.observe($('pane'),{childList:true,subtree:true});
        $('onbLocate').onclick=function(){mark(true);};
        $('onbReturn').onclick=function(){cleanTarget();layer.hidden=false;if(after){back.push(step);step=after;}draw();};
        $('onbCoachClose').onclick=close;
      });
    }
    function draw(){
      if(closed)return;remember();var title='',intro='',body='',actions='',stage=1;
      var mediaKind=step.indexOf('image-')===0?'image':step.indexOf('voice-')===0?'voice':'',media=MEDIA_TUTORIALS[mediaKind],mediaIndex=media?media.steps.findIndex(function(x){return x.id===step;}):-1,mediaStep=media?.steps[mediaIndex];
      if(mediaStep){
        title=mediaStep.title;intro=mediaStep.text;
        body='<p class="onb-example">'+esc(mediaStep.detail)+'</p>';
        if(mediaStep.preset)actions+=button('onbMediaPreset','载入作者同款 Qwen2.1',true);
        if(mediaStep.site)body+='<a class="button-link onb-site-link" href="'+esc(mediaStep.url||ONBOARD_RECOMMENDATIONS[mediaKind])+'" target="_blank" rel="noopener noreferrer">打开 '+esc(media.provider)+(mediaStep.url?' 同款应用':'（作者邀请码链接）')+' ↗</a><p class="onb-note">'+(mediaStep.url?'这是应用详情页，不是注册邀请码。':mediaKind==='image'?'作者邀请码：7q4hxxql。':'作者推荐码：BDD9YP。')+'从网站返回插件后，向导仍在当前步骤。</p>';
        if(mediaStep.finish){body+='<p class="onb-note">仅按你刚才确认的结果结束教程，不自动替你试生成或发送 QQ。</p>';actions=button('onbMediaFinish','这项配好了，返回教程目录',true);}
        else{if(mediaStep.page)actions+=button('onbMediaGo','带我找到要操作的位置',true);actions+=button('onbMediaNext',mediaStep.next||'我做好了，下一步',!mediaStep.page);if(mediaStep.trouble)body+=help(mediaStep.trouble,mediaKind==='image'?'先看图片页生成按钮下方的错误。密钥无效：重新复制 Key；余额或 API 权限不足：到平台核对；输入缺失：重新识别该应用的完整请求示例并补素材。还在排队不要重复提交。':'先看试听按钮下方的错误。鉴权失败就核对 Breeze Key；找不到音色就核对自己账户里的 Voice ID；余额不足去平台核对。已生成音频但没声，先点播放器的播放按钮并检查媒体音量。');}
      }else if(step==='tutorials'){
        title='你现在想配什么？';intro='选一项，从第一步开始。图片和语音都是可选项，不用一次全部配置。';
        body='<div class="onb-example">文字聊天：先让她回复一句话<br>图片：推荐 RunningHub<br>语音：推荐 BreezeBlue</div><p class="onb-note">图片和语音的真实试用可能按平台规则计费；向导只定位按钮，不自动替你扣费或发消息。</p>';
        actions=button('onbChooseChat','① 先配 QQ 文字聊天',true)+button('onbChooseImage','② 配图片 · RunningHub')+button('onbChooseVoice','③ 配语音 · BreezeBlue')+button('onbChooseCharacter','④ 查看现有人设（不修改）');
      }else if(step==='welcome'){
        title='先让她回你一句话';intro='不用先学会所有设置。只做三件事：登录她的 QQ、告诉她你是谁、试着聊天。';
        body='<div class="onb-account-example"><span>你平时用的 QQ<br><b>你来发消息</b></span><span aria-hidden="true">↔</span><span>给她用的另一个 QQ<br><b>她来回消息</b></span></div><p>建议准备两个 QQ 账号。接下来登录的是<b>给她用的那个</b>，不是把你平时聊天的账号交给她。</p>'+help('只有一个 QQ 账号怎么办？','先准备另一个账号再继续，或先退出向导。向导不会替你注册账号。人设、声音和图片等收到回复后再设置。');actions=button('onbBegin','准备好了，开始配文字聊天',true)+button('onbChooseImage','我想配图片 · RunningHub')+button('onbChooseVoice','我想配语音 · BreezeBlue');
      }else if(step==='login'){
        title=connected()?'她的 QQ 已经连上了':'先登录「她的 QQ」';intro=connected()?'这一项已经有结果，不需要再扫一次码。':'点下面的蓝色按钮，我会带你找到登录按钮，并用蓝框标出来。';
        body=connected()?'<p class="onb-status">✓ 插件报告 QQ 桥接已连接。下一步填写你自己的 QQ 号。</p>':'<p class="onb-example">到了页面，只点：<b>启动 NapCat / 扫码登录</b><br><small>NapCat 是帮她收发 QQ 消息的程序，不需要先弄懂它。</small></p>'+help('提示需要重开 DSH，怎么办？','连接页若明确提示后端版本较旧，先保存其他工作，再按页面提示重开 DSH。向导会保留步骤。不要反复点重启。');
        actions=connected()?button('onbToOwner','已经连接，下一步',true):button('onbStartLogin','带我找到登录按钮',true)+button('onbReadConnection','我已经登录，检查一下');
      }else if(step==='scan'){
        title='用「她的 QQ」确认登录';intro='二维码出现后，用你打算给她使用的账号扫码，并在 QQ 里确认登录。';
        body='<p class="onb-example">二维码就在这台手机上？<br><b>先保存二维码或截图 → 打开 QQ → 扫一扫 → 相册 → 选那张图。</b></p><p>确认时看一眼账号：这次登录的是给角色用的 QQ。</p>'+help('二维码过期或扫不出来？','回到二维码页，点“换一个二维码”，再用新图扫码。页面没出现二维码时，先看登录按钮下方的提示。');
        actions=button('onbShowQr','带我看二维码',true)+button('onbScanCheck','我已扫码确认，检查连接');
      }else if(step==='owner'){
        stage=2;title='你自己的 QQ 号是多少？';intro='填你平时用来给她发消息的号码，不是刚才给她登录的号码。';
        body='<label class="field" for="onbOwnerInput">你的 QQ 号码<input id="onbOwnerInput" type="text" inputmode="numeric" autocomplete="off" placeholder="填你自己真实的 QQ 号码" value="'+esc(ownerDraft||String(owners()[0]||''))+'"></label><p class="onb-example">你 = 发消息的人　她 = 回消息的人</p><p class="onb-note">保存后，这个号码会成为号主：可以通过 QQ 指挥她使用本机工具。已有的其他号主会保留，只填你信任的账号。</p>';
        actions=button('onbSaveOwner','保存我的 QQ 号，下一步',true);
      }else if(step==='brain'){
        stage=3;title='先不折腾模型设置';intro='如果你已经能在 DSH 里和 AI 聊天，先保持插件现在的聊天配置，试一条消息就好。';
        body='<p class="onb-example"><b>推荐：先试着聊天。</b><br>不用现在填地址、密钥，也不用先选人设。</p><p class="onb-note">这只是保留现有设置，不代表聊天服务已经测试成功。下一步用真实 QQ 回复来确认。</p>'+help('“模型”和“API”是什么？','模型是负责想出回复的 AI；API 是连接它的服务。第一次不必懂这些词。只有试聊失败，或你明确想用自己的服务时，才需要填写。');
        actions=button('onbTryChat','保持现有设置，去试聊',true)+button('onbCustomApi','我有自己的 API，要在这里填写');
      }else if(step==='api-url'){
        stage=3;title='先粘贴服务地址';intro='从你购买或注册的 AI 服务商后台复制“API 地址”或“Base URL”。';
        body='<label class="field" for="onbApiUrl">服务地址<input id="onbApiUrl" type="url" autocomplete="off" placeholder="https://你的服务地址/v1" value="'+esc(draft.baseUrl)+'"></label><p class="onb-note">上面只是格式示意，不是可直接使用的地址。不要填聊天网页的网址。</p>'+help('我不知道地址在哪','打开服务商的“API 文档”或“接入说明”，找“Base URL”。如果你手里只有一个聊天网站，没有服务地址和密钥，先返回，用现有设置试聊。');actions=button('onbUrlNext','地址填好了，下一步',true);
      }else if(step==='api-key'){
        stage=3;title='再粘贴服务密钥';intro='从同一家服务商的后台创建或复制 API Key，粘贴到下面。';body='<label class="field" for="onbApiKey">API 密钥<input id="onbApiKey" type="password" autocomplete="new-password" placeholder="粘贴服务商给你的 API Key" value="'+esc(draft.apiKey)+'"></label><p class="onb-note">密钥相当于服务的钥匙，不要发到聊天或截图里。检测时会把它发往上一步填写的服务地址；本向导不会把密钥放进浏览器进度记录。</p>'+help('我用的是不需要密钥的服务','如果服务商明确写着免密钥，这里可以留空继续。普通收费 API 通常需要密钥。');actions=button('onbDetectApi','读取这家服务的模型列表',true);
      }else if(step==='api-model'){
        stage=3;title='选择负责回复的 AI';intro=draft.models.length?'点下面的输入框，从读取到的名称里选择聊天模型。':'没有读到模型列表。把服务商提供的“聊天模型名称”原样粘贴到下面。';body='<label class="field" for="onbApiModel">聊天模型名称<input id="onbApiModel" list="onbModelChoices" autocomplete="off" placeholder="从列表选择，或粘贴服务商给的模型名" value="'+esc(draft.chatModel)+'"><datalist id="onbModelChoices">'+draft.models.map(function(m){return '<option value="'+esc(m)+'"></option>';}).join('')+'</datalist></label>'+(!['openai','anthropic','responses'].includes(draft.type)?'<label class="field">这家服务用哪种接口？<select id="onbApiType"><option value="auto">未识别，请按服务商接入说明选择</option><option value="openai">服务商写着 OpenAI 兼容 / Chat Completions</option><option value="anthropic">服务商写着 Claude / Anthropic Messages</option><option value="responses">服务商写着 OpenAI Responses</option></select></label><p class="onb-note">这里没有自动识别出来。不确定时先返回，使用现有设置试聊。</p>':'')+'<p class="onb-note">现在只设置聊天，图片、视频和语音都不用填。读取模型列表不等于已经试聊成功。</p>'+help('选哪个？','优先选择服务商标注为“聊天”“Chat”或“对话”的模型。不选语音、画图、embedding 或 rerank。模型名称要和服务商提供的一致。');actions=button('onbSaveApi','保存，并让她用它聊天',true);
      }else if(step==='test'){
        stage=3;title='去 QQ 给她发一句「你好」';intro='用你平时用的 QQ，打开和她的对话，发出下面这句话。';body='<div class="onb-chat-example">你好</div><p>如果还不是好友，先添加她的 QQ 为好友。<b>请自己在 QQ 里发送</b>，向导不会代你发。</p><p class="onb-note">等她回你一条消息后，再回来点“收到回复了”。</p>';actions=button('onbChatWorked','收到回复了',true)+button('onbChatFailed','没有回复，帮我看看');
      }else if(step==='trouble'){
        stage=3;title='你现在看到哪种情况？';intro='点最接近的一项，我会带你看对应位置。';body='<div class="onb-trouble-options">'+button('onbTroubleReceive','① 消息中心里根本没有我的消息')+button('onbTroubleModel','② 收到了我的消息，但她没生成回复')+button('onbTroubleSend','③ 已经生成回复，却没有发到 QQ')+'</div><p class="onb-note">不知道是哪一种？先点下面“看看有没有收到我的消息”。</p>';actions=button('onbOpenMonitor','看看有没有收到我的消息',true)+button('onbRetryChat','返回试聊');
      }else if(step==='done'){
        stage=3;title='收到第一条回复，就入门了';intro='你刚才确认在 QQ 收到了她的回复。以后直接在 QQ 找她聊天，不用每次进控制台。';body='<p class="onb-example">接下来想玩什么再设置：<br><b>换性格 → 人设　听声音 → 语音　看安排 → 日程</b></p><p class="onb-note">不设置这些，也能继续文字聊天。以后要重看教程，点面板右上角“帮助教程”。</p>';actions=button('onbFinish','完成，回到插件首页',true);
      }
      layer.innerHTML='<section class="onb-dialog" role="dialog" aria-modal="true" aria-labelledby="onbTitle"><div class="onb-heading"><span>手把手开始</span>'+button('onbClose','稍后再弄 ×')+'</div><div class="onb-stage" aria-label="当前进度">'+(media?'<span class="onb-media-progress">'+esc(media.name)+' · '+String(mediaIndex+1)+' / '+media.steps.length+' · '+esc(media.provider)+'</span>':step==='tutorials'?'<span class="onb-media-progress">文字 · 图片 · 语音</span>':['登录她的 QQ','填你的号码','发消息试聊'].map(function(t,i){return '<span'+(i+1===stage?' aria-current="step"':'')+'>'+String(i+1)+' '+esc(t)+'</span>';}).join(''))+'</div><h2 id="onbTitle">'+esc(title)+'</h2><p>'+esc(intro)+'</p><div class="onb-step-body">'+body+'</div><p id="onbMessage" role="status" aria-live="polite"></p><div class="onb-simple-actions">'+actions+'</div><div class="onb-footer">'+(back.length?button('onbBack','← 返回上一步'):'<span></span>')+button('onbMenu','换一个教程')+button('onbNeverShow','以后不再显示')+'</div></section>';
      layer.querySelectorAll('.onb-help summary').forEach(function(el){el.textContent='？ '+el.textContent;});
      bind('onbMenu',function(){rememberInput();move('tutorials');});
      bind('onbChooseCharacter',function(){guide('persona','#basePersona','这里只查看你现有的人设与底层人格。向导沿用当前配置，不替换、不改写，也不自动保存。');});
      bind('onbChooseChat',function(){move('welcome');});bind('onbChooseImage',function(){move('image-start');});bind('onbChooseVoice',function(){move('voice-start');});
      bind('onbMediaPreset',function(){run(async function(){if(!data)throw Error('设置还在加载，请稍后再试。');layer.hidden=true;try{await navigate('imagegen');}finally{if(!closed)layer.hidden=false;}if(closed)return;if(tab!=='imagegen')throw Error('还没有进入图片页，请先处理未保存的修改。');useRecommendedQwenWorkflow();advance('image-paste-key');});});
      bind('onbMediaGo',function(){guide(mediaStep.page,mediaStep.target,mediaStep.instruction);});
      bind('onbMediaNext',function(){move(media.steps[mediaIndex+1].id);});
      bind('onbMediaFinish',function(){try{localStorage.setItem('qqb-onboard-media-'+mediaKind+'-v1','user-confirmed');}catch(e){}move('tutorials');});
      bind('onbNeverShow',function(){try{localStorage.setItem(ONBOARD_HIDE,'1');close();toast('以后不再自动显示，可从右上角“帮助教程”重新打开');}catch(e){message('未能保存，请检查浏览器存储权限',true);}});
      bind('onbClose',close);bind('onbBack',function(){rememberInput();step=back.pop()||'welcome';draw();});
      bind('onbBegin',function(){move('login');});bind('onbToOwner',function(){move('owner');});
      bind('onbStartLogin',function(){guide('connection','#btnStart','点蓝框里的“启动 NapCat / 扫码登录”。出现二维码后，点这里的“做完了，继续”。','scan');});
      bind('onbReadConnection',function(){run(async function(){var result=await load();if(result===false)throw Error('连接状态没读到，请检查页面连接后重试。');if(connected())advance('owner');else message('还没有连接。先点“带我找到登录按钮”，按提示扫码并确认。');});});
      bind('onbShowQr',function(){guide('connection','#qrBox','用给她准备的 QQ 扫码，并在 QQ 中确认。二维码过期就点“换一个二维码”。');});
      bind('onbScanCheck',function(){run(async function(){var result=await load();if(result===false)throw Error('连接状态没读到，请稍后重试。');if(connected())advance('owner');else message('还没连上。请确认已在 QQ 点过“登录/确认”，再稍等几秒重试。');});});
      bind('onbSaveOwner',function(){run(async function(){var qq=ownerDraft.trim();if(!/^[1-9]\d{4,11}$/.test(qq))throw Error('请填 5～12 位 QQ 数字号码，不是昵称或手机号。');if(String(data?.status?.selfId||login?.qq||'')===qq)throw Error('这是刚才给她登录的 QQ。这里请改填你自己用来发消息的 QQ 号。');var latest=await api('GET','/im-bridge/settings');var previous=latest.settings?.owners?.length?latest.settings.owners:(latest.status?.owners||[]);await api('POST','/im-bridge/settings',{owners:Array.from(new Set(previous.map(String).concat(qq)))});advance('brain');});});
      bind('onbTryChat',function(){move('test');});bind('onbCustomApi',function(){move('api-url');});
      bind('onbUrlNext',function(){rememberInput();try{var url=new URL(draft.baseUrl);if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw Error();move('api-key');}catch(e){message('请粘贴以 https:// 或 http:// 开头的完整服务地址。',true);}});
      bind('onbDetectApi',function(){run(async function(){var r=await api('POST','/im-bridge/service-connections',{action:'detect',baseUrl:draft.baseUrl,apiKey:draft.apiKey,type:'auto'});var det=r.detection||{};draft.type=det.type&&det.type!=='unknown'?det.type:'auto';draft.models=Array.isArray(det.models)?det.models.map(String):[];draft.chatModel='';savedProfileId='';advance('api-model');});});
      bind('onbSaveApi',function(){run(async function(){if(!draft.chatModel)throw Error('请先选一个聊天模型，或粘贴它的完整名称。');if(!['openai','anthropic','responses'].includes(draft.type))throw Error('请先按服务商说明，选择下面的接口类型。');var signature=JSON.stringify([draft.baseUrl,draft.type,draft.chatModel,draft.apiKey]);if(!savedProfileId||savedProfileSignature!==signature){var r=await api('POST','/im-bridge/service-connections',{action:'save',name:'新手向导 · '+new URL(draft.baseUrl).hostname,baseUrl:draft.baseUrl,apiKey:draft.apiKey,type:draft.type,chatModel:draft.chatModel});if(!r.profile?.id)throw Error('服务未返回保存结果，请到 API 连接页核对。');savedProfileId=r.profile.id;savedProfileSignature=signature;}await api('POST','/im-bridge/service-connections',{action:'use',id:savedProfileId,kind:'chat'});draft.apiKey='';advance('test');});});
      bind('onbChatWorked',function(){move('done');});bind('onbChatFailed',function(){move('trouble');});bind('onbRetryChat',function(){move('test');});
      bind('onbOpenMonitor',function(){guide('monitor','#pane .page-content, #pane','找你刚才发的“你好”。看不到先检查登录和你的 QQ 号码；看得到就检查聊天模型。');});
      bind('onbTroubleReceive',function(){guide('whitelist','#ownersInput','核对这里是不是你发消息的 QQ 号，不是她的账号。改动后点下面“保存”，再去 QQ 发一次。');});
      bind('onbTroubleModel',function(){guide('invocations','#pane .page-content, #pane','看最近一次调用的错误：密钥或余额问题去服务商后台处理；模型名称不对则修改聊天连接。');});
      bind('onbTroubleSend',function(){guide('delivery','#pane .page-content, #pane','查看最近发送记录的失败原因。再去账号与连接页确认 QQ 在线，避免重复发送同一条消息。');});
      bind('onbFinish',function(){try{localStorage.setItem(ONBOARD_KEY,'done');localStorage.removeItem(ONBOARD_PROGRESS);}catch(e){}step='welcome';close();try{localStorage.removeItem(ONBOARD_PROGRESS);}catch(e){}void navigate('overview');});
      layer.querySelector('.onb-dialog').scrollTop=0;$('onbClose').focus();
    }
    layer.onkeydown=function(e){if(e.key==='Escape'){if(!busy){e.preventDefault();close();}return;}if(e.key==='Tab'){var nodes=Array.from(layer.querySelectorAll('button:not(:disabled),input,summary,a[href]'));var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    draw();
  }
  function bindOnboardingReplay(){
    var el=$('replayOnboarding');if(el)el.onclick=function(){$('boxHomeHelp')?.removeAttribute('open');showOnboarding('menu');};
    document.addEventListener('click',function(e){var trigger=e.target.closest?.('[data-onb-track]');if(!trigger)return;var track=trigger.dataset.onbTrack;if(!MEDIA_TUTORIALS[track])return;$('boxHomeHelp')?.removeAttribute('open');showOnboarding(track);});
  }
  function maybeShowOnboarding(){try{if(localStorage.getItem(ONBOARD_KEY)==='done'||localStorage.getItem(ONBOARD_HIDE)==='1')return;}catch(e){return;}setTimeout(function(){if(!$('onbLayer'))showOnboarding();},600);}

  initEnhancements();
  initNavigation();
  maybeShowOnboarding();
  bindOnboardingReplay();
  applyTheme();
  setInterval(applyTheme, 2500);setInterval(function(){if(!document.hidden)void refreshDeliveryRows();},2000);
  load();
  // The panel lives in an iframe; when the plugin is updated this page would
  // otherwise keep running the old code forever. Reload once the server moves on.
  var panelVersion = '';
  setInterval(function () {
    api('GET', '/im-bridge/status').then(function (v) {
      if (panelVersion === '') panelVersion = v.version;
      else if (v.version !== panelVersion) location.reload();
    }).catch(function () {});
  }, 7000);
  setInterval(function () { void syncLiveSnapshot();if((['overview','daily'].includes(tab))&&data&&Date.now()-companionPanel.updatedAt>14000&&!companionPanel.busy&&!document.querySelector('#pane input:focus,#pane textarea:focus,#pane select:focus')&&!Object.keys(pageDrafts[tab]||{}).length)void refreshCompanionPanel(); }, 6000);
})();
