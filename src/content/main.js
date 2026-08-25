// 主逻辑：连接存储层与页面适配层（implementation-boundaries.md §4）
// - 初始化时恢复各行本地选中状态
// - 表格重渲染（分页/排序/筛选）后补齐按钮，不重复注入
// - SPA 切换丢失 DOM 事件时，低频对账保证切回后最终恢复
// - storage.onChanged 统一重放状态：覆盖本页写入、多标签页同步与浏览器重启恢复
(function () {
  'use strict';

  const NS = globalThis.jisiluDeck;
  if (!NS || !NS.createWatchlistStore || !NS.pageAdapter) return;

  const store = NS.createWatchlistStore(chrome.storage.local);
  const adapter = NS.pageAdapter;
  let table = null;
  let watched = new Set();
  let scanTimer = 0;

  async function refreshWatched() {
    try {
      const records = await store.list();
      watched = new Set(records.map(function (r) { return r.code; }));
    } catch (e) {
      // 读取失败：按空处理（按钮全为 +）；实际点击写入失败时按钮附近会给出失败提示
      watched = new Set();
    }
  }

  function scan() {
    // SPA 分类切换可能会把旧表格留在 DOM 中；每轮都以当前可见目标表格为准。
    table = adapter.findMainTable();
    if (!table) return;
    const rows = adapter.dataRows(table);
    for (let i = 0; i < rows.length; i++) {
      const hook = adapter.ensureButton(rows[i]);
      if (hook) adapter.applyState(hook, watched.has(hook.code));
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  async function onLocalButtonClick(btn) {
    if (btn.dataset.busy) return; // 保存中：临时禁用，避免连续点击重复写入
    const tr = btn.closest('tr');
    const info = tr && adapter.readRow(tr);
    if (!info) return; // 读不到合法代码或名称：当前行不允许加入
    const adding = !watched.has(info.code);
    btn.dataset.busy = '1';
    btn.setAttribute('aria-disabled', 'true');
    try {
      if (adding) await store.add(info.code, info.name);
      else await store.remove(info.code);
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
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    onLocalButtonClick(btn);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.localWatchlist) return;
    const next = changes.localWatchlist.newValue || {};
    watched = new Set(Object.keys(next));
    scheduleScan();
  });

  async function boot() {
    // 内容脚本同时加载在可转债与 `/data/*` SPA 过渡页；无目标表格时只等待，不写 DOM。
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    // 集思录 SPA 品种切换不保证产生可观察的 DOM 事件；低频对账作为最终一致性保障。
    setInterval(scan, 1000);
    await refreshWatched();
    scan();
    if (table) console.log('[jisilu-deck] 已在可转债列表注入本地自选按钮');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
