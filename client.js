/**
 * Client half: the settings page under 设置 → QQ 桥接.
 *
 * It deliberately renders the host-served management page in an iframe instead
 * of re-implementing it in React. Two consequences, both intended:
 *   - the UI is written once (console.html), so there is no second copy to drift;
 *   - a bug in that page can only blank its own frame, never the app shell.
 *
 * Loader contract copied from a working installed bundle: CommonJS factory,
 * `require("react")`, and `inject = ["slots"]`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-im-bridge',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const h = React.createElement;
    const inject = ['slots'];

    function Panel() {
      const [height, setHeight] = React.useState(760);
      const frame = React.useRef(null);

      React.useEffect(() => {
        const measure = () => {
          try {
            const viewport = window.visualViewport?.height || window.innerHeight || 900;
            const top = Math.max(0, frame.current?.getBoundingClientRect().top || 90);
            setHeight(Math.max(240, Math.floor(viewport - top - 16)));
          } catch {
            /* keep the default */
          }
        };
        measure();
        window.addEventListener('resize', measure);
        window.visualViewport?.addEventListener('resize', measure);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (frame.current?.parentElement) observer?.observe(frame.current.parentElement);
        return () => {window.removeEventListener('resize', measure);window.visualViewport?.removeEventListener('resize', measure);observer?.disconnect();};
      }, []);

      return h('div', { style: { width: '100%', maxWidth: '100%', minWidth: 0 } }, [
        h(
          'div',
          { key: 'hint', style: { fontSize: 12, opacity: 0.6, marginBottom: 8 } },
          'QQ、人设、记忆与媒体管理 · 支持手机与电脑切换、数据线同步。',
        ),
        h('iframe', {
          key: 'frame',
          ref: frame,
          src: '/im-bridge/console',
          title: 'QQ 桥接 · 手机与电脑',
          style: {
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            display: 'block',
            height,
            border: '1px solid rgba(128,128,128,.18)',
            borderRadius: 12,
            background: 'transparent',
          },
        }),
      ]);
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return;
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'im-bridge-mobile', order: 600, label: () => 'QQ 桥接' },
          () => h(Panel),
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
