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

function loadAdapter(tables) {
  const document = {
    querySelectorAll: () => tables,
  };
  const context = vm.createContext({ document, setTimeout });
  vm.runInContext(fs.readFileSync(ADAPTER_SRC, 'utf8'), context, { filename: 'page-adapter.js' });
  return context.jisiluDeck.pageAdapter;
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
