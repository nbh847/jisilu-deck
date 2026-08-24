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
const SCREENSHOT_PATH = '/tmp/jd-bsk-e2e.png';

const results = [];
const activeSessions = new Set();
let testCodes = [];
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
    ['evaluate', '--session', session, '--timeout', '30s', '--json', expression],
    { json: true, timeout: 45000 }
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
  check('权限只有 storage', JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), JSON.stringify(manifest.permissions));
  const contentScript = manifest.content_scripts && manifest.content_scripts[0];
  check(
    '匹配范围只有目标页',
    contentScript && JSON.stringify(contentScript.matches) === JSON.stringify([`${TARGET_URL}*`]),
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
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const rows = () => [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
    .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
  const iconOf = (btn) => btn && btn.querySelector(':scope > span.jisilu-icons');
  const rowInfo = (tr) => {
    const btn = tr.children[1].querySelector('a.jd-local-btn');
    const icon = iconOf(btn);
    const name = tr.children[3].querySelector('span');
    return {
      tr, btn, icon, name,
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
    return current.length >= 10 && current.every((tr) => tr.children[1].querySelector('a.jd-local-btn'));
  }, '等待插件按钮注入超时；请先在 chrome://extensions 重新加载 jisilu-deck');

  const all = rows().map(rowInfo);
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
  first.btn.click();
  await waitFor(() => rowInfo(first.tr).glyph === MINUS, '第一条记录加入本地自选超时');
  const watchedFirst = rowInfo(first.tr);
  check('加入后复用原站 - 字形和红色', watchedFirst.glyph === MINUS && watchedFirst.color === RED_RGB, watchedFirst.color || 'no color');
  check('加入后名称与 - 同红', watchedFirst.nameColor === RED_RGB && watchedFirst.nameInline === RED_RGB, watchedFirst.nameColor || 'no color');
  check('代码字段颜色不变', getComputedStyle(first.tr.children[2].querySelector('a')).color === firstCodeColor);

  second.btn.click();
  await waitFor(() => rowInfo(second.tr).glyph === MINUS, '第二条记录加入本地自选超时');
  check('两条测试记录可独立加入', rowInfo(first.tr).glyph === MINUS && rowInfo(second.tr).glyph === MINUS);

  return { checks, codes: [first.code, second.code] };
})()
`;

function phaseTwoExpression(codes) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const RED_RGB = ${JSON.stringify(RED_RGB)};
    const codes = ${JSON.stringify(codes)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const rows = () => [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
      .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
    const find = (code) => rows().find((tr) => (tr.children[2].innerText || '').trim() === code);
    const state = (code) => {
      const tr = find(code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      const name = tr && tr.children[3].querySelector('span');
      return { tr, btn, glyph: icon && icon.textContent, name, nameColor: name && getComputedStyle(name).color, nameInline: name && name.style.color };
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
    await waitFor(() => codes.every((code) => state(code).glyph), '刷新后等待插件状态恢复超时');
    check('页面刷新后两条记录恢复红色 - 与名称标红', codes.every((code) => {
      const item = state(code);
      return item.glyph === MINUS && item.nameColor === RED_RGB && item.nameInline === RED_RGB;
    }));

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
    } else {
      check('排序重渲染场景', true, '未找到现价表头，跳过');
    }

    state(codes[0]).btn.click();
    await waitFor(() => state(codes[0]).glyph === PLUS, '移出第一条测试记录超时');
    check('移出只影响当前记录', state(codes[0]).glyph === PLUS && state(codes[0]).nameInline === '' && state(codes[1]).glyph === MINUS);
    state(codes[0]).btn.click();
    await waitFor(() => state(codes[0]).glyph === MINUS, '重新加入第一条测试记录超时');
    return { checks };
  })()
  `;
}

function restartAndCleanupExpression(codes) {
  return `
  (async () => {
    const PLUS = ${JSON.stringify(PLUS_ICON)};
    const MINUS = ${JSON.stringify(MINUS_ICON)};
    const codes = ${JSON.stringify(codes)};
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
    const rows = () => [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
      .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
    const state = (code) => {
      const tr = rows().find((row) => (row.children[2].innerText || '').trim() === code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      const name = tr && tr.children[3].querySelector('span');
      return { btn, glyph: icon && icon.textContent, nameInline: name && name.style.color };
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
    for (const code of codes) {
      const item = state(code);
      if (item.glyph === MINUS) item.btn.click();
      await waitFor(() => state(code).glyph === PLUS, '清理测试记录超时：' + code);
    }
    check('验收测试数据已恢复为初始未选状态', codes.every((code) => state(code).glyph === PLUS && state(code).nameInline === ''));
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
    const end = Date.now() + 20000;
    const state = (code) => {
      const tr = [...document.querySelectorAll('table.jsl-table-body > tbody > tr')]
        .find((row) => row.children[0] && row.children[0].classList.contains('sticky-data') && (row.children[2].innerText || '').trim() === code);
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      const icon = btn && btn.querySelector(':scope > span.jisilu-icons');
      return { btn, glyph: icon && icon.textContent };
    };
    while (Date.now() < end && !codes.every((code) => state(code).glyph)) await new Promise((resolve) => setTimeout(resolve, 200));
    for (const code of codes) {
      const item = state(code);
      if (item.glyph === MINUS) item.btn.click();
    }
    while (Date.now() < end && !codes.every((code) => state(code).glyph === PLUS)) await new Promise((resolve) => setTimeout(resolve, 200));
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

    runBsk(['reload', '--session', session, '--wait-until', 'domcontentloaded', '--timeout', '30s', '--json'], { json: true });
    const phaseTwo = evaluate(session, phaseTwoExpression(testCodes));
    addChecks(phaseTwo.checks);
    runBsk(['screenshot', '--session', session, '--out', SCREENSHOT_PATH, '--json'], { json: true });
    check('真实 Chrome 截图已生成', fs.existsSync(SCREENSHOT_PATH), SCREENSHOT_PATH);
    stopSession(session);
    session = null;

    session = startSession();
    navigate(session);
    const restarted = evaluate(session, restartAndCleanupExpression(testCodes));
    addChecks(restarted.checks);
    cleanupComplete = restarted.cleanupComplete === true;
  } catch (error) {
    check('browser-skill E2E 执行完整性', false, error.message);
  } finally {
    if (testCodes.length && !cleanupComplete) {
      try {
        if (!session) {
          session = startSession();
          navigate(session);
        }
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
