// jisilu-deck 真实 Chrome E2E：通过 browser-skill 的 bsk CLI 驱动已连接的测试浏览器。
// 运行前：在 chrome://extensions 重新加载本项目未打包扩展，然后执行：
//   node tools/e2e-cb-list.js
//
// 集思录全量宽表的 aria snapshot 在当前 browser-skill 版本中可能阻塞，因此按 skill 约束先对
// Agent Window 初始轻量页 snapshot，再导航到目标页；目标页用受控 evaluate 完成精确 DOM 断言。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_URL = 'https://www.jisilu.cn/web/data/cb/list';
const PLUS_ICON = '\ue61e';
const MINUS_ICON = '\ue61d';
const PLUS_RGB = 'rgb(230, 126, 34)';
const RED_RGB = 'rgb(221, 24, 23)';
const SITE_BLUE_RGB = 'rgb(32, 103, 152)';
const FILTER_ACTIVE_RGB = 'rgb(230, 126, 34)';
const SCREENSHOT_PATH = '/tmp/jd-bsk-e2e.png';

const results = [];
const activeSessions = new Set();
let testCodes = [];
let testPendingCode = '';
let cleanupComplete = false;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` | ${detail}` : ''}`);
}

function addChecks(items) {
  for (const item of items || []) check(item.name, item.ok, item.detail || '');
}

function runBsk(args, options = {}) {
  const result = spawnSync('bsk', args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout || 45000,
  });
  if (result.error) throw new Error(`bsk ${args.join(' ')}：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `bsk 退出码 ${result.status}`).trim());
  }
  const output = (result.stdout || '').trim();
  if (!options.json) return output;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`无法解析 bsk JSON 输出：${error.message}\n${output.slice(0, 1000)}`);
  }
}

function startSession() {
  const started = runBsk(
    ['session', 'start', '--json', '--width', '1280', '--height', '800'],
    { json: true }
  );
  const session = started.session_id;
  if (!session) throw new Error('bsk session start 未返回 session_id');
  activeSessions.add(session);
  runBsk(
    ['snapshot', '--session', session, '--max-depth', '3', '--max-tokens', '300', '--json'],
    { json: true, timeout: 30000 }
  );
  return session;
}

function stopSession(session) {
  if (!session || !activeSessions.has(session)) return;
  runBsk(['session', 'stop', session], { timeout: 30000 });
  activeSessions.delete(session);
}

function navigate(session) {
  runBsk(
    ['navigate', TARGET_URL, '--session', session, '--wait-until', 'domcontentloaded', '--timeout', '30s', '--json'],
    { json: true }
  );
}

function evaluate(session, expression) {
  const response = runBsk(
    ['evaluate', '--session', session, '--timeout', '60s', '--json', expression],
    { json: true, timeout: 70000 }
  );
  if (response.ok !== true) {
    const message = response.exception_details?.text || response.message || JSON.stringify(response);
    throw new Error(`页面 evaluate 失败：${message}`);
  }
  return response.value;
}

function clickAndAllowNavigation(session, expression) {
  const result = spawnSync('bsk', [
    'evaluate', '--session', session, '--timeout', '30s', '--json', expression,
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 40000,
  });
  if (result.error) throw new Error(`页面导航点击失败：${result.error.message}`);
  const output = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
  if (result.status === 0) {
    const response = JSON.parse((result.stdout || '').trim());
    if (response.ok !== true) throw new Error(response.exception_details?.text || JSON.stringify(response));
    return;
  }
  if (result.status === 3 && /navigated or closed|Detached while handling|Inspected target navigated/i.test(output)) return;
  throw new Error(output || `页面导航点击退出码 ${result.status}`);
}

function staticChecks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  check('manifest 为 MV3', manifest.manifest_version === 3);
  check('manifest 版本为 0.4.0', manifest.version === '0.4.0', manifest.version);
  check('权限只有 storage', JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), JSON.stringify(manifest.permissions));
  const contentScript = manifest.content_scripts && manifest.content_scripts[0];
  check(
    '匹配范围只有可转债与数据板块 SPA 过渡页',
    contentScript && JSON.stringify(contentScript.matches) === JSON.stringify([
      'https://www.jisilu.cn/web/data/cb/*',
      'https://www.jisilu.cn/data/*',
    ]),
    JSON.stringify((contentScript && contentScript.matches) || null)
  );
  check(
    '注入脚本文件存在',
    contentScript && contentScript.js.every((file) => fs.existsSync(path.join(ROOT, file))),
    (contentScript && contentScript.js || []).join(',')
  );
  check('E2E 使用 browser-skill，不依赖 Playwright', !Object.keys(require.cache).some((file) => file.includes('/playwright')));
}

const PHASE_ONE = `
(async () => {
  const PLUS = ${JSON.stringify(PLUS_ICON)};
  const MINUS = ${JSON.stringify(MINUS_ICON)};
  const PLUS_RGB = ${JSON.stringify(PLUS_RGB)};
  const RED_RGB = ${JSON.stringify(RED_RGB)};
  const SITE_BLUE = ${JSON.stringify(SITE_BLUE_RGB)};
  const FILTER_ACTIVE = ${JSON.stringify(FILTER_ACTIVE_RGB)};
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const rows = () => [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
    .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
  const iconOf = (btn) => btn && btn.querySelector(':scope > span.jisilu-icons');
  const rowInfo = (tr) => {
    const btn = tr.children[1].querySelector('a.jd-local-btn');
    const icon = iconOf(btn);
    const nameCell = tr.children[3];
    const name = nameCell.querySelector('span');
    const purchase = nameCell.querySelector(':scope > a.jd-purchase-btn');
    return {
      tr, btn, icon, name, purchase,
      code: (tr.children[2].innerText || '').trim(),
      glyph: icon && icon.textContent,
      color: icon && getComputedStyle(icon).color,
      nameColor: name && getComputedStyle(name).color,
      nameInline: name && name.style.color,
    };
  };
  const waitFor = async (predicate, message, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(message);
  };
  await waitFor(() => {
    const current = rows();
    return current.length >= 10
      && current.every((tr) => tr.children[1].querySelector('a.jd-local-btn'))
      && document.querySelector('.jd-local-filter-group');
  }, '等待插件按钮注入超时；请先在 chrome://extensions 重新加载 jisilu-deck');

  const all = rows().map(rowInfo);
  const localGroup = document.querySelector('.jd-local-filter-group');
  const watchlistFilter = localGroup.querySelector('button[data-jd-filter-mode="watchlist"]');
  const pendingFilter = localGroup.querySelector('button[data-jd-filter-mode="pending"]');
  const siteGroup = [...document.querySelectorAll('.table-top .table-bar .el-checkbox-group.attention')]
    .find((group) => {
      const text = (group.textContent || '').replace(/\s+/g, '');
      return text.includes('仅看自选') && text.includes('仅看持仓');
    });
  const showBlocked = siteGroup && [...siteGroup.parentElement.children]
    .find((element) => element !== siteGroup && (element.textContent || '').includes('显示已拉黑'));
  const nativeInner = siteGroup && siteGroup.querySelector('.el-checkbox-button__inner');
  const siteCheckedBefore = siteGroup && [...siteGroup.querySelectorAll('input')].map((input) => input.checked);

  check('插件筛选组只注入一次且恰好包含两个按钮', document.querySelectorAll('.jd-local-filter-group').length === 1
    && localGroup.querySelectorAll('button.jd-local-filter').length === 2);
  check('插件筛选组位于原站筛选组之后、显示已拉黑之前', Boolean(
    siteGroup && showBlocked
    && localGroup.previousElementSibling === siteGroup
    && localGroup.nextElementSibling === showBlocked
  ));
  check('两个插件筛选按钮尺寸和字号与原站 mini 按钮一致', Boolean(nativeInner)
    && [watchlistFilter, pendingFilter].every((btn) => Math.abs(btn.getBoundingClientRect().height - nativeInner.getBoundingClientRect().height) < 0.6
      && getComputedStyle(btn).fontSize === getComputedStyle(nativeInner).fontSize));
  check('两个插件筛选默认关闭且为白底灰字', [watchlistFilter, pendingFilter].every((btn) => btn.getAttribute('aria-pressed') === 'false'
    && getComputedStyle(btn).backgroundColor === 'rgb(255, 255, 255)'
    && getComputedStyle(btn).color === 'rgb(96, 98, 102)'));
  check('每条数据行注入且只有一个本地按钮', all.every((item) => item.tr.children[1].querySelectorAll('a.jd-local-btn').length === 1), 'rows=' + all.length);
  check('操作列宽保持 32px', all.every((item) => Math.abs(item.tr.children[1].getBoundingClientRect().width - 32) < 0.6));
  check('本地按钮全部使用 jisilu-icons 子元素', all.every((item) => item.icon && getComputedStyle(item.icon).fontFamily.includes('jisilu-iconfont')));
  check('本地图标全部为 13×13px', all.every((item) => {
    const rect = item.icon.getBoundingClientRect();
    return Math.abs(rect.width - 13) < 0.6 && Math.abs(rect.height - 13) < 0.6;
  }));
  check('本地状态只使用原站 +／- 字形', all.every((item) => item.glyph === PLUS || item.glyph === MINUS));

  const originalUnchanged = all.every((item) => {
    const anchor = item.tr.children[1].querySelector('a:not(.jd-local-btn)');
    const icon = anchor && anchor.querySelector('.jisilu-icons');
    if (!anchor || !icon) return false;
    const isPlus = anchor.title.startsWith('加[');
    const isMinus = anchor.title.startsWith('将[');
    return (isPlus && icon.textContent === PLUS && getComputedStyle(icon).color === SITE_BLUE)
      || (isMinus && icon.textContent === MINUS && getComputedStyle(icon).color === RED_RGB);
  });
  check('集思录原 +／- 图标、颜色和提示未改动', originalUnchanged);

  const geometryOk = all.every((item) => {
    const cell = item.tr.children[1].getBoundingClientRect();
    const original = item.tr.children[1].querySelector('a:not(.jd-local-btn)').getBoundingClientRect();
    const local = item.btn.getBoundingClientRect();
    return local.left >= original.right - 0.5 && local.right <= cell.right + 0.5;
  });
  check('本地按钮不覆盖原按钮且不超出操作格', geometryOk);

  const candidates = all.filter((item) => item.glyph === PLUS);
  if (candidates.length < 2) throw new Error('至少需要两条未加入本地自选的记录用于隔离验收');
  const first = candidates[0];
  const second = candidates[1];
  const firstCodeColor = getComputedStyle(first.tr.children[2].querySelector('a')).color;

  check('未选按钮复用原站 + 字形且只改为橙色', first.glyph === PLUS && first.color === PLUS_RGB, first.color || 'no color');
  check('非本地自选行没有待购入口', candidates.every((item) => !item.purchase));
  first.btn.click();
  await waitFor(() => rowInfo(first.tr).glyph === MINUS && rowInfo(first.tr).purchase, '第一条记录加入本地自选超时');
  const watchedFirst = rowInfo(first.tr);
  check('加入后复用原站 - 字形和红色', watchedFirst.glyph === MINUS && watchedFirst.color === RED_RGB, watchedFirst.color || 'no color');
  check('加入后名称与 - 同红', watchedFirst.nameColor === RED_RGB && watchedFirst.nameInline === RED_RGB, watchedFirst.nameColor || 'no color');
  check('代码字段颜色不变', getComputedStyle(first.tr.children[2].querySelector('a')).color === firstCodeColor);
  check('加入本地自选后名称旁显示灰色待购 +', watchedFirst.purchase.textContent === '+'
    && getComputedStyle(watchedFirst.purchase).color === 'rgb(144, 147, 153)');

  second.btn.click();
  await waitFor(() => rowInfo(second.tr).glyph === MINUS && rowInfo(second.tr).purchase, '第二条记录加入本地自选超时');
  check('两条测试记录可独立加入', rowInfo(first.tr).glyph === MINUS && rowInfo(second.tr).glyph === MINUS);

  rowInfo(first.tr).purchase.click();
  await waitFor(() => rowInfo(first.tr).purchase.textContent === '待购', '第一条记录标记待购超时');
  check('待购标记为橙色且没有弹窗或撤销控件', getComputedStyle(rowInfo(first.tr).purchase).color === PLUS_RGB
    && !document.querySelector('.el-message-box__wrapper') && !document.querySelector('.jd-purchase-undo'));
  check('待购标记紧跟名称且保持同一行', rowInfo(first.tr).purchase.previousElementSibling === rowInfo(first.tr).name
    && Math.abs(rowInfo(first.tr).purchase.getBoundingClientRect().y - rowInfo(first.tr).name.getBoundingClientRect().y) < 4);

  watchlistFilter.click();
  await waitFor(() => watchlistFilter.getAttribute('aria-pressed') === 'true'
    && rows().some((tr) => tr.classList.contains('jd-local-filter-hidden'))
    && getComputedStyle(watchlistFilter).backgroundColor === FILTER_ACTIVE
    && getComputedStyle(watchlistFilter).borderColor === FILTER_ACTIVE
    && getComputedStyle(watchlistFilter).color === 'rgb(255, 255, 255)', '开启本地自选筛选超时');
  const visibleWhileFiltered = rows().filter((tr) => !tr.classList.contains('jd-local-filter-hidden'));
  check('仅看本地自选为橙底白字', getComputedStyle(watchlistFilter).backgroundColor === FILTER_ACTIVE
    && getComputedStyle(watchlistFilter).borderColor === FILTER_ACTIVE
    && getComputedStyle(watchlistFilter).color === 'rgb(255, 255, 255)');
  check('仅看本地自选只显示本地自选行', visibleWhileFiltered.length > 0
    && visibleWhileFiltered.every((tr) => rowInfo(tr).glyph === MINUS), 'visible=' + visibleWhileFiltered.length);
  check('两条测试本地自选均可见', !first.tr.classList.contains('jd-local-filter-hidden')
    && !second.tr.classList.contains('jd-local-filter-hidden'));

  pendingFilter.click();
  await waitFor(() => pendingFilter.getAttribute('aria-pressed') === 'true'
    && watchlistFilter.getAttribute('aria-pressed') === 'false', '切换待购筛选超时');
  const visiblePending = rows().filter((tr) => !tr.classList.contains('jd-local-filter-hidden'));
  check('两个本地筛选互斥且待购筛选只显示待购行', visiblePending.length > 0
    && visiblePending.every((tr) => rowInfo(tr).purchase && rowInfo(tr).purchase.textContent === '待购'));

  rowInfo(first.tr).purchase.click();
  await waitFor(() => first.tr.classList.contains('jd-local-filter-hidden'), '待购筛选中清除后未立即隐藏');
  check('清除待购后本地自选保留且行立即隐藏', rowInfo(first.tr).glyph === MINUS
    && rowInfo(first.tr).purchase.textContent === '+');

  pendingFilter.click();
  await waitFor(() => pendingFilter.getAttribute('aria-pressed') === 'false'
    && rows().every((tr) => !tr.classList.contains('jd-local-filter-hidden')), '关闭待购筛选后恢复超时');
  rowInfo(first.tr).purchase.click();
  await waitFor(() => rowInfo(first.tr).purchase.textContent === '待购', '刷新验证前重新标记待购超时');
  check('关闭筛选后恢复全部当前站内结果', rows().every((tr) => tr.getClientRects().length > 0));
  check('本地筛选未改变原站筛选状态', JSON.stringify([...siteGroup.querySelectorAll('input')].map((input) => input.checked)) === JSON.stringify(siteCheckedBefore));

  return { checks, codes: [first.code, second.code], pendingCode: first.code };
})()
`;

function phaseTwoExpression(codes, pendingCode) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const RED_RGB = ${JSON.stringify(RED_RGB)};
    const codes = ${JSON.stringify(codes)};
    const pendingCode = ${JSON.stringify(pendingCode)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const rows = () => {
      const table = [...document.querySelectorAll('table.jsl-table-body')]
        .find((item) => item.getClientRects().length > 0
          && item.querySelector('a[href^="/data/convert_bond_detail/"]'));
      return table ? [...table.querySelectorAll(':scope > tbody > tr')]
        .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data')) : [];
    };
    const find = (code) => rows().find((tr) => (tr.children[2].innerText || '').trim() === code);
    const state = (code) => {
      const tr = find(code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      const name = tr && tr.children[3].querySelector('span');
      const purchase = tr && tr.children[3].querySelector(':scope > a.jd-purchase-btn');
      return { tr, btn, purchase, glyph: icon && icon.textContent, name, nameColor: name && getComputedStyle(name).color, nameInline: name && name.style.color };
    };
    const filter = (mode) => document.querySelector('button.jd-local-filter[data-jd-filter-mode="' + mode + '"]');
    const waitFor = async (predicate, message, timeout = 20000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(message);
    };
    const restoreEnd = Date.now() + 45000;
    while (Date.now() < restoreEnd && !codes.every((code) => state(code).glyph)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!codes.every((code) => state(code).glyph)) {
      throw new Error('刷新后等待插件状态恢复超时：' + JSON.stringify({
        path: location.pathname,
        rowCount: rows().length,
        filterGroupCount: document.querySelectorAll('.jd-local-filter-group').length,
        states: codes.map((code) => ({ code: code, glyph: state(code).glyph || null })),
      }));
    }
    await waitFor(() => filter('watchlist') && filter('pending'), '刷新后等待本地筛选组恢复超时');
    check('页面刷新后两个本地筛选默认关闭', filter('watchlist').getAttribute('aria-pressed') === 'false'
      && filter('pending').getAttribute('aria-pressed') === 'false'
      && rows().every((tr) => !tr.classList.contains('jd-local-filter-hidden')));
    check('页面刷新后两条记录恢复红色 - 与名称标红', codes.every((code) => {
      const item = state(code);
      return item.glyph === MINUS && item.nameColor === RED_RGB && item.nameInline === RED_RGB;
    }));
    check('页面刷新后待购状态恢复且未待购行保持灰色 +', state(pendingCode).purchase?.textContent === '待购'
      && codes.filter((code) => code !== pendingCode).every((code) => state(code).purchase?.textContent === '+'));

    filter('watchlist').click();
    await waitFor(() => filter('watchlist').getAttribute('aria-pressed') === 'true', '刷新后开启本地自选筛选超时');

    const priceHeader = [...document.querySelectorAll('.jsl-table-header th')]
      .find((th) => (th.innerText || '').trim() === '现价');
    if (priceHeader) {
      let tableMutated = false;
      const tableBody = rows()[0].parentElement;
      const observer = new MutationObserver(() => { tableMutated = true; });
      observer.observe(tableBody, { childList: true, subtree: true });
      priceHeader.click();
      await waitFor(() => tableMutated, '点击现价表头后表格未发生重渲染');
      observer.disconnect();
      await waitFor(() => codes.every((code) => state(code).glyph), '排序重渲染后等待插件状态恢复超时');
      check('排序重渲染后每行仍只有一个本地按钮', rows().every((tr) => tr.children[1].querySelectorAll('a.jd-local-btn').length === 1));
      check('排序重渲染后测试记录状态恢复', codes.every((code) => state(code).glyph === MINUS));
      check('排序重渲染后本地筛选继续生效', filter('watchlist').getAttribute('aria-pressed') === 'true'
        && rows().filter((tr) => !tr.classList.contains('jd-local-filter-hidden')).every((tr) => state((tr.children[2].innerText || '').trim()).glyph === MINUS));
    } else {
      check('排序重渲染场景', true, '未找到现价表头，跳过');
    }

    state(codes[0]).btn.click();
    await waitFor(() => state(codes[0]).glyph === PLUS && state(codes[0]).tr.classList.contains('jd-local-filter-hidden'), '移出第一条测试记录超时');
    check('移出本地自选同时清除待购入口且不影响其他记录', state(codes[0]).glyph === PLUS
      && state(codes[0]).nameInline === '' && !state(codes[0]).purchase && state(codes[1]).glyph === MINUS);
    filter('watchlist').click();
    await waitFor(() => filter('watchlist').getAttribute('aria-pressed') === 'false', '重新加入前关闭筛选超时');
    state(codes[0]).btn.click();
    await waitFor(() => state(codes[0]).glyph === MINUS && state(codes[0]).purchase, '重新加入第一条测试记录超时');
    state(codes[0]).purchase.click();
    await waitFor(() => state(codes[0]).purchase.textContent === '待购', '重建窗口验证前重新标记待购超时');
    return { checks };
  })()
  `;
}

const CLICK_CLOSED_FUND = `
(() => {
  const link = [...document.querySelectorAll('a[href*="/data/cf/"]')]
    .find((item) => (item.textContent || '').trim() === '封闭基金');
  if (!link) throw new Error('未找到封闭基金导航入口');
  link.click();
  return true;
})()
`;

const CHECK_CLOSED_FUND = `
(async () => {
  const end = Date.now() + 20000;
  while (Date.now() < end && location.pathname !== '/data/cf/') {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const visible = (selector) => [...document.querySelectorAll(selector)]
    .some((item) => item.getClientRects().length > 0);
  return { checks: [{
    name: '离开可转债后不显示本地待购入口或筛选组',
    ok: location.pathname === '/data/cf/'
      && !visible('a.jd-purchase-btn')
      && !visible('.jd-local-filter-group'),
    detail: location.pathname,
  }] };
})()
`;

const CLICK_CONVERTIBLE_BOND = `
(() => {
  const link = [...document.querySelectorAll('a[href*="/web/data/cb/"]')]
    .find((item) => (item.textContent || '').trim() === '可转债');
  if (!link) throw new Error('未找到可转债返回入口');
  link.click();
  return true;
})()
`;

function spaReturnExpression(codes, pendingCode) {
  return `
  (async () => {
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const codes = ${JSON.stringify(codes)};
    const pendingCode = ${JSON.stringify(pendingCode)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const rows = () => {
      const table = [...document.querySelectorAll('table.jsl-table-body')]
        .find((item) => item.getClientRects().length > 0
          && item.querySelector('a[href^="/data/convert_bond_detail/"]'));
      return table ? [...table.querySelectorAll(':scope > tbody > tr')]
        .filter((tr) => tr.children[0]?.classList.contains('sticky-data')) : [];
    };
    const state = (code) => {
      const tr = rows().find((row) => (row.children[2]?.innerText || '').trim() === code);
      const btn = tr?.children[1]?.querySelector('a.jd-local-btn');
      return {
        tr,
        glyph: btn?.querySelector('span.jisilu-icons')?.textContent,
        purchase: tr?.children[3]?.querySelector(':scope > a.jd-purchase-btn'),
      };
    };
    const filter = (mode) => document.querySelector('button.jd-local-filter[data-jd-filter-mode="' + mode + '"]');
    const end = Date.now() + 20000;
    while (Date.now() < end && !(location.pathname === '/web/data/cb/list'
      && codes.every((code) => state(code).glyph)
      && filter('watchlist') && filter('pending'))) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    check('SPA 往返后每行入口和筛选组均无重复', rows().every((tr) => tr.querySelectorAll('a.jd-local-btn').length === 1
      && tr.querySelectorAll('a.jd-purchase-btn').length <= 1)
      && document.querySelectorAll('.jd-local-filter-group').length === 1);
    check('SPA 往返后本地自选与待购状态恢复', codes.every((code) => state(code).glyph === MINUS)
      && state(pendingCode).purchase?.textContent === '待购');
    filter('pending').click();
    const filterEnd = Date.now() + 20000;
    while (Date.now() < filterEnd && filter('pending').getAttribute('aria-pressed') !== 'true') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    check('SPA 返回后待购筛选可用', filter('pending').getAttribute('aria-pressed') === 'true'
      && rows().filter((tr) => !tr.classList.contains('jd-local-filter-hidden'))
        .every((tr) => state((tr.children[2]?.innerText || '').trim()).purchase?.textContent === '待购'));
    return { checks };
  })()
  `;
}

function restartAndCleanupExpression(codes, pendingCode) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const codes = ${JSON.stringify(codes)};
    const pendingCode = ${JSON.stringify(pendingCode)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const rows = () => [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
      .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
    const state = (code) => {
      const tr = rows().find((row) => (row.children[2].innerText || '').trim() === code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      const name = tr && tr.children[3].querySelector('span');
      const purchase = tr && tr.children[3].querySelector(':scope > a.jd-purchase-btn');
      return { btn, purchase, glyph: icon && icon.textContent, nameInline: name && name.style.color };
    };
    const waitFor = async (predicate, message, timeout = 20000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(message);
    };
    await waitFor(() => codes.every((code) => state(code).glyph), 'Agent Window 重建后等待插件状态恢复超时');
    check('Agent Window 重建后两条测试记录保持本地自选', codes.every((code) => state(code).glyph === MINUS));
    check('Agent Window 重建后待购状态保持', state(pendingCode).purchase?.textContent === '待购');
    for (const code of codes) {
      const item = state(code);
      if (item.glyph === MINUS) item.btn.click();
      await waitFor(() => state(code).glyph === PLUS, '清理测试记录超时：' + code);
    }
    check('验收测试数据已恢复为初始未选状态', codes.every((code) => state(code).glyph === PLUS
      && state(code).nameInline === '' && !state(code).purchase));
    return { checks, cleanupComplete: true };
  })()
  `;
}

function cleanupExpression(codes) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const codes = ${JSON.stringify(codes)};
    const state = (code) => {
      const tr = [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
        .find((row) => row.children[0] && row.children[0].classList.contains('sticky-data') && (row.children[2].innerText || '').trim() === code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      return { btn, glyph: icon && icon.textContent };
    };
    let end = Date.now() + 20000;
    while (Date.now() < end && !codes.every((code) => state(code).glyph)) await new Promise((resolve) => setTimeout(resolve, 200));
    for (const code of codes) {
      end = Date.now() + 20000;
      let clickedButton = null;
      while (Date.now() < end) {
        const item = state(code);
        if (item.glyph === PLUS) break;
        if (item.glyph === MINUS && item.btn?.isConnected && item.btn !== clickedButton) {
          item.btn.click();
          clickedButton = item.btn;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return codes.every((code) => state(code).glyph === PLUS);
  })()
  `;
}

(async () => {
  let session;
  try {
    staticChecks();
    runBsk(['status']);

    session = startSession();
    navigate(session);
    const phaseOne = evaluate(session, PHASE_ONE);
    addChecks(phaseOne.checks);
    testCodes = phaseOne.codes;
    testPendingCode = phaseOne.pendingCode;

    runBsk(['reload', '--session', session, '--wait-until', 'domcontentloaded', '--timeout', '30s', '--json'], { json: true });
    const phaseTwo = evaluate(session, phaseTwoExpression(testCodes, testPendingCode));
    addChecks(phaseTwo.checks);
    clickAndAllowNavigation(session, CLICK_CLOSED_FUND);
    runBsk(['wait-ms', '2s']);
    const closedFund = evaluate(session, CHECK_CLOSED_FUND);
    addChecks(closedFund.checks);
    clickAndAllowNavigation(session, CLICK_CONVERTIBLE_BOND);
    runBsk(['wait-ms', '2s']);
    const returned = evaluate(session, spaReturnExpression(testCodes, testPendingCode));
    addChecks(returned.checks);
    runBsk(['screenshot', '--session', session, '--out', SCREENSHOT_PATH, '--json'], { json: true });
    check('真实 Chrome 截图已生成', fs.existsSync(SCREENSHOT_PATH), SCREENSHOT_PATH);
    stopSession(session);
    session = null;

    session = startSession();
    navigate(session);
    const restarted = evaluate(session, restartAndCleanupExpression(testCodes, testPendingCode));
    addChecks(restarted.checks);
    cleanupComplete = restarted.cleanupComplete === true;
  } catch (error) {
    check('browser-skill E2E 执行完整性', false, error.message);
  } finally {
    if (testCodes.length && !cleanupComplete) {
      try {
        if (!session) {
          session = startSession();
        }
        navigate(session);
        cleanupComplete = evaluate(session, cleanupExpression(testCodes)) === true;
        check('异常路径清理测试数据', cleanupComplete);
      } catch (error) {
        check('异常路径清理测试数据', false, error.message);
      }
    }
    for (const active of [...activeSessions]) {
      try {
        stopSession(active);
      } catch (error) {
        check(`停止 browser-skill session ${active}`, false, error.message);
      }
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n===== browser-skill E2E 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) process.exitCode = 1;
})();
