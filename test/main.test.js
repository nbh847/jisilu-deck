// 主逻辑回归测试：验证 SPA 分类切换后不会继续扫描仍留在 DOM 中的旧表格。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MAIN_SRC = path.join(__dirname, '..', 'src', 'content', 'main.js');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

function createHarness(initialTable = { id: 'initial-cb-table' }, initialQdiiTables = [], initialWatchlist = [], initialPending = []) {
  let currentTable = initialTable;
  let currentQdiiTables = initialQdiiTables;
  const scannedTables = [];
  const observers = [];
  const timers = [];
  const intervals = [];
  const intervalDelays = [];
  let nextTimerId = 1;
  let now = 0;
  const listeners = {};
  const storageChangeListeners = [];
  const filterStates = [];
  const qdiiFilterStates = [];
  const watchedCodes = new Set(initialWatchlist);
  const pendingCodes = new Set(initialPending);
  const purchaseCalls = [];
  const adapterRef = {
    ensureButtonFlags: [],
    applyStateCalls: 0,
  };
  const row = { id: 'row' };
  const purchaseButton = {
    attributes: {},
    closest(selector) { return selector === 'tr' ? row : null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };

  const adapter = {
    findMainTable: () => currentTable,
    findQdiiTables: () => currentQdiiTables,
    dataRows: (table) => {
      scannedTables.push(table);
      return [row];
    },
    ensureButton: () => ({ code: '123456' }),
    ensureFilterGroup: () => ({}),
    ensurePurchaseButton: () => ({ code: '123456', name: '示例转债', btn: purchaseButton }),
    qdiiDataRows: (table) => {
      scannedTables.push(table);
      return [{ id: 'qdii-row' }];
    },
    ensureQdiiButton: (row, category) => ({ code: '520580', category }),
    ensureQdiiFilterCheckbox: () => ({}),
    applyState: () => { adapterRef.applyStateCalls += 1; },
    applyPurchaseState: () => {},
    applyLocalFilter: (table, watched, active, options) => {
      const target = table.id && table.id.startsWith('qdii') ? qdiiFilterStates : filterStates;
      target.push({ table, active, watched: [...watched], emptyText: options && options.emptyText });
    },
    markRowSynced: () => {},
    readRow: () => ({ code: '123456', name: '示例转债' }),
    readQdiiRow: () => null,
    showHint: () => {},
  };
  const chrome = {
    storage: {
      local: {},
      onChanged: { addListener: (listener) => { storageChangeListeners.push(listener); } },
    },
  };
  const document = {
    readyState: 'complete',
    body: {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
    contains: () => true,
  };

  const context = vm.createContext({
    chrome,
    document,
    console,
    Date: { now: () => now },
    clearTimeout: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    setTimeout: (callback) => {
      const id = nextTimerId++;
      timers.push({ id, callback });
      return id;
    },
    setInterval: (callback, delay) => {
      intervals.push(callback);
      intervalDelays.push(delay);
      return 1;
    },
    clearInterval: () => {},
    MutationObserver: class {
      constructor(callback) {
        observers.push(callback);
      }
      observe() {}
    },
    jisiluDeck: {
      createWatchlistStore: () => ({
        list: async () => [...watchedCodes].map((code) => ({ code })),
        listPending: async () => [...pendingCodes].map((code) => ({ code })),
        addPending: async (code) => { pendingCodes.add(code); purchaseCalls.push('add:' + code); },
        removePending: async (code) => { pendingCodes.delete(code); purchaseCalls.push('remove:' + code); },
        add: async (code) => { watchedCodes.add(code); },
        remove: async (code) => { watchedCodes.delete(code); pendingCodes.delete(code); },
      }),
      createQdiiWatchlistStore: () => ({
        list: async () => [],
        add: async () => {},
        remove: async () => {},
      }),
      pageAdapter: adapter,
    },
  });
  vm.runInContext(fs.readFileSync(MAIN_SRC, 'utf8'), context, { filename: 'main.js' });

  return {
    observers,
    scannedTables,
    filterStates,
    qdiiFilterStates,
    purchaseCalls,
    adapter() { return adapter; },
    setCurrentTable(table) {
      currentTable = table;
    },
    setCurrentQdiiTables(tables) {
      currentQdiiTables = tables;
    },
    runNextTimer() {
      assert.ok(timers.length > 0, '应存在待执行的扫描定时器');
      timers.shift().callback();
    },
    advanceTime(ms) {
      now += ms;
    },
    runReconcileInterval() {
      assert.strictEqual(intervals.length, 1, '应只启动一个持续状态对账循环');
      intervals[0]();
    },
    intervalDelay() {
      assert.strictEqual(intervalDelays.length, 1, '应只注册一个持续状态对账循环');
      return intervalDelays[0];
    },
    notifyStorageChanged() {
      assert.strictEqual(storageChangeListeners.length, 1, '应注册一个 storage.onChanged 监听');
      storageChangeListeners[0]({ localWatchlist: {} }, 'local');
    },
    clickFilter(mode) {
      const button = { getAttribute: (name) => name === 'data-jd-filter-mode' ? mode : null };
      listeners.click({
        target: {
          closest(selector) {
            if (selector === 'button.jd-local-filter') return button;
            return null;
          },
        },
        preventDefault() {},
        stopPropagation() {},
      });
    },
    clickPurchase() {
      listeners.click({
        target: {
          closest(selector) {
            if (selector === 'a.jd-purchase-btn') return purchaseButton;
            return null;
          },
        },
        preventDefault() {},
        stopPropagation() {},
      });
    },
    changeQdiiFilter(category, checked) {
      listeners.change({
        target: {
          checked,
          getAttribute(name) { return name === 'data-jd-category' ? category : null; },
          closest(selector) {
            if (selector === 'input.jd-local-filter') return this;
            return null;
          },
        },
      });
    },
  };
}

test('分类切换后重新定位当前可转债表格，不扫描仍在 DOM 中的旧表格', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.observers.length, 1);

  harness.scannedTables.length = 0;
  harness.setCurrentTable(null);
  harness.observers[0]();
  harness.runNextTimer();
  assert.deepStrictEqual(harness.scannedTables, [], '非可转债页不应继续扫描旧表格');

  const returnedTable = { id: 'returned-cb-table' };
  harness.setCurrentTable(returnedTable);
  harness.observers[0]();
  harness.runNextTimer();
  assert.deepStrictEqual(harness.scannedTables, [returnedTable], '切回后应扫描新的可转债表格');
});

test('导航与 DOM 观察事件都丢失时，持续对账应在表格出现后扫描', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));

  harness.scannedTables.length = 0;
  harness.setCurrentTable(null);
  const returnedTable = { id: 'late-cb-table' };
  harness.setCurrentTable(returnedTable);
  harness.runReconcileInterval();
  assert.deepStrictEqual(harness.scannedTables, [returnedTable]);
});

test('内容脚本从封闭基金过渡页启动时，应立即监听并等待可转债表格', async () => {
  const harness = createHarness(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.observers.length, 1, '无目标表格时也必须启动 DOM 监听');

  const returnedTable = { id: 'cb-table-after-fund-page' };
  harness.setCurrentTable(returnedTable);
  harness.runReconcileInterval();
  assert.deepStrictEqual(harness.scannedTables, [returnedTable]);
});

test('顶部双按钮互斥切换本地自选与待购筛选，并在会话中保持状态', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.filterStates.at(-1).active, false);

  harness.clickFilter('watchlist');
  assert.strictEqual(harness.filterStates.at(-1).active, true);
  assert.strictEqual(harness.filterStates.at(-1).emptyText, '当前筛选条件下暂无本地自选');
  harness.runReconcileInterval();
  assert.strictEqual(harness.filterStates.at(-1).active, true, '持续对账不得重置筛选状态');

  harness.clickFilter('pending');
  assert.strictEqual(harness.filterStates.at(-1).active, true);
  assert.strictEqual(harness.filterStates.at(-1).emptyText, '当前筛选条件下暂无待购可转债');

  harness.clickFilter('pending');
  assert.strictEqual(harness.filterStates.at(-1).active, false);
});

test('名称旁待购入口直接加入和清除待购，不影响本地自选', async () => {
  const harness = createHarness({ id: 'initial-cb-table' }, [], ['123456']);
  await new Promise((resolve) => setImmediate(resolve));

  harness.clickPurchase();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(harness.purchaseCalls, ['add:123456']);
  assert.deepStrictEqual(harness.filterStates.at(-1).watched, ['123456']);

  harness.clickPurchase();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(harness.purchaseCalls, ['add:123456', 'remove:123456']);
  assert.deepStrictEqual(harness.filterStates.at(-1).watched, ['123456'], '清除待购后本地自选仍存在');
});

test('Manifest 覆盖可转债入口和统一数据板块 SPA 过渡路径', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepStrictEqual(manifest.content_scripts[0].matches, [
    'https://www.jisilu.cn/web/data/cb/*',
    'https://www.jisilu.cn/data/*',
  ]);
});

test('QDII 欧美、商品、亚洲筛选状态分别维护且互不影响', async () => {
  const europe = { id: 'qdii-europe' };
  const commodity = { id: 'qdii-commodity' };
  const asia = { id: 'qdii-asia' };
  const harness = createHarness(null, [
    { category: 'europe', table: europe },
    { category: 'commodity', table: commodity },
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  harness.changeQdiiFilter('europe', true);
  const latestEurope = harness.qdiiFilterStates.filter((item) => item.table === europe).at(-1);
  const latestCommodity = harness.qdiiFilterStates.filter((item) => item.table === commodity).at(-1);
  assert.strictEqual(latestEurope.active, true);
  assert.strictEqual(latestCommodity.active, false);

  harness.setCurrentQdiiTables([{ category: 'asia', table: asia }]);
  harness.runReconcileInterval();
  assert.strictEqual(harness.qdiiFilterStates.filter((item) => item.table === asia).at(-1).active, false);

  harness.changeQdiiFilter('asia', true);
  harness.setCurrentQdiiTables([
    { category: 'europe', table: europe },
    { category: 'commodity', table: commodity },
  ]);
  harness.runReconcileInterval();
  assert.strictEqual(harness.qdiiFilterStates.filter((item) => item.table === europe).at(-1).active, true);
  assert.strictEqual(harness.qdiiFilterStates.filter((item) => item.table === commodity).at(-1).active, false);
});

test('SPA 对账循环间隔降到 5 秒且只启动一个', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.intervalDelay(), 5000, '持续对账间隔必须降频到 5 秒');
});

test('大量数据行分帧扫描：单轮有预算上限，通过续扫完成全部行', async () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({ id: 'row-' + index }));
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));

  let ensured = 0;
  const adapter = harness.adapter();
  adapter.dataRows = () => rows;
  adapter.ensureButton = () => {
    ensured += 1;
    harness.advanceTime(1);
    return { code: '123456' };
  };

  harness.observers[0]();
  harness.runNextTimer();
  assert.ok(ensured > 0, '首帧应至少处理一批行');
  assert.ok(ensured < 600, '单轮扫描必须在预算内截断，不得一次同步处理全部行');

  let guard = 0;
  while (ensured < 600 && guard < 1000) {
    harness.runNextTimer();
    guard += 1;
  }
  assert.strictEqual(ensured, 600, '续扫应最终覆盖全部行');
  assert.ok(guard < 1000, '续扫不得形成死循环');
});

test('存储变化会取消旧续扫并从首行重新执行全量同步', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: 'row-' + index }));
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const visited = [];
  const adapter = harness.adapter();
  adapter.dataRows = () => rows;
  adapter.ensureButton = (row) => {
    visited.push(row.id);
    harness.advanceTime(3);
    return { code: '123456' };
  };

  harness.observers[0]();
  harness.runNextTimer();
  assert.deepStrictEqual(visited, ['row-0', 'row-1', 'row-2']);

  visited.length = 0;
  harness.notifyStorageChanged();
  await new Promise((resolve) => setImmediate(resolve));
  harness.runNextTimer();
  assert.strictEqual(visited[0], 'row-0', '新存储快照必须从首行重新同步');
});

test('本地自选变化后的下一轮为全量同步，随后恢复增量快扫', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const forceFlags = [];
  const adapter = harness.adapter();
  adapter.ensureButton = (tr, forceFull) => {
    forceFlags.push(Boolean(forceFull));
    return { code: '123456' };
  };

  harness.notifyStorageChanged();
  await new Promise((resolve) => setImmediate(resolve));
  harness.runNextTimer();
  assert.strictEqual(forceFlags.at(-1), true, '本地自选变化后必须全量同步');

  harness.observers[0]();
  harness.runNextTimer();
  assert.strictEqual(forceFlags.at(-1), false, '无变化后的扫描应走增量快扫');
});
