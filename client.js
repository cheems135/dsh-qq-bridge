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

      React.useEffect(() => {
        const measure = () => {
          try {
            const viewport = window.innerHeight || 900;
            setHeight(Math.max(520, viewport - 170));
          } catch {
            /* keep the default */
          }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, []);

      return h('div', { style: { width: '100%' } }, [
        h(
          'div',
          { key: 'hint', style: { fontSize: 12, opacity: 0.6, marginBottom: 8 } },
          '管理页由插件自己提供（独立页面），登录、人设、白名单、表情包都在里面。',
        ),
        h('iframe', {
          key: 'frame',
          src: '/im-bridge/console',
          title: 'QQ 桥接管理面板',
          style: {
            width: '100%',
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
          { name: 'settings.section', id: 'im-bridge', order: 600, label: () => 'QQ 桥接' },
          () => h(Panel),
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
