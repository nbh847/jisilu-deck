// watchlist-store 单元测试：用 node:test + vm 加载内容脚本（无构建链、零依赖）
// 运行：node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STORE_SRC = path.join(__dirname, '..', 'src', 'content', 'watchlist-store.js');

// vm 沙箱内创建的对象与宿主 realm 原型不同，deepStrictEqual 前先转成宿主纯对象
const plain = (v) => JSON.parse(JSON.stringify(v));

/**
 * 构造 mock chrome.storage.local + 已加载 store 模块的测试环境。
 * failNextGet/Set/Remove 置 true 后，下一次对应调用通过 chrome.runtime.lastError 模拟存储失败。
 */
function createHarness() {
  const data = new Map();
  const chrome = { runtime: { lastError: undefined }, storage: { local: {} } };
  const api = chrome.storage.local;

  const finish = (cb) => {
    try { cb(); } finally { chrome.runtime.lastError = undefined; }
  };
  api.failNextGet = false;
  api.failNextSet = false;
  api.get = (keys, cb) => {
    if (api.failNextGet) {
      api.failNextGet = false;
      chrome.runtime.lastError = { message: 'mock: storage get failed' };
      return finish(cb);
    }
    const out = {};
    const requested = typeof keys === 'string' ? [keys] : keys;
    for (const key of requested) {
      if (data.has(key)) out[key] = data.get(key);
    }
    finish(() => cb(out));
  };
  api.set = (items, cb) => {
    if (api.failNextSet) {
      api.failNextSet = false;
      chrome.runtime.lastError = { message: 'mock: storage set failed' };
      return finish(cb);
    }
    for (const [k, v] of Object.entries(items)) data.set(k, v);
    finish(cb);
  };

  const ctx = vm.createContext({ chrome });
  vm.runInContext(fs.readFileSync(STORE_SRC, 'utf8'), ctx, { filename: 'watchlist-store.js' });
  const store = ctx.jisiluDeck.createWatchlistStore(api);
  const qdiiStore = ctx.jisiluDeck.createQdiiWatchlistStore(api);
  return { store, qdiiStore, data, api };
}

test('add 保存新记录：写入代码、名称，createdAt 为合法 ISO 时间', async () => {
  const { store, data } = createHarness();
  const r = await store.add('123284', '示例转债');
  assert.strictEqual(r.code, '123284');
  assert.strictEqual(r.bondName, '示例转债');
  assert.strictEqual(r.existed, false);
  assert.ok(!Number.isNaN(Date.parse(r.createdAt)), 'createdAt 应为可解析的 ISO 时间');
  assert.deepStrictEqual(plain(data.get('localWatchlist'))['123284'], { bondName: '示例转债', createdAt: r.createdAt });
});

test('add 已存在 code：不覆盖旧记录并标记 existed', async () => {
  const { store, data } = createHarness();
  const first = await store.add('123284', '旧名');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await store.add('123284', '新名');
  assert.strictEqual(second.existed, true);
  assert.strictEqual(second.bondName, '旧名');
  assert.strictEqual(second.createdAt, first.createdAt);
  assert.strictEqual(data.get('localWatchlist')['123284'].bondName, '旧名');
});

test('add 拒绝非法 code：非 6 位数字', async () => {
  const { store, data } = createHarness();
  for (const bad of ['12345', '1234567', '12345a', '', 'abcdef', ' 12345']) {
    await assert.rejects(store.add(bad, '示例转债'), { code: 'JD_INVALID_INPUT' });
  }
  assert.strictEqual(data.size, 0, '不应写入任何数据');
});

test('add 拒绝空名称', async () => {
  const { store } = createHarness();
  await assert.rejects(store.add('123284', ''), { code: 'JD_INVALID_INPUT' });
  await assert.rejects(store.add('123284', '   '), { code: 'JD_INVALID_INPUT' });
});

test('add 对 code 与名称做 trim', async () => {
  const { store } = createHarness();
  const r = await store.add(' 123284 ', ' 示例转债 ');
  assert.strictEqual(r.code, '123284');
  assert.strictEqual(r.bondName, '示例转债');
});

test('remove 删除现有记录', async () => {
  const { store, data } = createHarness();
  await store.add('123284', '示例转债');
  await store.remove('123284');
  assert.strictEqual(await store.has('123284'), false);
  assert.deepStrictEqual(plain(data.get('localWatchlist')), {});
});

test('remove 不存在的 code：幂等成功且不动存储', async () => {
  const { store, data } = createHarness();
  await store.add('123284', '示例转债');
  const before = data.get('localWatchlist');
  await store.remove('999999');
  assert.deepStrictEqual(data.get('localWatchlist'), before);
});

test('has 与 list 反映当前记录', async () => {
  const { store } = createHarness();
  await store.add('123284', '甲转债');
  await store.add('113050', '乙转债');
  assert.strictEqual(await store.has('123284'), true);
  assert.strictEqual(await store.has('999999'), false);
  const list = plain(await store.list());
  assert.deepStrictEqual(list.map((r) => r.code).sort(), ['113050', '123284']);
  assert.ok(list.every((r) => r.bondName && r.createdAt));
});

test('add 存储写入失败：reject', async () => {
  const { store, api } = createHarness();
  api.failNextSet = true;
  await assert.rejects(store.add('123284', '示例转债'));
});

test('remove 存储写入失败：reject（remove 经 set 写回）', async () => {
  const { store, api } = createHarness();
  await store.add('123284', '示例转债');
  api.failNextSet = true;
  await assert.rejects(store.remove('123284'));
});

test('读取失败：has 与 list 均 reject', async () => {
  const { store, api } = createHarness();
  api.failNextGet = true;
  await assert.rejects(store.has('123284'));
  api.failNextGet = true;
  await assert.rejects(store.list());
});

test('待购只允许本地自选，加入幂等且可单独清除', async () => {
  const { store, data } = createHarness();
  await assert.rejects(store.addPending('123284'), { code: 'JD_INVALID_INPUT' });

  await store.add('123284', '示例转债');
  const first = await store.addPending('123284');
  const second = await store.addPending('123284');
  assert.strictEqual(first.existed, false);
  assert.strictEqual(second.existed, true);
  assert.strictEqual(second.createdAt, first.createdAt);
  assert.deepStrictEqual(plain(data.get('localPurchaseQueue')), {
    123284: { createdAt: first.createdAt },
  });
  assert.deepStrictEqual(plain(await store.listPending()), [{ code: '123284', createdAt: first.createdAt }]);

  await store.removePending('123284');
  assert.deepStrictEqual(plain(await store.listPending()), []);
  assert.strictEqual(await store.has('123284'), true, '清除待购不得移出本地自选');
});

test('移出本地自选在一次写入中级联清除待购', async () => {
  const { store, data } = createHarness();
  await store.add('123284', '示例转债');
  await store.addPending('123284');
  await store.remove('123284');
  assert.deepStrictEqual(plain(data.get('localWatchlist')), {});
  assert.deepStrictEqual(plain(data.get('localPurchaseQueue')), {});
});

test('级联清除写入失败时本地自选和待购均保持原状', async () => {
  const { store, data, api } = createHarness();
  await store.add('123284', '示例转债');
  await store.addPending('123284');
  const beforeWatchlist = plain(data.get('localWatchlist'));
  const beforeQueue = plain(data.get('localPurchaseQueue'));
  api.failNextSet = true;
  await assert.rejects(store.remove('123284'), { code: 'JD_STORAGE_ERROR' });
  assert.deepStrictEqual(plain(data.get('localWatchlist')), beforeWatchlist);
  assert.deepStrictEqual(plain(data.get('localPurchaseQueue')), beforeQueue);
});

test('QDII 三类允许相同代码独立保存，列表只返回指定分类', async () => {
  const { qdiiStore, data } = createHarness();
  await qdiiStore.add('europe', '520580', '欧美示例');
  await qdiiStore.add('commodity', '520580', '商品示例');
  await qdiiStore.add('asia', '520580', '亚洲示例');

  assert.deepStrictEqual(plain(await qdiiStore.list('europe')).map((item) => item.fundName), ['欧美示例']);
  assert.deepStrictEqual(plain(await qdiiStore.list('commodity')).map((item) => item.fundName), ['商品示例']);
  assert.deepStrictEqual(plain(await qdiiStore.list('asia')).map((item) => item.fundName), ['亚洲示例']);
  assert.deepStrictEqual(Object.keys(plain(data.get('localQdiiWatchlists'))).sort(), ['asia', 'commodity', 'europe']);
});

test('QDII 移出一个分类不影响其他分类的同代码记录', async () => {
  const { qdiiStore } = createHarness();
  await qdiiStore.add('europe', '520580', '欧美示例');
  await qdiiStore.add('asia', '520580', '亚洲示例');
  await qdiiStore.remove('europe', '520580');

  assert.strictEqual(await qdiiStore.has('europe', '520580'), false);
  assert.strictEqual(await qdiiStore.has('asia', '520580'), true);
});

test('QDII 拒绝未知分类、非法代码和空名称', async () => {
  const { qdiiStore, data } = createHarness();
  await assert.rejects(qdiiStore.add('unknown', '520580', '示例'), { code: 'JD_INVALID_INPUT' });
  await assert.rejects(qdiiStore.add('europe', '52058', '示例'), { code: 'JD_INVALID_INPUT' });
  await assert.rejects(qdiiStore.add('europe', '520580', '  '), { code: 'JD_INVALID_INPUT' });
  assert.strictEqual(data.has('localQdiiWatchlists'), false);
});
