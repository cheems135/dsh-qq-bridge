import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const controller = readFileSync(new URL('../ui/console-controller.js', import.meta.url), 'utf8');
const navigation = controller.slice(controller.indexOf('  function openNavigator('), controller.indexOf('  function renderThemeControl('));

function fixture() {
  const entries = [
    { hash: '#overview', state: { bridgePage: 0 } },
    { hash: '#model', state: { bridgePage: 1 } },
  ];
  let position = 1;
  const location = {
    get hash() { return entries[position].hash; },
    get href() { return entries[position].hash; },
  };
  const history = {
    get state() { return entries[position].state; },
    pushState(state, _, hash) { entries.splice(++position, Infinity, { state, hash }); },
    replaceState(state, _, hash) { entries[position] = { state, hash }; },
    go(delta) { position += delta; },
    back() { this.go(-1); },
  };
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const field = { value: '', focus() {} };
  const opener = { isConnected: true, focus() { this.focused = true; } };
  const ctx = vm.createContext({
    location, history, routeIndex: 1, tab: 'model', historyBusy: false, navigatorReturn: null, navigatorOpener: null,
    PAGE_HEADS: { overview: [], model: [] }, pageVisible: page => ['overview', 'model'].includes(page),
    document: { querySelector: () => null }, renderSearch() {},
    $: id => ({ workspaceNavigator: dialog, modal: { hidden: true }, navSearch: field, closeNavigator: field, openNavigator: opener })[id],
    navigate: async page => { ctx.tab = page; },
  });
  vm.runInContext(navigation, ctx);
  return { ctx, history, location, dialog, entries, field, opener };
}

test('cancelling a guarded browser back retains both page entries for the next back and forward', async () => {
  const { ctx, history, location, entries } = fixture();
  history.back();
  const accept = ctx.navigate;
  ctx.navigate = async () => {};
  await ctx.followHistory();
  assert.equal(location.hash, '#model');
  assert.deepEqual(entries.map(entry => entry.hash), ['#overview', '#model']);
  ctx.navigate = accept;
  history.back();
  await ctx.followHistory();
  assert.equal(ctx.tab, 'overview');
  assert.equal(ctx.routeIndex, 0);
  history.go(1);
  await ctx.followHistory();
  assert.equal(ctx.tab, 'model');
});

test('the page finder consumes its own back entry and can reopen on forward', async () => {
  const { ctx, history, location, dialog } = fixture();
  ctx.openNavigator(true);
  assert.equal(dialog.open, true);
  assert.equal(history.state.bridgeNavigator, true);
  const dismissed = ctx.dismissNavigator();
  await ctx.followHistory();
  await dismissed;
  assert.equal(dialog.open, false);
  assert.equal(location.hash, '#model');
  assert.equal(history.state.bridgeNavigator, undefined);
  history.go(1);
  await ctx.followHistory();
  assert.equal(dialog.open, true);
  history.back();
  await ctx.followHistory();
  assert.equal(dialog.open, false);
  assert.equal(ctx.tab, 'model');
});

test('one Escape in a nonempty search closes the finder and restores its opener', async () => {
  const { ctx, dialog, field, opener, history, location } = fixture();
  ctx.openNavigator(true, false, opener);
  field.value = 'no match';
  ctx.document.activeElement = field;
  const event = {
    key: 'Escape', target: field,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  ctx.handleNavigatorKey(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(dialog.open, false);
  assert.equal(opener.focused, true);
  await ctx.followHistory();
  assert.equal(history.state.bridgeNavigator, undefined);
  assert.equal(location.hash, '#model');
});
