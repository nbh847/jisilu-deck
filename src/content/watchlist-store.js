// 本地自选存储层：唯一数据 bondCode/bondName/createdAt，保存在 chrome.storage.local
// 数据形态：{ 'localWatchlist': { [bondCode]: { bondName, createdAt } } }
// 经典脚本（manifest content_scripts 按序注入），通过 globalThis.jisiluDeck 暴露；无外部依赖
(function () {
  'use strict';

  const NS = (globalThis.jisiluDeck = globalThis.jisiluDeck || {});
  const STORAGE_KEY = 'localWatchlist';

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

  NS.createWatchlistStore = function (storage) {
    function getMap() {
      return new Promise((resolve, reject) => {
        storage.get(STORAGE_KEY, (items) => {
          if (chrome.runtime.lastError) {
            reject(storageError(chrome.runtime.lastError));
            return;
          }
          const map = items && typeof items[STORAGE_KEY] === 'object' && items[STORAGE_KEY] !== null
            ? items[STORAGE_KEY]
            : {};
          resolve(map);
        });
      });
    }

    function setMap(map) {
      return new Promise((resolve, reject) => {
        storage.set({ [STORAGE_KEY]: map }, () => {
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
      const map = await getMap();
      if (Object.prototype.hasOwnProperty.call(map, code)) {
        return { code, bondName: map[code].bondName, createdAt: map[code].createdAt, existed: true };
      }
      const record = { bondName, createdAt: new Date().toISOString() };
      await setMap(Object.assign({}, map, { [code]: record }));
      return { code, bondName: record.bondName, createdAt: record.createdAt, existed: false };
    }

    // 移出自选：不存在的 code 幂等成功（不动存储），存储失败才 reject
    async function remove(rawCode) {
      const code = validateCode(rawCode);
      const map = await getMap();
      if (!Object.prototype.hasOwnProperty.call(map, code)) return;
      const next = Object.assign({}, map);
      delete next[code];
      await setMap(next);
    }

    async function has(rawCode) {
      const code = validateCode(rawCode);
      const map = await getMap();
      return Object.prototype.hasOwnProperty.call(map, code);
    }

    async function list() {
      const map = await getMap();
      return Object.keys(map).map((code) => ({
        code,
        bondName: map[code].bondName,
        createdAt: map[code].createdAt,
      }));
    }

    return { add, remove, has, list };
  };
})();
