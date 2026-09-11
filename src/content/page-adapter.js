// 页面适配层：唯一负责集思录页面 DOM 的定位、读取与注入（implementation-boundaries.md §3）
// 选择器依据与失效条件见 docs/research/2026-08-24-cb-list-dom-structure.md
// 所有 DOM 写入都做变更检查：既幂等，也避免与自身 MutationObserver 形成回环
(function () {
  'use strict';

  const NS = (globalThis.jisiluDeck = globalThis.jisiluDeck || {});

  const PLUS_COLOR = '#e67e22'; // 本地 +（ui-spec.md §2）
  const RED_COLOR = '#dd1817';  // 复用原站 - 的红色；QDII 已选名称与本地 - 同色（ui-spec.md §2/§8）
  const PURCHASE_IDLE_COLOR = '#909399';
  const PLUS_ICON = '\ue61e';   // 原站 jisilu-iconfont 的 +
  const MINUS_ICON = '\ue61d';  // 原站 jisilu-iconfont 的 -
  const BTN_CLASS = 'jd-local-btn';
  const HINT_CLASS = 'jd-local-hint';
  const FILTER_BTN_CLASS = 'jd-local-filter';
  const FILTER_GROUP_CLASS = 'jd-local-filter-group';
  const PURCHASE_BTN_CLASS = 'jd-purchase-btn';
  const FILTER_HIDDEN_CLASS = 'jd-local-filter-hidden';
  const FILTER_EMPTY_CLASS = 'jd-local-filter-empty';
  const FILTER_STYLE_ID = 'jd-local-filter-style';
  const QDII_TABLES = [
    { id: 'flex_qdiie', category: 'europe' },
    { id: 'flex_qdiic', category: 'commodity' },
    { id: 'flex_qdiia', category: 'asia' },
  ];

  // 只在值变化时写入，避免重复触发观察器
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function setStyle(el, prop, value) { if (el.style[prop] !== value) el.style[prop] = value; }
  function setAttr(el, name, value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }
  function ensureFilterStyle() {
    if (!document.getElementById || document.getElementById(FILTER_STYLE_ID)) return;
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = FILTER_STYLE_ID;
    style.textContent = '.' + FILTER_HIDDEN_CLASS + '{display:none!important;}';
    host.appendChild(style);
  }

  NS.pageAdapter = {
    PLUS_COLOR: PLUS_COLOR,
    RED_COLOR: RED_COLOR,

    findQdiiTables() {
      const out = [];
      for (let i = 0; i < QDII_TABLES.length; i++) {
        const config = QDII_TABLES[i];
        const table = document.getElementById && document.getElementById(config.id);
        if (!table || table.getClientRects().length === 0) continue;
        out.push({ category: config.category, table: table });
      }
      return out;
    },

    // 主列表表 = 当前可见且直接子行同时含站内自选按钮与可转债详情链接的 table.jsl-table-body
    findMainTable() {
      const tables = document.querySelectorAll('table.jsl-table-body');
      for (let i = 0; i < tables.length; i++) {
        if (tables[i].getClientRects().length === 0) continue;
        const rows = tables[i].querySelectorAll(':scope > tbody > tr');
        for (let j = 0; j < rows.length; j++) {
          const opCell = rows[j].children[1];
          const codeCell = rows[j].children[2];
          if (
            opCell && opCell.querySelector('a[title^="加["]')
            && codeCell && codeCell.querySelector('a[href^="/data/convert_bond_detail/"]')
          ) return tables[i];
        }
      }
      return null;
    },

    // 数据行 = tbody 直接子行中 td[0] 带 sticky-data 的行（排除行展开明细行）
    dataRows(table) {
      const rows = table.querySelectorAll(':scope > tbody > tr');
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].children[0] && rows[i].children[0].classList.contains('sticky-data')) out.push(rows[i]);
      }
      return out;
    },

    qdiiDataRows(table) {
      const rows = table.querySelectorAll(':scope > tbody > tr');
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        if (this.readQdiiRow(rows[i])) out.push(rows[i]);
      }
      return out;
    },

    // 插件自有筛选组独立挂在原站按钮组之后，不进入 Vue 管理的按钮组内部。
    ensureFilterGroup(activeMode) {
      const groups = document.querySelectorAll('.table-top .table-bar .el-checkbox-group.attention');
      let group = null;
      for (let i = 0; i < groups.length; i++) {
        const text = (groups[i].textContent || '').replace(/\s+/g, '');
        if (text.includes('仅看自选') && text.includes('仅看持仓')) {
          group = groups[i];
          break;
        }
      }
      if (!group || !group.parentElement) return null;

      const bar = group.parentElement;
      let localGroup = bar.querySelector(':scope > .' + FILTER_GROUP_CLASS);
      if (!localGroup) {
        localGroup = document.createElement('div');
        localGroup.className = FILTER_GROUP_CLASS;
        localGroup.setAttribute('role', 'group');
        localGroup.setAttribute('aria-label', '本地清单筛选');
        localGroup.style.cssText = 'display:inline-flex;margin-left:8px;vertical-align:middle;';
        const configs = [
          { mode: 'watchlist', text: '仅看本地自选' },
          { mode: 'pending', text: '仅看待购' },
        ];
        for (let i = 0; i < configs.length; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = FILTER_BTN_CLASS;
          setAttr(btn, 'data-jd-filter-mode', configs[i].mode);
          btn.textContent = configs[i].text;
          btn.style.cssText = 'box-sizing:border-box;padding:7px 15px;border:1px solid #dcdfe6;border-radius:'
            + (i === 0 ? '4px 0 0 4px' : '0 4px 4px 0')
            + ';background:#fff;color:#606266;font-family:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;outline:0;transition:background-color .15s,border-color .15s,color .15s;';
          if (i > 0) btn.style.marginLeft = '-1px';
          localGroup.appendChild(btn);
        }
        bar.insertBefore(localGroup, group.nextSibling);
      }
      const buttons = localGroup.querySelectorAll('button.' + FILTER_BTN_CLASS);
      for (let i = 0; i < buttons.length; i++) {
        const active = buttons[i].getAttribute('data-jd-filter-mode') === activeMode;
        setAttr(buttons[i], 'aria-label', buttons[i].textContent);
        setAttr(buttons[i], 'aria-pressed', active ? 'true' : 'false');
        setStyle(buttons[i], 'backgroundColor', active ? PLUS_COLOR : '#fff');
        setStyle(buttons[i], 'borderColor', active ? PLUS_COLOR : '#dcdfe6');
        setStyle(buttons[i], 'color', active ? '#fff' : '#606266');
        setStyle(buttons[i], 'zIndex', active ? '1' : '');
      }
      return localGroup;
    },

    ensureQdiiFilterCheckbox(context, active) {
      const table = context.table;
      const category = context.category;
      const nativeInput = table.querySelector('input[name="only_owned"]');
      const nativeLabel = nativeInput && nativeInput.closest('label');
      if (!nativeLabel || !nativeLabel.parentElement) return null;

      let label = table.querySelector('label.' + FILTER_BTN_CLASS + '-label[data-jd-category="' + category + '"]');
      if (!label) {
        label = document.createElement('label');
        label.className = FILTER_BTN_CLASS + '-label';
        setAttr(label, 'data-jd-category', category);
        label.style.cssText = 'display:inline;margin-left:8px;';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = FILTER_BTN_CLASS;
        setAttr(input, 'data-jd-category', category);
        input.setAttribute('aria-label', '仅看本地自选');
        label.appendChild(input);
        label.appendChild(document.createTextNode('仅看本地自选'));
        nativeLabel.parentElement.insertBefore(label, nativeLabel.nextSibling);
      }
      const input = label.querySelector
        ? label.querySelector('input.' + FILTER_BTN_CLASS)
        : label.children && label.children[0];
      if (!input) return null;
      if (input.checked !== Boolean(active)) input.checked = Boolean(active);
      return input;
    },

    // 读取当前行 {code, name, opCell, nameSpan}；读不到合法代码或名称返回 null（该行不允许加入）
    readRow(tr) {
      const codeCell = tr.children[2];
      const nameCell = tr.children[3];
      if (!codeCell || !nameCell) return null;
      const codeLink = codeCell.querySelector('a[href^="/data/convert_bond_detail/"]');
      const nameSpan = nameCell.querySelector('span');
      if (!codeLink || !nameSpan) return null;
      const code = (codeLink.textContent || '').trim();
      const name = (nameSpan.textContent || '').trim();
      if (!/^\d{6}$/.test(code) || !name) return null;
      return { code: code, name: name, opCell: tr.children[1], nameCell: nameCell, nameSpan: nameSpan };
    },

    readQdiiRow(tr, category) {
      const codeCell = tr.children[0];
      const nameCell = tr.children[1];
      const opCell = tr.children[tr.children.length - 1];
      if (!codeCell || !nameCell || !opCell) return null;
      const codeLink = codeCell.querySelector('a[href^="/data/qdii/detail/"]');
      const siteButton = opCell.querySelector('a[href*="addOwnedQd"], a[href*="delOwnedQd"]');
      if (!codeLink || !siteButton) return null;
      const code = (codeLink.textContent || '').trim();
      const name = (nameCell.textContent || '').trim();
      if (!/^\d{6}$/.test(code) || !name) return null;
      return { category: category, code: code, name: name, opCell: opCell, nameSpan: nameCell };
    },

    // 幂等注入：同一行只保留一个插件按钮；返回挂钩或 null
    ensureButton(tr) {
      const info = this.readRow(tr);
      if (!info || !info.opCell) return null;
      let btn = info.opCell.querySelector(':scope > a.' + BTN_CLASS);
      if (!btn) {
        btn = document.createElement('a');
        btn.className = BTN_CLASS;
        setAttr(btn, 'data-jd-kind', 'cb');
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        // 操作格 position:sticky 已定位，子元素绝对定位不参与表格布局：不扩列宽、不覆盖原按钮
        btn.style.cssText = 'position:absolute;left:18px;top:50%;transform:translateY(-50%);width:13px;height:13px;line-height:13px;font-size:13px;text-align:center;text-decoration:none;cursor:pointer;display:block;user-select:none;';
        info.opCell.appendChild(btn);
      }
      let icon = btn.querySelector(':scope > span.jisilu-icons');
      if (!icon) {
        btn.textContent = '';
        icon = document.createElement('span');
        icon.className = 'jisilu-icons';
        // 原站图标类自带左右 2px margin；操作格剩余宽度只有 13px，本地副本移除 margin 以免溢出
        icon.style.cssText = 'margin:0;width:13px;height:13px;line-height:13px;font-size:13px;vertical-align:top;';
        btn.appendChild(icon);
      }
      return { code: info.code, name: info.name, btn: btn, icon: icon, nameSpan: info.nameSpan };
    },

    ensureQdiiButton(tr, category) {
      const info = this.readQdiiRow(tr, category);
      if (!info) return null;
      let btn = info.opCell.querySelector(':scope > a.' + BTN_CLASS + '[data-jd-kind="qdii"]');
      if (!btn) {
        btn = document.createElement('a');
        btn.className = BTN_CLASS;
        setAttr(btn, 'data-jd-kind', 'qdii');
        setAttr(btn, 'data-jd-category', category);
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.style.cssText = 'display:inline-block;margin-left:6px;width:13px;height:13px;line-height:13px;font-size:13px;text-align:center;text-decoration:none;vertical-align:middle;cursor:pointer;user-select:none;';
        info.opCell.appendChild(btn);
      }
      setStyle(info.opCell, 'minWidth', '46px');
      setStyle(info.opCell, 'whiteSpace', 'nowrap');
      let icon = btn.querySelector(':scope > span.jisilu-icons');
      if (!icon) {
        btn.textContent = '';
        icon = document.createElement('span');
        icon.className = 'jisilu-icons';
        icon.style.cssText = 'margin:0;width:13px;height:13px;line-height:13px;font-size:13px;vertical-align:top;';
        btn.appendChild(icon);
      }
      return {
        category: category,
        code: info.code,
        name: info.name,
        btn: btn,
        icon: icon,
        nameSpan: info.nameSpan,
        kind: 'qdii',
      };
    },

    // 待购入口只出现在本地自选行的转债名称旁；非本地自选行清理已有入口。
    ensurePurchaseButton(tr, watched) {
      const info = this.readRow(tr);
      if (!info || !info.nameCell) return null;
      let btn = info.nameCell.querySelector(':scope > a.' + PURCHASE_BTN_CLASS);
      if (!watched) {
        if (btn) btn.remove();
        return null;
      }
      if (!btn) {
        btn = document.createElement('a');
        btn.className = PURCHASE_BTN_CLASS;
        setAttr(btn, 'data-jd-kind', 'purchase');
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.style.cssText = 'display:inline-block;margin-left:2px;padding:0;border-radius:2px;font-size:10px;line-height:14px;text-decoration:none;vertical-align:baseline;cursor:pointer;user-select:none;white-space:nowrap;';
        // 页面可能在名称后追加条款状态图标；待购入口必须紧跟名称，不能 append 到图标之后被挤到下一行。
        info.nameCell.insertBefore(btn, info.nameSpan.nextSibling);
      }
      return { code: info.code, name: info.name, btn: btn };
    },

    applyPurchaseState(hook, pending) {
      if (pending) {
        setText(hook.btn, '待购');
        setStyle(hook.btn, 'color', PLUS_COLOR);
        setStyle(hook.btn, 'fontWeight', '500');
        setAttr(hook.btn, 'title', '清除[' + hook.name + ']的待购状态');
        setAttr(hook.btn, 'aria-label', '清除待购');
      } else {
        setText(hook.btn, '+');
        setStyle(hook.btn, 'color', PURCHASE_IDLE_COLOR);
        setStyle(hook.btn, 'fontWeight', '400');
        setAttr(hook.btn, 'title', '标记[' + hook.name + ']为待购');
        setAttr(hook.btn, 'aria-label', '标记为待购');
      }
      setAttr(hook.btn, 'aria-pressed', pending ? 'true' : 'false');
    },

    // 按本地选中状态切换按钮与名称样式
    applyState(hook, watched) {
      const btn = hook.btn;
      if (watched) {
        setText(hook.icon, MINUS_ICON);
        setStyle(btn, 'color', RED_COLOR);
        setAttr(btn, 'title', hook.kind === 'qdii'
          ? '从本地自选移出【' + hook.name + '】'
          : '从本地自选移出[' + hook.name + ']');
        setAttr(btn, 'aria-label', '移出本地自选');
        if (hook.kind === 'qdii') setStyle(hook.nameSpan, 'color', RED_COLOR);
        else if (hook.nameSpan.style.color !== '') hook.nameSpan.style.removeProperty('color');
      } else {
        setText(hook.icon, PLUS_ICON);
        setStyle(btn, 'color', PLUS_COLOR);
        setAttr(btn, 'title', hook.kind === 'qdii'
          ? '将【' + hook.name + '】加入本地自选'
          : '加[' + hook.name + ']为本地自选转债');
        setAttr(btn, 'aria-label', '加入本地自选');
        if (hook.nameSpan.style.color !== '') hook.nameSpan.style.removeProperty('color');
      }
    },

    // 本地筛选只作用于当前已渲染行，与站内筛选取交集；关闭时完整移除插件隐藏类
    applyLocalFilter(table, watched, active, options) {
      const config = options || {};
      const emptyKey = config.category || 'cb';
      ensureFilterStyle();
      const rows = config.kind === 'qdii' ? this.qdiiDataRows(table) : this.dataRows(table);
      let visibleCount = 0;
      for (let i = 0; i < rows.length; i++) {
        const info = config.kind === 'qdii'
          ? this.readQdiiRow(rows[i], config.category)
          : this.readRow(rows[i]);
        const hidden = active && (!info || !watched.has(info.code));
        rows[i].classList.toggle(FILTER_HIDDEN_CLASS, hidden);
        if (!hidden) visibleCount++;
      }

      const container = table.closest('.jsl-table') || table.parentElement;
      if (container) {
        let empty = container.querySelector(':scope > .' + FILTER_EMPTY_CLASS + '[data-jd-category="' + emptyKey + '"]');
        if (!empty) {
          empty = document.createElement('div');
          empty.className = FILTER_EMPTY_CLASS;
          setAttr(empty, 'data-jd-category', emptyKey);
          empty.style.cssText = 'padding:24px 0;text-align:center;font-size:14px;color:#909399;';
          container.appendChild(empty);
        }
        setText(empty, config.emptyText || '当前筛选条件下暂无本地自选');
        empty.hidden = !(active && visibleCount === 0);
      }
      return visibleCount;
    },

    // 保存失败时的局部提示：按钮附近短暂显示，不弹独立面板（ui-spec.md §3）
    showHint(btn, text) {
      const cell = btn.parentElement;
      if (!cell) return;
      const old = cell.querySelector(':scope > .' + HINT_CLASS);
      if (old) old.remove();
      const hint = document.createElement('span');
      hint.className = HINT_CLASS;
      hint.textContent = text;
      hint.style.cssText = 'position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:2px;white-space:nowrap;font-size:12px;color:' + RED_COLOR + ';background:rgba(255,255,255,0.95);padding:0 3px;z-index:9999;pointer-events:none;';
      cell.appendChild(hint);
      setTimeout(function () { if (hint.parentNode) hint.remove(); }, 2500);
    },
  };
})();
