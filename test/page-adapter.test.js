// 页面适配层回归测试：目标表格必须是当前可见的可转债表格。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ADAPTER_SRC = path.join(__dirname, '..', 'src', 'content', 'page-adapter.js');

function makeCell(matches) {
  return {
    querySelector(selector) {
      return matches.includes(selector) ? {} : null;
    },
  };
}

function makeTable({ visible, bondRow }) {
  const row = {
    children: [
      makeCell([]),
      makeCell(['a[title^="加["]']),
      makeCell(bondRow ? ['a[href^="/data/convert_bond_detail/"]'] : []),
    ],
  };
  return {
    getClientRects: () => (visible ? [{}] : []),
    querySelectorAll: () => [row],
  };
}

function loadAdapterWithDocument(document) {
  const context = vm.createContext({ document, setTimeout });
  vm.runInContext(fs.readFileSync(ADAPTER_SRC, 'utf8'), context, { filename: 'page-adapter.js' });
  return context.jisiluDeck.pageAdapter;
}

function loadAdapter(tables) {
  return loadAdapterWithDocument({
    querySelectorAll: () => tables,
  });
}

test('findMainTable 跳过封闭基金表和隐藏旧表，返回当前可见可转债表', () => {
  const fundTable = makeTable({ visible: true, bondRow: false });
  const hiddenBondTable = makeTable({ visible: false, bondRow: true });
  const visibleBondTable = makeTable({ visible: true, bondRow: true });
  const adapter = loadAdapter([fundTable, hiddenBondTable, visibleBondTable]);

  assert.strictEqual(adapter.findMainTable(), visibleBondTable);
});

test('findMainTable 在只有封闭基金表时返回 null', () => {
  const fundTable = makeTable({ visible: true, bondRow: false });
  const adapter = loadAdapter([fundTable]);

  assert.strictEqual(adapter.findMainTable(), null);
});

test('ensureFilterButton 在原站自选组之后注入独立按钮并同步状态', () => {
  let inserted = null;
  const showBlocked = { id: 'show-blocked' };
  const group = {
    textContent: '仅看自选 仅看持仓',
    nextSibling: showBlocked,
  };
  const bar = {
    querySelector: () => inserted,
    insertBefore(btn, before) {
      assert.strictEqual(before, showBlocked);
      inserted = btn;
    },
  };
  group.parentElement = bar;
  const document = {
    querySelectorAll: () => [group],
    createElement: () => ({
      style: {},
      attributes: {},
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = value; },
    }),
  };
  const adapter = loadAdapterWithDocument(document);

  const button = adapter.ensureFilterButton(false);
  assert.strictEqual(button.textContent, '仅看本地自选');
  assert.strictEqual(button.attributes['aria-pressed'], 'false');
  assert.match(button.style.cssText, /margin-left:8px/);

  assert.strictEqual(adapter.ensureFilterButton(true), button, '重复扫描应复用同一按钮');
  assert.strictEqual(button.attributes['aria-pressed'], 'true');
  assert.strictEqual(button.style.backgroundColor, '#e67e22');
  assert.strictEqual(button.style.color, '#fff');
});

test('applyLocalFilter 只保留本地自选行，关闭后恢复并维护空状态', () => {
  function row(code) {
    const classes = new Set();
    return {
      info: { code },
      classList: {
        toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  }
  const rows = [row('111111'), row('222222')];
  let empty = null;
  const container = {
    querySelector: () => empty,
    appendChild(node) { empty = node; },
  };
  const document = {
    getElementById: () => ({}),
    createElement: () => ({ style: {} }),
  };
  const adapter = loadAdapterWithDocument(document);
  adapter.dataRows = () => rows;
  adapter.readRow = (item) => item.info;
  const table = { closest: () => container, parentElement: container };

  assert.strictEqual(adapter.applyLocalFilter(table, new Set(['111111']), true), 1);
  assert.strictEqual(rows[0].classList.contains('jd-local-filter-hidden'), false);
  assert.strictEqual(rows[1].classList.contains('jd-local-filter-hidden'), true);
  assert.strictEqual(empty.hidden, true);

  assert.strictEqual(adapter.applyLocalFilter(table, new Set(), true), 0);
  assert.strictEqual(empty.hidden, false);
  assert.strictEqual(empty.textContent, '当前筛选条件下暂无本地自选');

  assert.strictEqual(adapter.applyLocalFilter(table, new Set(), false), 2);
  assert.strictEqual(rows.every((item) => !item.classList.contains('jd-local-filter-hidden')), true);
  assert.strictEqual(empty.hidden, true);
});
