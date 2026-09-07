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

test('ensureFilterGroup 在原站筛选组之后注入插件双按钮组并同步互斥状态', () => {
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
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      appendChild(child) { this.children.push(child); },
      querySelectorAll(selector) {
        if (selector === 'button.jd-local-filter') {
          return this.children.filter((child) => child.tagName === 'BUTTON' && child.className === 'jd-local-filter');
        }
        return [];
      },
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = value; },
    };
  }
  const document = {
    querySelectorAll: () => [group],
    createElement: element,
  };
  const adapter = loadAdapterWithDocument(document);

  const localGroup = adapter.ensureFilterGroup(null);
  assert.strictEqual(localGroup.children.length, 2);
  assert.deepStrictEqual(localGroup.children.map((btn) => btn.textContent), ['仅看本地自选', '仅看待购']);
  assert.deepStrictEqual(localGroup.children.map((btn) => btn.attributes['aria-pressed']), ['false', 'false']);
  assert.match(localGroup.style.cssText, /margin-left:8px/);

  assert.strictEqual(adapter.ensureFilterGroup('pending'), localGroup, '重复扫描应复用同一筛选组');
  assert.deepStrictEqual(localGroup.children.map((btn) => btn.attributes['aria-pressed']), ['false', 'true']);
  assert.strictEqual(localGroup.children[1].style.backgroundColor, '#e67e22');
  assert.strictEqual(localGroup.children[1].style.color, '#fff');
});

test('ensurePurchaseButton 只为本地自选行注入名称旁待购入口并切换状态', () => {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      attributes: {},
      parentElement: null,
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
        this.parentElement = null;
      },
    };
  }
  const nameSpan = { textContent: '示例转债', style: {} };
  const nameCell = {
    children: [nameSpan],
    querySelector(selector) {
      if (selector === 'span') return nameSpan;
      if (selector === ':scope > a.jd-purchase-btn') {
        return this.children.find((child) => child.className === 'jd-purchase-btn') || null;
      }
      return null;
    },
    insertBefore(child, before) {
      child.parentElement = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
    },
  };
  const codeCell = {
    querySelector: () => ({ textContent: '123284' }),
  };
  const row = { children: [{}, {}, codeCell, nameCell] };
  const adapter = loadAdapterWithDocument({ createElement: element });

  const hook = adapter.ensurePurchaseButton(row, true);
  adapter.applyPurchaseState(hook, false);
  assert.strictEqual(hook.btn.textContent, '+');
  assert.strictEqual(hook.btn.style.color, '#909399');
  assert.strictEqual(hook.btn.attributes['aria-pressed'], 'false');

  adapter.applyPurchaseState(hook, true);
  assert.strictEqual(hook.btn.textContent, '待购');
  assert.strictEqual(hook.btn.style.color, '#e67e22');
  assert.strictEqual(hook.btn.attributes['aria-pressed'], 'true');
  assert.strictEqual(adapter.ensurePurchaseButton(row, true).btn, hook.btn, '重复扫描不得重复注入');

  assert.strictEqual(adapter.ensurePurchaseButton(row, false), null);
  assert.strictEqual(nameCell.children.includes(hook.btn), false, '移出本地自选后应清理待购入口');
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
    createElement() {
      const node = {
        style: {},
        attributes: {},
        getAttribute(name) { return this.attributes[name] ?? null; },
        setAttribute(name, value) { this.attributes[name] = value; },
      };
      Object.defineProperty(node, 'dataset', {
        get() { throw new TypeError('dataset getter must not be used for empty-state writes'); },
      });
      return node;
    },
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

  adapter.applyLocalFilter(table, new Set(), true, { emptyText: '当前筛选条件下暂无待购可转债' });
  assert.strictEqual(empty.textContent, '当前筛选条件下暂无待购可转债');

  assert.strictEqual(adapter.applyLocalFilter(table, new Set(), false), 2);
  assert.strictEqual(rows.every((item) => !item.classList.contains('jd-local-filter-hidden')), true);
  assert.strictEqual(empty.hidden, true);
});

test('findQdiiTables 只返回当前可见目标表并映射独立分类', () => {
  const tables = {
    flex_qdiie: { id: 'flex_qdiie', getClientRects: () => [{}] },
    flex_qdiic: { id: 'flex_qdiic', getClientRects: () => [{}] },
    flex_qdiia: { id: 'flex_qdiia', getClientRects: () => [] },
  };
  const adapter = loadAdapterWithDocument({
    getElementById: (id) => tables[id] || null,
  });

  assert.deepStrictEqual(
    Array.from(adapter.findQdiiTables(), (item) => [item.category, item.table.id]),
    [['europe', 'flex_qdiie'], ['commodity', 'flex_qdiic']]
  );
});

test('QDII 站内自选重写操作格为 delOwnedQd 后重新注入本地按钮', () => {
  function makeElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      querySelector(selector) {
        if (selector === ':scope > span.jisilu-icons') {
          return this.children.find((child) => child.className === 'jisilu-icons') || null;
        }
        return null;
      },
    };
  }

  let siteAction = 'add';
  const opCell = makeElement('td');
  opCell.querySelector = function (selector) {
    if (selector.includes('addOwnedQd') && (siteAction === 'add' || selector.includes('delOwnedQd'))) {
      return { href: 'javascript:' + siteAction + 'OwnedQd()' };
    }
    if (selector.includes('a.jd-local-btn')) {
      return this.children.find((child) => child.className === 'jd-local-btn'
        && child.getAttribute('data-jd-kind') === 'qdii') || null;
    }
    return null;
  };
  const codeCell = {
    querySelector: (selector) => selector === 'a[href^="/data/qdii/detail/"]'
      ? { textContent: '513870' }
      : null,
  };
  const nameCell = { textContent: '纳指ETF富国', style: {} };
  const row = { children: [codeCell, nameCell, opCell] };
  const table = { querySelectorAll: () => [row] };
  const adapter = loadAdapterWithDocument({ createElement: makeElement });

  const first = adapter.ensureQdiiButton(row, 'europe');
  assert.ok(first, '站内加号状态应完成首次注入');

  siteAction = 'del';
  opCell.children.length = 0;

  const rows = adapter.qdiiDataRows(table);
  assert.strictEqual(rows.length, 1, '站内减号状态仍应识别为 QDII 数据行');
  assert.strictEqual(rows[0], row);
  const restored = adapter.ensureQdiiButton(row, 'europe');
  assert.ok(restored, '站内脚本重写操作格后应补回本地按钮');
  assert.strictEqual(opCell.children.length, 1);
  assert.strictEqual(restored.code, '513870');
});

test('ensureQdiiFilterCheckbox 紧邻站内仅看自选右侧并保持三类状态独立', () => {
  function makeTable() {
    let inserted = null;
    const nativeInput = {};
    const parent = {
      insertBefore(node, before) {
        assert.strictEqual(before, null);
        inserted = node;
      },
    };
    const nativeLabel = { parentElement: parent, nextSibling: null };
    nativeInput.closest = () => nativeLabel;
    return {
      table: {
        querySelector(selector) {
          if (selector === 'input[name="only_owned"]') return nativeInput;
          if (selector.includes('label.jd-local-filter-label')) return inserted;
          return null;
        },
      },
      get inserted() { return inserted; },
    };
  }

  const created = [];
  const document = {
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        attributes: {},
        children: [],
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] ?? null; },
      };
      created.push(node);
      return node;
    },
    createTextNode: (text) => ({ textContent: text }),
  };
  const adapter = loadAdapterWithDocument(document);
  const europe = makeTable();
  const asia = makeTable();

  const europeInput = adapter.ensureQdiiFilterCheckbox({ category: 'europe', table: europe.table }, true);
  const asiaInput = adapter.ensureQdiiFilterCheckbox({ category: 'asia', table: asia.table }, false);

  assert.strictEqual(europe.inserted.attributes['data-jd-category'], 'europe');
  assert.strictEqual(asia.inserted.attributes['data-jd-category'], 'asia');
  assert.strictEqual(europeInput.checked, true);
  assert.strictEqual(asiaInput.checked, false);
  assert.strictEqual(europeInput.className, 'jd-local-filter');
  assert.strictEqual(europe.inserted.children[1].textContent, '仅看本地自选');
});

test('applyLocalFilter 在 QDII 模式只按当前分类记录筛选', () => {
  function row(code) {
    const classes = new Set();
    return {
      code,
      classList: {
        toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  }
  const rows = [row('520580'), row('513350')];
  const container = {
    querySelector: () => null,
    appendChild() {},
  };
  const document = {
    getElementById: () => ({}),
    createElement() {
      const node = {
        style: {},
        attributes: {},
        getAttribute(name) { return this.attributes[name] ?? null; },
        setAttribute(name, value) { this.attributes[name] = value; },
      };
      Object.defineProperty(node, 'dataset', {
        get() { throw new TypeError('dataset getter must not be used for empty-state writes'); },
      });
      return node;
    },
  };
  const adapter = loadAdapterWithDocument(document);
  adapter.qdiiDataRows = () => rows;
  adapter.readQdiiRow = (item, category) => ({ code: item.code, category });
  const table = { closest: () => container, parentElement: container };

  assert.strictEqual(adapter.applyLocalFilter(
    table,
    new Set(['520580']),
    true,
    { kind: 'qdii', category: 'europe' }
  ), 1);
  assert.strictEqual(rows[0].classList.contains('jd-local-filter-hidden'), false);
  assert.strictEqual(rows[1].classList.contains('jd-local-filter-hidden'), true);
});
