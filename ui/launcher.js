(function () {
  'use strict';
  var key = 'qq-bridge-launcher-v1', state = {}, drag = null, suppressClick = false;
  try { state = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
  /* 这个入口固定显示，不提供关闭：以前关掉就找不到面板，所以只保留拖动和复位。 */
  var HIDE_MS = 0;
  if (state.enabled !== true || state.hiddenAt) {
    state.enabled = true; delete state.hiddenAt;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
  }
  function save() { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {} }
  function bounds() {
    var v = window.visualViewport;
    return { x: v ? v.offsetLeft : 0, y: v ? v.offsetTop : 0,
      w: v ? v.width : innerWidth, h: v ? v.height : innerHeight };
  }
  var host = document.getElementById('dsh-im-bridge-launcher');
  var link;
  if (host) {
    host.style.cssText = 'position:fixed;z-index:2147483000;display:flex;align-items:center;border:1px solid #ffffff40;border-radius:24px;background:#20232eee;box-shadow:0 3px 16px #0003;color:white;font:13px/1.4 system-ui;max-width:calc(100vw - 16px);box-sizing:border-box;';
    link = document.createElement('a');
    link.href = '/im-bridge/console';
    link.textContent = 'QQ 桥接';
    link.title = '点击打开，拖动移动';
    link.style.cssText = 'color:inherit;text-decoration:none;padding:12px 8px 12px 14px;min-height:44px;box-sizing:border-box;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;';
    link.style.padding = '12px 14px';
    link.title = '点击打开面板，按住拖动换位置';
    host.append(link);
    link.addEventListener('dragstart', function (e) { e.preventDefault(); });
    link.addEventListener('click', function (e) { if (suppressClick) { e.preventDefault(); suppressClick = false; } });
    link.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      suppressClick = false;
      var r = host.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      link.setPointerCapture(e.pointerId);
    });
    link.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 7) return;
      drag.moved = true; suppressClick = true;
      place(drag.left + dx, drag.top + dy, true);
    });
    function finish(e) {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved) save();
      drag = null;
    }
    link.addEventListener('pointerup', finish);
    link.addEventListener('pointercancel', finish);
    link.addEventListener('lostpointercapture', finish);
  }
  function place(x, y, remember) {
    if (!host || state.enabled === false) return;
    var b = bounds(), r = host.getBoundingClientRect();
    var maxX = Math.max(0, b.w - r.width - 16), maxY = Math.max(0, b.h - r.height - 16);
    x = Math.max(b.x + 8, Math.min(b.x + 8 + maxX, x));
    y = Math.max(b.y + 8, Math.min(b.y + 8 + maxY, y));
    host.style.left = x + 'px'; host.style.top = y + 'px';
    if (remember) { state.x = maxX ? (x - b.x - 8) / maxX : 0; state.y = maxY ? (y - b.y - 8) / maxY : 0; }
  }
  var hideTimer = null;
  function scheduleUnhide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (state.enabled !== false || !(Number(state.hiddenAt) > 0)) return;
    var left = HIDE_MS - (Date.now() - Number(state.hiddenAt));
    if (left <= 0) { state.enabled = true; delete state.hiddenAt; save(); return; }
    hideTimer = setTimeout(function () {
      state.enabled = true; delete state.hiddenAt; save(); apply();
    }, left + 50);
  }
  function apply() {
    scheduleUnhide();
    if (host) {
      host.style.display = state.enabled === false ? 'none' : 'flex';
      var b = bounds(), r = host.getBoundingClientRect();
      var x = Number.isFinite(state.x) ? Math.max(0, Math.min(1, state.x)) : 0;
      var y = Number.isFinite(state.y) ? Math.max(0, Math.min(1, state.y)) : 1;
      place(b.x + 8 + x * Math.max(0, b.w - r.width - 16), b.y + 8 + y * Math.max(0, b.h - r.height - 16), false);
    }
    document.querySelectorAll('[data-bridge-launcher-toggle]').forEach(function (input) { input.checked = state.enabled !== false; });
  }
  document.querySelectorAll('[data-bridge-launcher-toggle]').forEach(function (input) {
    input.addEventListener('change', function () { state.enabled = input.checked; if (!input.checked) state.hiddenAt = Date.now(); save(); apply(); });
  });
  document.querySelectorAll('[data-bridge-launcher-reset]').forEach(function (button) {
    button.addEventListener('click', function () { delete state.x; delete state.y; state.enabled = true; save(); apply(); });
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== key && e.key !== null) return;
    try { state = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { state = {}; }
    apply();
  });
  window.addEventListener('resize', apply);
  if (window.visualViewport) { visualViewport.addEventListener('resize', apply); visualViewport.addEventListener('scroll', apply); }
  apply();
})();
