// jisilu-deck QDII 真实 Chrome E2E：验证欧美、商品、亚洲三套本地自选完全隔离。
// 运行前先在 chrome://extensions 重新加载本项目未打包扩展，然后执行：
//   node tools/e2e-qdii.js
// QDII 超宽长表的 aria snapshot 会使当前 browser-skill 会话阻塞，因此与可转债 E2E 一致：
// 先对 Agent Window 初始轻量页 snapshot，再导航到目标页并用受控 evaluate 做精确断言。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_URL = 'https://www.jisilu.cn/data/qdii/#qdiie';
const PLUS_ICON = '\ue61e';
const MINUS_ICON = '\ue61d';
const PLUS_RGB = 'rgb(230, 126, 34)';
const RED_RGB = 'rgb(221, 24, 23)';
const SCREENSHOT_PATH = '/tmp/jd-bsk-qdii-e2e.png';

const results = [];
const activeSessions = new Set();
let testRecords = [];
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
    ['session', 'start', '--json', '--width', '1440', '--height', '900'],
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

function staticChecks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  check('manifest 为 MV3', manifest.manifest_version === 3);
  check('manifest 版本为 0.3.0', manifest.version === '0.3.0', manifest.version);
  check('权限只有 storage', JSON.stringify(manifest.permissions) === JSON.stringify(['storage']));
  check(
    'QDII 路径由现有 /data/* 最小范围覆盖',
    manifest.content_scripts[0].matches.includes('https://www.jisilu.cn/data/*')
  );
  check('QDII E2E 使用 browser-skill，不依赖 Playwright', !Object.keys(require.cache).some((file) => file.includes('/playwright')));
}

const PHASE_ONE = `
(async () => {
  const PLUS = ${JSON.stringify(PLUS_ICON)};
  const MINUS = ${JSON.stringify(MINUS_ICON)};
  const PLUS_RGB = ${JSON.stringify(PLUS_RGB)};
  const RED_RGB = ${JSON.stringify(RED_RGB)};
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const config = {
    europe: 'flex_qdiie',
    commodity: 'flex_qdiic',
  };
  const table = (category) => document.getElementById(config[category]);
  const rows = (category) => [...table(category).querySelectorAll(':scope > tbody > tr')]
    .filter((tr) => tr.children[0]?.querySelector('a[href^="/data/qdii/detail/"]')
      && tr.children[tr.children.length - 1]?.querySelector('a[href*="addOwnedQd"], a[href*="delOwnedQd"]'));
  const info = (category, tr) => {
    const op = tr.children[tr.children.length - 1];
    const btn = op.querySelector('a.jd-local-btn[data-jd-kind="qdii"]');
    const icon = btn && btn.querySelector('span.jisilu-icons');
    return {
      category, tr, op, btn, icon,
      code: tr.children[0].textContent.trim(),
      name: tr.children[1],
      glyph: icon && icon.textContent,
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
  await waitFor(() => Object.keys(config).every((category) => {
    const target = table(category);
    const current = target && rows(category);
    return target?.getClientRects().length > 0
      && current.length > 5
      && current.every((tr) => tr.querySelectorAll('a.jd-local-btn[data-jd-kind="qdii"]').length === 1)
      && target.querySelector('input.jd-local-filter[data-jd-category="' + category + '"]');
  }), '等待欧美与商品本地控件注入超时；请先重新加载扩展');

  const siteSelectedItems = [];
  for (const category of Object.keys(config)) {
    const target = table(category);
    const native = target.querySelector('input[name="only_owned"]');
    const local = target.querySelector('input.jd-local-filter[data-jd-category="' + category + '"]');
    const nativeLabel = native.closest('label');
    const localLabel = local.closest('label');
    const items = rows(category).map((tr) => info(category, tr));
    check(category + ' 本地筛选紧邻站内仅看自选右侧', nativeLabel.nextSibling === localLabel);
    check(category + ' 本地筛选使用独立原生复选框', local.type === 'checkbox'
      && !local.hasAttribute('name') && !local.hasAttribute('onclick')
      && getComputedStyle(localLabel).fontSize === getComputedStyle(nativeLabel).fontSize);
    check(category + ' 每行只注入一个本地按钮', items.every((item) => item.btn));
    siteSelectedItems.push(...items.filter((item) => item.op.querySelector('a[href*="delOwnedQd"]')));
    check(category + ' 操作列扩宽且按钮不重叠越界', items.every((item) => {
      const cell = item.op.getBoundingClientRect();
      const site = item.op.querySelector('a:not(.jd-local-btn)').getBoundingClientRect();
      const localRect = item.btn.getBoundingClientRect();
      return cell.width >= 45.5 && localRect.left - site.right >= 5.5 && localRect.right <= cell.right + 0.5;
    }));
    check(category + ' 本地图标保持 13×13px', items.every((item) => {
      const rect = item.icon.getBoundingClientRect();
      return Math.abs(rect.width - 13) < 0.6 && Math.abs(rect.height - 13) < 0.6;
    }));
  }
  check('站内已自选行仍保留独立本地按钮', siteSelectedItems.length > 0
    && siteSelectedItems.every((item) => item.btn), '已检查 ' + siteSelectedItems.length + ' 行');

  const selected = [];
  for (const category of Object.keys(config)) {
    const candidate = rows(category).map((tr) => info(category, tr)).find((item) => item.glyph === PLUS);
    if (!candidate) throw new Error(category + ' 没有可用于验收的未选记录');
    check(category + ' 未选按钮为橙色 +', getComputedStyle(candidate.icon).color === PLUS_RGB);
    candidate.btn.click();
    await waitFor(() => info(category, candidate.tr).glyph === MINUS, category + ' 加入本地自选超时');
    check(category + ' 加入后为红色 - 且名称标红', getComputedStyle(candidate.icon).color === RED_RGB
      && getComputedStyle(candidate.name).color === RED_RGB);
    selected.push({ category, code: candidate.code });
  }

  const europeFilter = table('europe').querySelector('input.jd-local-filter');
  const commodityFilter = table('commodity').querySelector('input.jd-local-filter');
  europeFilter.click();
  await waitFor(() => europeFilter.checked && rows('europe').some((tr) => tr.classList.contains('jd-local-filter-hidden')),
    '欧美本地筛选开启超时');
  check('开启欧美筛选只隐藏欧美非自选行', rows('europe').filter((tr) => !tr.classList.contains('jd-local-filter-hidden'))
    .every((tr) => info('europe', tr).glyph === MINUS));
  check('欧美筛选不影响商品表', commodityFilter.checked === false
    && rows('commodity').every((tr) => !tr.classList.contains('jd-local-filter-hidden')));

  return { checks, records: selected };
})()
`;

function phaseTwoExpression(records) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const RED_RGB = ${JSON.stringify(RED_RGB)};
    const records = ${JSON.stringify(records)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const ids = { europe: 'flex_qdiie', commodity: 'flex_qdiic', asia: 'flex_qdiia' };
    const table = (category) => document.getElementById(ids[category]);
    const rows = (category) => [...table(category).querySelectorAll(':scope > tbody > tr')]
      .filter((tr) => tr.children[0]?.querySelector('a[href^="/data/qdii/detail/"]')
        && tr.children[tr.children.length - 1]?.querySelector('a[href*="addOwnedQd"], a[href*="delOwnedQd"]'));
    const state = (category, code) => {
      const tr = rows(category).find((row) => row.children[0].textContent.trim() === code);
      const btn = tr && tr.querySelector('a.jd-local-btn[data-jd-kind="qdii"]');
      const icon = btn && btn.querySelector('span.jisilu-icons');
      return { tr, btn, icon, glyph: icon && icon.textContent, name: tr && tr.children[1] };
    };
    const filter = (category) => table(category).querySelector('input.jd-local-filter[data-jd-category="' + category + '"]');
    const waitFor = async (predicate, message, timeout = 20000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(message);
    };
    const removeLocal = async (category, code) => {
      const end = Date.now() + 20000;
      let clickedButton = null;
      while (Date.now() < end) {
        const current = state(category, code);
        if (current.glyph === PLUS) return true;
        if (current.glyph === MINUS && current.btn?.isConnected && current.btn !== clickedButton) {
          current.btn.click();
          clickedButton = current.btn;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('清理 ' + category + ' 测试记录超时');
    };
    await waitFor(() => records.every((item) => state(item.category, item.code).glyph), '刷新后等待欧美与商品状态恢复超时');
    check('刷新后欧美与商品记录恢复红色 - 和名称标红', records.every((item) => {
      const itemState = state(item.category, item.code);
      return itemState.glyph === MINUS && getComputedStyle(itemState.name).color === RED_RGB;
    }));
    check('页面刷新后三个本地筛选默认关闭', filter('europe').checked === false && filter('commodity').checked === false);

    filter('europe').click();
    await waitFor(() => filter('europe').checked, '刷新后开启欧美筛选超时');
    const asiaTab = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').trim() === '亚洲市场');
    asiaTab.click();
    await waitFor(() => location.hash === '#qdiia' && table('asia').getClientRects().length > 0
      && rows('asia').length > 5
      && rows('asia').every((tr) => tr.querySelector('a.jd-local-btn[data-jd-category="asia"]'))
      && filter('asia'), '切换亚洲市场并等待控件注入超时');
    check('亚洲市场只处理可见亚洲表', table('europe').getClientRects().length === 0
      && table('commodity').getClientRects().length === 0
      && table('asia').getClientRects().length > 0);
    const asiaNative = table('asia').querySelector('input[name="only_owned"]').closest('label');
    check('亚洲本地筛选紧邻站内仅看自选右侧', asiaNative.nextSibling === filter('asia').closest('label'));

    const asiaCandidate = rows('asia').map((tr) => state('asia', tr.children[0].textContent.trim()))
      .find((item) => item.glyph === PLUS);
    if (!asiaCandidate) throw new Error('亚洲市场没有可用于验收的未选记录');
    const asiaCode = asiaCandidate.tr.children[0].textContent.trim();
    asiaCandidate.btn.click();
    await waitFor(() => state('asia', asiaCode).glyph === MINUS, '亚洲记录加入超时');
    filter('asia').click();
    await waitFor(() => filter('asia').checked && rows('asia').some((tr) => tr.classList.contains('jd-local-filter-hidden')),
      '亚洲本地筛选开启超时');
    check('亚洲筛选只显示亚洲本地自选', rows('asia').filter((tr) => !tr.classList.contains('jd-local-filter-hidden'))
      .every((tr) => state('asia', tr.children[0].textContent.trim()).glyph === MINUS));

    const europeTab = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').trim() === '欧美市场');
    europeTab.click();
    await waitFor(() => location.hash === '#qdiie' && table('europe').getClientRects().length > 0, '切回欧美市场超时');
    check('三张表筛选状态相互独立并在市场切换后保持', filter('europe').checked === true
      && filter('commodity').checked === false && filter('asia').checked === true);

    filter('europe').click();
    await waitFor(() => !filter('europe').checked, '关闭欧美筛选超时');
    for (const item of records) {
      await removeLocal(item.category, item.code);
    }

    asiaTab.click();
    await waitFor(() => table('asia').getClientRects().length > 0, '清理前切换亚洲市场超时');
    filter('asia').click();
    await waitFor(() => !filter('asia').checked, '关闭亚洲筛选超时');
    await removeLocal('asia', asiaCode);
    check('三类验收测试数据已恢复', records.every((item) => state(item.category, item.code).glyph === PLUS)
      && state('asia', asiaCode).glyph === PLUS);
    return { checks, cleanupComplete: true };
  })()
  `;
}

function cleanupExpression(records) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const records = ${JSON.stringify(records)};
    const ids = { europe: 'flex_qdiie', commodity: 'flex_qdiic', asia: 'flex_qdiia' };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const switchTo = async (label, hash, category) => {
      const tab = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').trim() === label);
      if (tab) tab.click();
      const end = Date.now() + 15000;
      while (Date.now() < end && (location.hash !== hash || !document.getElementById(ids[category])?.getClientRects().length)) await wait(200);
    };
    const remove = async (category, code) => {
      const table = document.getElementById(ids[category]);
      const filter = table && table.querySelector('input.jd-local-filter[data-jd-category="' + category + '"]');
      if (filter?.checked) filter.click();
      const end = Date.now() + 15000;
      let btn;
      while (Date.now() < end) {
        const tr = [...(table?.querySelectorAll(':scope > tbody > tr') || [])]
          .find((row) => row.children[0]?.textContent.trim() === code);
        btn = tr && tr.querySelector('a.jd-local-btn[data-jd-kind="qdii"]');
        if (btn?.querySelector('span.jisilu-icons')?.textContent) break;
        await wait(200);
      }
      if (!btn) return false;
      if (btn.querySelector('span.jisilu-icons')?.textContent === MINUS) btn.click();
      const verifyEnd = Date.now() + 15000;
      while (Date.now() < verifyEnd) {
        const tr = [...(table?.querySelectorAll(':scope > tbody > tr') || [])]
          .find((row) => row.children[0]?.textContent.trim() === code);
        const current = tr && tr.querySelector('a.jd-local-btn[data-jd-kind="qdii"]');
        if (current?.querySelector('span.jisilu-icons')?.textContent === PLUS) return true;
        await wait(200);
      }
      return false;
    };
    const restored = [];
    await switchTo('欧美市场', '#qdiie', 'europe');
    for (const item of records.filter((item) => item.category !== 'asia')) restored.push(await remove(item.category, item.code));
    const asia = records.filter((item) => item.category === 'asia');
    if (asia.length) {
      await switchTo('亚洲市场', '#qdiia', 'asia');
      for (const item of asia) restored.push(await remove(item.category, item.code));
    }
    return restored.every(Boolean);
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
    testRecords = phaseOne.records;

    runBsk(['reload', '--session', session, '--wait-until', 'domcontentloaded', '--timeout', '30s', '--json'], { json: true });
    const phaseTwo = evaluate(session, phaseTwoExpression(testRecords));
    addChecks(phaseTwo.checks);
    cleanupComplete = phaseTwo.cleanupComplete === true;
    runBsk(['screenshot', '--session', session, '--out', SCREENSHOT_PATH, '--json'], { json: true });
    check('真实 Chrome QDII 截图已生成', fs.existsSync(SCREENSHOT_PATH), SCREENSHOT_PATH);
  } catch (error) {
    check('browser-skill QDII E2E 执行完整性', false, error.message);
  } finally {
    if (testRecords.length && !cleanupComplete && session) {
      try {
        cleanupComplete = evaluate(session, cleanupExpression(testRecords)) === true;
        check('异常路径清理 QDII 测试数据', cleanupComplete);
      } catch (error) {
        check('异常路径清理 QDII 测试数据', false, error.message);
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
  console.log(`\n===== browser-skill QDII E2E 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) process.exitCode = 1;
})();
