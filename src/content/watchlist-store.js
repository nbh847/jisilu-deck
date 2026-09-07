// 本地自选与待购状态存储层，保存在 chrome.storage.local
// 可转债：{ 'localWatchlist': { [bondCode]: { bondName, createdAt } } }
// 待购：{ 'localPurchaseQueue': { [bondCode]: { createdAt } } }，且 code 必须存在于 localWatchlist
// QDII：{ 'localQdiiWatchlists': { [category]: { [fundCode]: { fundName, createdAt } } } }
// 经典脚本（manifest content_scripts 按序注入），通过 globalThis.jisiluDeck 暴露；无外部依赖
(function () {
  'use strict';

  const NS = (globalThis.jisiluDeck = globalThis.jisiluDeck || {});
  const STORAGE_KEY = 'localWatchlist';
  const PURCHASE_QUEUE_KEY = 'localPurchaseQueue';
  const QDII_STORAGE_KEY = 'localQdiiWatchlists';
  const QDII_CATEGORIES = ['europe', 'commodity', 'asia'];

  function invalidInput(message) {
    const err = new Error(message);
    err.code = 'JD_INVALID_INPUT';
    return err;
  }

  function storageError(lastError) {
    const err = new Error((lastError && lastError.message) || 'chrome.storage 访问失败');
    err.code = 'JD_STORAGE_ERROR';
    return err;
  }

  // bondCode：6 位数字（唯一键）；bondName：非空字符串（data-rules.md §1）
  function validateCode(rawCode) {
    if (typeof rawCode !== 'string') throw invalidInput('bondCode 必须是字符串');
    const code = rawCode.trim();
    if (!/^\d{6}$/.test(code)) throw invalidInput('bondCode 必须是 6 位数字：' + rawCode);
    return code;
  }

  function validateName(rawName) {
    if (typeof rawName !== 'string') throw invalidInput('bondName 必须是字符串');
    const name = rawName.trim();
    if (!name) throw invalidInput('bondName 不能为空');
    return name;
  }

  function validateQdiiCategory(rawCategory) {
    if (QDII_CATEGORIES.indexOf(rawCategory) === -1) {
      throw invalidInput('未知 QDII 分类：' + rawCategory);
    }
    return rawCategory;
  }

  NS.createWatchlistStore = function (storage) {
    function getState() {
      return new Promise((resolve, reject) => {
        storage.get([STORAGE_KEY, PURCHASE_QUEUE_KEY], (items) => {
          if (chrome.runtime.lastError) {
            reject(storageError(chrome.runtime.lastError));
            return;
          }
          const watchlist = items && typeof items[STORAGE_KEY] === 'object' && items[STORAGE_KEY] !== null
            ? items[STORAGE_KEY]
            : {};
          const purchaseQueue = items && typeof items[PURCHASE_QUEUE_KEY] === 'object' && items[PURCHASE_QUEUE_KEY] !== null
            ? items[PURCHASE_QUEUE_KEY]
            : {};
          resolve({ watchlist, purchaseQueue });
        });
      });
    }

    function setState(items) {
      return new Promise((resolve, reject) => {
        storage.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(storageError(chrome.runtime.lastError));
            return;
          }
          resolve();
        });
      });
    }

    // 加入自选：code 已存在时不重复写入（保持原 bondName/createdAt），返回 existed 标记
    async function add(rawCode, rawName) {
      const code = validateCode(rawCode);
      const bondName = validateName(rawName);
      const map = (await getState()).watchlist;
      if (Object.prototype.hasOwnProperty.call(map, code)) {
        return { code, bondName: map[code].bondName, createdAt: map[code].createdAt, existed: true };
      }
      const record = { bondName, createdAt: new Date().toISOString() };
      await setState({ [STORAGE_KEY]: Object.assign({}, map, { [code]: record }) });
      return { code, bondName: record.bondName, createdAt: record.createdAt, existed: false };
    }

    // 移出自选时在同一次 storage.set 中级联清除待购，避免产生孤立记录。
    async function remove(rawCode) {
      const code = validateCode(rawCode);
      const state = await getState();
      const watched = Object.prototype.hasOwnProperty.call(state.watchlist, code);
      const pending = Object.prototype.hasOwnProperty.call(state.purchaseQueue, code);
      if (!watched && !pending) return;
      const nextWatchlist = Object.assign({}, state.watchlist);
      const nextPurchaseQueue = Object.assign({}, state.purchaseQueue);
      delete nextWatchlist[code];
      delete nextPurchaseQueue[code];
      await setState({
        [STORAGE_KEY]: nextWatchlist,
        [PURCHASE_QUEUE_KEY]: nextPurchaseQueue,
      });
    }

    async function has(rawCode) {
      const code = validateCode(rawCode);
      const map = (await getState()).watchlist;
      return Object.prototype.hasOwnProperty.call(map, code);
    }

    async function list() {
      const map = (await getState()).watchlist;
      return Object.keys(map).map((code) => ({
        code,
        bondName: map[code].bondName,
        createdAt: map[code].createdAt,
      }));
    }

    async function addPending(rawCode) {
      const code = validateCode(rawCode);
      const state = await getState();
      if (!Object.prototype.hasOwnProperty.call(state.watchlist, code)) {
        throw invalidInput('只有本地自选可标记为待购：' + code);
      }
      if (Object.prototype.hasOwnProperty.call(state.purchaseQueue, code)) {
        return { code, createdAt: state.purchaseQueue[code].createdAt, existed: true };
      }
      const record = { createdAt: new Date().toISOString() };
      await setState({
        [PURCHASE_QUEUE_KEY]: Object.assign({}, state.purchaseQueue, { [code]: record }),
      });
      return { code, createdAt: record.createdAt, existed: false };
    }

    async function removePending(rawCode) {
      const code = validateCode(rawCode);
      const state = await getState();
      if (!Object.prototype.hasOwnProperty.call(state.purchaseQueue, code)) return;
      const next = Object.assign({}, state.purchaseQueue);
      delete next[code];
      await setState({ [PURCHASE_QUEUE_KEY]: next });
    }

    async function listPending() {
      const state = await getState();
      return Object.keys(state.purchaseQueue)
        .filter((code) => Object.prototype.hasOwnProperty.call(state.watchlist, code))
        .map((code) => ({ code, createdAt: state.purchaseQueue[code].createdAt }));
    }

    return { add, remove, has, list, addPending, removePending, listPending };
  };

  NS.createQdiiWatchlistStore = function (storage) {
    function getRoot() {
      return new Promise((resolve, reject) => {
        storage.get(QDII_STORAGE_KEY, (items) => {
          if (chrome.runtime.lastError) {
            reject(storageError(chrome.runtime.lastError));
            return;
          }
          const root = items && typeof items[QDII_STORAGE_KEY] === 'object' && items[QDII_STORAGE_KEY] !== null
            ? items[QDII_STORAGE_KEY]
            : {};
          resolve(root);
        });
      });
    }

    function setRoot(root) {
      return new Promise((resolve, reject) => {
        storage.set({ [QDII_STORAGE_KEY]: root }, () => {
          if (chrome.runtime.lastError) {
            reject(storageError(chrome.runtime.lastError));
            return;
          }
          resolve();
        });
      });
    }

    function categoryMap(root, category) {
      const value = root[category];
      return value && typeof value === 'object' ? value : {};
    }

    async function add(rawCategory, rawCode, rawName) {
      const category = validateQdiiCategory(rawCategory);
      const code = validateCode(rawCode);
      const fundName = validateName(rawName);
      const root = await getRoot();
      const current = categoryMap(root, category);
      if (Object.prototype.hasOwnProperty.call(current, code)) {
        return {
          category,
          code,
          fundName: current[code].fundName,
          createdAt: current[code].createdAt,
          existed: true,
        };
      }
      const record = { fundName, createdAt: new Date().toISOString() };
      const nextCategory = Object.assign({}, current, { [code]: record });
      await setRoot(Object.assign({}, root, { [category]: nextCategory }));
      return { category, code, fundName, createdAt: record.createdAt, existed: false };
    }

    async function remove(rawCategory, rawCode) {
      const category = validateQdiiCategory(rawCategory);
      const code = validateCode(rawCode);
      const root = await getRoot();
      const current = categoryMap(root, category);
      if (!Object.prototype.hasOwnProperty.call(current, code)) return;
      const nextCategory = Object.assign({}, current);
      delete nextCategory[code];
      await setRoot(Object.assign({}, root, { [category]: nextCategory }));
    }

    async function has(rawCategory, rawCode) {
      const category = validateQdiiCategory(rawCategory);
      const code = validateCode(rawCode);
      const root = await getRoot();
      return Object.prototype.hasOwnProperty.call(categoryMap(root, category), code);
    }

    async function list(rawCategory) {
      const category = validateQdiiCategory(rawCategory);
      const root = await getRoot();
      const map = categoryMap(root, category);
      return Object.keys(map).map((code) => ({
        category,
        code,
        fundName: map[code].fundName,
        createdAt: map[code].createdAt,
      }));
    }

    return { add, remove, has, list };
  };
})();
