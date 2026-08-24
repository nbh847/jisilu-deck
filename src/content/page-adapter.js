// 页面适配层：唯一负责集思录页面 DOM 的定位、读取与注入（implementation-boundaries.md §3）
// 选择器依据与失效条件见 docs/research/2026-08-24-cb-list-dom-structure.md
// 所有 DOM 写入都做变更检查：既幂等，也避免与自身 MutationObserver 形成回环
(function () {
  'use strict';

  const NS = (globalThis.jisiluDeck = globalThis.jisiluDeck || {});

  const PLUS_COLOR = '#e67e22'; // 本地 +（ui-spec.md §2）
  const RED_COLOR = '#dd1817';  // 复用原站 - 的红色；已选名称与本地 - 同色（ui-spec.md §2/§3）
  const PLUS_ICON = '\ue61e';   // 原站 jisilu-iconfont 的 +
  const MINUS_ICON = '\ue61d';  // 原站 jisilu-iconfont 的 -
  const BTN_CLASS = 'jd-local-btn';
  const HINT_CLASS = 'jd-local-hint';

  // 只在值变化时写入，避免重复触发观察器
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function setStyle(el, prop, value) { if (el.style[prop] !== value) el.style[prop] = value; }
  function setAttr(el, name, value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }

  NS.pageAdapter = {
    PLUS_COLOR: PLUS_COLOR,
    RED_COLOR: RED_COLOR,

    // 主列表表 = 第一张「直接子行 td[1] 含站内自选按钮」的 table.jsl-table-body
    findMainTable() {
      const tables = document.querySelectorAll('table.jsl-table-body');
      for (let i = 0; i < tables.length; i++) {
        const rows = tables[i].querySelectorAll(':scope > tbody > tr');
        for (let j = 0; j < rows.length; j++) {
          const opCell = rows[j].children[1];
          if (opCell && opCell.querySelector('a[title^="加["]')) return tables[i];
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
      return { code: code, name: name, opCell: tr.children[1], nameSpan: nameSpan };
    },

    // 幂等注入：同一行只保留一个插件按钮；返回挂钩或 null
    ensureButton(tr) {
      const info = this.readRow(tr);
      if (!info || !info.opCell) return null;
      let btn = info.opCell.querySelector(':scope > a.' + BTN_CLASS);
      if (!btn) {
        btn = document.createElement('a');
        btn.className = BTN_CLASS;
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

    // 按本地选中状态切换按钮与名称样式
    applyState(hook, watched) {
      const btn = hook.btn;
      if (watched) {
        setText(hook.icon, MINUS_ICON);
        setStyle(btn, 'color', RED_COLOR);
        setAttr(btn, 'title', '从本地自选移出[' + hook.name + ']');
        setAttr(btn, 'aria-label', '移出本地自选');
        setStyle(hook.nameSpan, 'color', RED_COLOR);
      } else {
        setText(hook.icon, PLUS_ICON);
        setStyle(btn, 'color', PLUS_COLOR);
        setAttr(btn, 'title', '加[' + hook.name + ']为本地自选转债');
        setAttr(btn, 'aria-label', '加入本地自选');
        if (hook.nameSpan.style.color !== '') hook.nameSpan.style.removeProperty('color');
      }
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
