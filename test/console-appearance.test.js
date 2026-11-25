import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
const bootstrap = page.match(/<script id="appearanceBootstrap">([\s\S]*?)<\/script>/)[1];

function openConsole({ storage = new Map(), dark = false, hostTheme = 'light' } = {}) {
  const changes = new Set();
  const media = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type, listener) => changes.add(listener),
    removeEventListener: (type, listener) => changes.delete(listener)
  };
  const parent = {
    document: {
      documentElement: { getAttribute: name => name === 'data-theme' ? hostTheme : null },
      body: {}
    },
    matchMedia: () => media
  };
  parent.parent = parent;
  const root = { dataset: {}, style: {} };
  const events = new Map();
  const window = {
    parent,
    matchMedia: () => media,
    dispatchEvent() {},
    addEventListener: (name, listener) => events.set(name, listener)
  };
  runInNewContext(bootstrap, {
    window,
    document: { documentElement: root },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    Event
  });
  return {
    state: root.dataset,
    appearance: window.QQBridgeAppearance,
    systemMode(value) {
      media.matches = value;
      for (const apply of changes) apply();
    },
    hide(persisted) { events.get('pagehide')({ persisted }); }
  };
}

test('auto follows OS changes even inside an iframe with the opposite host theme', () => {
  const home = openConsole({ dark: true, hostTheme: 'light' });
  assert.deepEqual(home.state, { theme: 'dark', themeMode: 'auto', accent: 'violet' });
  home.systemMode(false);
  assert.equal(home.state.theme, 'light');
  home.hide(true);
  home.systemMode(true);
  assert.equal(home.state.theme, 'dark');
  home.appearance.choose('mode', 'light');
  home.systemMode(false);
  home.systemMode(true);
  assert.equal(home.state.theme, 'light');
  home.appearance.choose('mode', 'auto');
  assert.equal(home.state.theme, 'dark');
});

test('a legacy theme survives migration, reload and independent desktop and phone choices', () => {
  const storage = new Map([['qqb-ui-theme', 'dark']]);
  const desktop = openConsole({ storage });
  assert.equal(desktop.state.themeMode, 'dark');
  desktop.appearance.setDevice('desktop');
  desktop.appearance.choose('accent', 'teal');
  desktop.appearance.choose('mode', 'light');

  const phone = openConsole({ storage });
  phone.appearance.setDevice('phone');
  assert.deepEqual(phone.state, { theme: 'dark', themeMode: 'dark', accent: 'violet' });
  phone.appearance.choose('accent', 'rose');

  for (const [device, expected] of [
    ['desktop', { theme: 'light', themeMode: 'light', accent: 'teal' }],
    ['phone', { theme: 'dark', themeMode: 'dark', accent: 'rose' }]
  ]) {
    storage.set('qqbridge-runtime-device-v1', device);
    const reopened = openConsole({ storage });
    assert.deepEqual(reopened.state, expected);
  }
});

test('choices before device detection are saved for the detected device', () => {
  const storage = new Map([['qqb-ui-theme', 'unknown']]);
  const initial = openConsole({ storage });
  assert.equal(initial.state.themeMode, 'auto');
  initial.appearance.choose('accent', 'amber');
  assert.equal(initial.appearance.choose('mode', 'unsupported'), false);
  initial.appearance.setDevice('phone');
  const reopened = openConsole({ storage });
  reopened.appearance.setDevice('phone');
  assert.deepEqual(reopened.state, { theme: 'light', themeMode: 'auto', accent: 'amber' });
});
