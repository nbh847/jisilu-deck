// 主逻辑：连接存储层与页面适配层（implementation-boundaries.md §4）
// - 初始化时恢复各行本地选中状态
// - 表格重渲染（分页/排序/筛选）后补齐按钮，不重复注入
// - SPA 切换丢失 DOM 事件时，低频对账保证切回后最终恢复
// - storage.onChanged 统一重放状态：覆盖本页写入、多标签页同步与浏览器重启恢复
(function () {
  'use strict';

  const NS = globalThis.jisiluDeck;
  if (!NS || !NS.createWatchlistStore || !NS.createQdiiWatchlistStore || !NS.pageAdapter) return;

  const store = NS.createWatchlistStore(chrome.storage.local);
  const qdiiStore = NS.createQdiiWatchlistStore(chrome.storage.local);
  const adapter = NS.pageAdapter;
  let table = null;
  let watched = new Set();
  let localFilterActive = false;
  const qdiiWatched = {
    europe: new Set(),
    commodity: new Set(),
    asia: new Set(),
  };
  const qdiiFilterActive = {
    europe: false,
    commodity: false,
    asia: false,
  };
  let scanTimer = 0;

  async function refreshWatched() {
    try {
      const records = await store.list();
      watched = new Set(records.map(function (r) { return r.code; }));
    } catch (e) {
      // 读取失败：按空处理（按钮全为 +）；实际点击写入失败时按钮附近会给出失败提示
      watched = new Set();
    }
    const categories = Object.keys(qdiiWatched);
    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      try {
        const records = await qdiiStore.list(category);
        qdiiWatched[category] = new Set(records.map(function (r) { return r.code; }));
      } catch (e) {
        qdiiWatched[category] = new Set();
      }
    }
  }

  function scanCb() {
    // SPA 分类切换可能会把旧表格留在 DOM 中；每轮都以当前可见目标表格为准。
    table = adapter.findMainTable();
    if (!table) return false;
    adapter.ensureFilterButton(localFilterActive);
    const rows = adapter.dataRows(table);
    for (let i = 0; i < rows.length; i++) {
      const hook = adapter.ensureButton(rows[i]);
      if (hook) adapter.applyState(hook, watched.has(hook.code));
    }
    adapter.applyLocalFilter(table, watched, localFilterActive);
    return true;
  }

  function scanQdii() {
    const contexts = adapter.findQdiiTables();
    for (let i = 0; i < contexts.length; i++) {
      const context = contexts[i];
      const category = context.category;
      const categoryWatched = qdiiWatched[category];
      if (!categoryWatched) continue;
      adapter.ensureQdiiFilterCheckbox(context, qdiiFilterActive[category]);
      const rows = adapter.qdiiDataRows(context.table);
      for (let j = 0; j < rows.length; j++) {
        const hook = adapter.ensureQdiiButton(rows[j], category);
        if (hook) adapter.applyState(hook, categoryWatched.has(hook.code));
      }
      adapter.applyLocalFilter(
        context.table,
        categoryWatched,
        qdiiFilterActive[category],
        { kind: 'qdii', category: category }
      );
    }
    return contexts.length;
  }

  function scan() {
    return { cb: scanCb(), qdii: scanQdii() };
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  async function onLocalButtonClick(btn) {
    if (btn.dataset.busy) return; // 保存中：临时禁用，避免连续点击重复写入
    const tr = btn.closest('tr');
    const kind = btn.dataset.jdKind || 'cb';
    const category = btn.dataset.jdCategory;
    const info = tr && (kind === 'qdii'
      ? adapter.readQdiiRow(tr, category)
      : adapter.readRow(tr));
    if (!info) return; // 读不到合法代码或名称：当前行不允许加入
    const activeWatched = kind === 'qdii' ? qdiiWatched[category] : watched;
    if (!activeWatched) return;
    const adding = !activeWatched.has(info.code);
    btn.dataset.busy = '1';
    btn.setAttribute('aria-disabled', 'true');
    try {
      if (kind === 'qdii') {
        if (adding) await qdiiStore.add(category, info.code, info.name);
        else await qdiiStore.remove(category, info.code);
      } else if (adding) {
        await store.add(info.code, info.name);
      } else {
        await store.remove(info.code);
      }
      // 成功后立即刷新本页状态；storage.onChanged 负责其余标签页同步
      await refreshWatched();
      scan();
    } catch (e) {
      // 保存/删除失败：保持原状态（+ 或 -），仅局部提示（data-rules.md §2）
      adapter.showHint(btn, adding ? '加入本地自选失败' : '移出本地自选失败');
    } finally {
      delete btn.dataset.busy;
      btn.removeAttribute('aria-disabled');
    }
  }

  document.addEventListener('click', function (ev) {
    const target = ev.target;
    if (!target || !target.closest) return;
    const btn = target.closest('a.jd-local-btn');
    if (btn) {
      ev.preventDefault();
      ev.stopPropagation();
      onLocalButtonClick(btn);
      return;
    }
    const filterBtn = target.closest('button.jd-local-filter');
    if (!filterBtn) return;
    ev.preventDefault();
    ev.stopPropagation();
    localFilterActive = !localFilterActive;
    scan();
  });

  document.addEventListener('change', function (ev) {
    const target = ev.target;
    if (!target || !target.closest) return;
    const filterInput = target.closest('input.jd-local-filter');
    if (!filterInput) return;
    const category = filterInput.dataset.jdCategory;
    if (!Object.prototype.hasOwnProperty.call(qdiiFilterActive, category)) return;
    qdiiFilterActive[category] = filterInput.checked;
    scan();
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || (!changes.localWatchlist && !changes.localQdiiWatchlists)) return;
    refreshWatched().then(scheduleScan);
  });

  async function boot() {
    // 内容脚本同时加载在可转债与 `/data/*` SPA 过渡页；无目标表格时只等待，不写 DOM。
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    // 集思录 SPA 品种切换不保证产生可观察的 DOM 事件；低频对账作为最终一致性保障。
    setInterval(scan, 1000);
    await refreshWatched();
    const found = scan();
    if (found.cb || found.qdii) console.log('[jisilu-deck] 已在目标列表注入本地自选按钮');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
