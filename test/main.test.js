// 主逻辑回归测试：验证 SPA 分类切换后不会继续扫描仍留在 DOM 中的旧表格。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MAIN_SRC = path.join(__dirname, '..', 'src', 'content', 'main.js');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

function createHarness(initialTable = { id: 'initial-cb-table' }, initialQdiiTables = []) {
  let currentTable = initialTable;
  let currentQdiiTables = initialQdiiTables;
  const scannedTables = [];
  const observers = [];
  const timers = [];
  const intervals = [];
  const listeners = {};
  const filterStates = [];
  const qdiiFilterStates = [];

  const adapter = {
    findMainTable: () => currentTable,
    findQdiiTables: () => currentQdiiTables,
    dataRows: (table) => {
      scannedTables.push(table);
      return [{ id: 'row' }];
    },
    ensureButton: () => ({ code: '123456' }),
    ensureFilterButton: () => ({}),
    qdiiDataRows: (table) => {
      scannedTables.push(table);
      return [{ id: 'qdii-row' }];
    },
    ensureQdiiButton: (row, category) => ({ code: '520580', category }),
    ensureQdiiFilterCheckbox: () => ({}),
    applyState: () => {},
    applyLocalFilter: (table, watched, active) => {
      const target = table.id && table.id.startsWith('qdii') ? qdiiFilterStates : filterStates;
      target.push({ table, active, watched: [...watched] });
    },
    readRow: () => null,
    readQdiiRow: () => null,
    showHint: () => {},
  };
  const chrome = {
    storage: {
      local: {},
      onChanged: { addListener: () => {} },
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
    clearTimeout: () => {},
    setTimeout: (callback) => {
      timers.push(callback);
      return 1;
    },
    setInterval: (callback) => {
      intervals.push(callback);
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
      createWatchlistStore: () => ({ list: async () => [] }),
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
    setCurrentTable(table) {
      currentTable = table;
    },
    setCurrentQdiiTables(tables) {
      currentQdiiTables = tables;
    },
    runNextTimer() {
      assert.ok(timers.length > 0, '应存在待执行的扫描定时器');
      timers.shift()();
    },
    runReconcileInterval() {
      assert.strictEqual(intervals.length, 1, '应只启动一个持续状态对账循环');
      intervals[0]();
    },
    clickFilter() {
      listeners.click({
        target: {
          closest(selector) {
            if (selector === 'button.jd-local-filter') return {};
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
          dataset: { jdCategory: category },
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

test('顶部按钮切换本地筛选，并在同一内容脚本会话中保持状态', async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.filterStates.at(-1).active, false);

  harness.clickFilter();
  assert.strictEqual(harness.filterStates.at(-1).active, true);
  harness.runReconcileInterval();
  assert.strictEqual(harness.filterStates.at(-1).active, true, '持续对账不得重置筛选状态');

  harness.clickFilter();
  assert.strictEqual(harness.filterStates.at(-1).active, false);
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
