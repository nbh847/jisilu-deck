// jisilu-deck 第一版 E2E 验收：对应 docs/architecture/validation-plan.md 全部场景
// 运行方式（需有 playwright 环境的目录，例如 playwright-skill）：
//   cd <playwright-skill 目录> && node run.js <本仓库>/test/e2e-cb-list.js
// 断言的颜色常量与 src/content/page-adapter.js 保持一致，改色时需同步。
const { chromium } = require('playwright');
const fs = require('fs');

// 注意：经 playwright-skill 的 run.js 执行时脚本会被复制到 skill 目录，__dirname 不可用，
// 因此扩展路径用环境变量 JD_EXT_PATH 覆盖，默认本仓库绝对路径。
const EXT_PATH = process.env.JD_EXT_PATH || '/Users/mac/workspace/jisilu-deck';
const TARGET_URL = 'https://www.jisilu.cn/web/data/cb/list';
const PROFILE_DIR = '/tmp/jd-e2e-profile';

const PLUS_RGB = 'rgb(230, 126, 34)';   // #e67e22
const RED_RGB = 'rgb(231, 76, 60)';     // #e74c3c
const NAME_DEFAULT_RGB = 'rgb(61, 61, 61)';
const SITE_LINK_BLUE = 'rgb(32, 103, 152)';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' | ' + detail : ''));
};

async function launch() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
}

async function waitForInjectedButtons(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll('table.jsl-table-body > tbody > tr'))
        .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'));
      return rows.length >= 10 && rows.every((tr) => tr.children[1] && tr.children[1].querySelector('a.jd-local-btn'));
    },
    { timeout }
  );
}

async function rowsInfo(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('table.jsl-table-body > tbody > tr'))
      .filter((tr) => tr.children[0] && tr.children[0].classList.contains('sticky-data'))
      .map((tr) => {
        const btn = tr.children[1].querySelector('a.jd-local-btn');
        const nameSpan = tr.children[3].querySelector('span');
        return {
          code: (tr.children[2].innerText || '').trim(),
          btnText: btn ? btn.textContent.trim() : null,
          btnColor: btn ? getComputedStyle(btn).color : null,
          btnTitle: btn ? btn.getAttribute('title') : null,
          nameInlineColor: nameSpan ? nameSpan.style.color : null,
          nameColor: nameSpan ? getComputedStyle(nameSpan).color : null,
          opTdWidth: tr.children[1].getBoundingClientRect().width,
          btnCount: tr.children[1].querySelectorAll('a.jd-local-btn').length,
        };
      });
  });
}

async function rowByCode(page, code) {
  const all = await rowsInfo(page);
  return all.find((r) => r.code === code) || null;
}

(async () => {
  // ===== 0. 静态检查：Manifest 最小权限 =====
  try {
    const manifest = JSON.parse(fs.readFileSync(EXT_PATH + '/manifest.json', 'utf8'));
    check('manifest 为 MV3', manifest.manifest_version === 3);
    check('权限只有 storage', JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), JSON.stringify(manifest.permissions));
    const cs = manifest.content_scripts && manifest.content_scripts[0];
    check('匹配范围只有目标页', cs && JSON.stringify(cs.matches) === JSON.stringify(['https://www.jisilu.cn/web/data/cb/list*']), JSON.stringify((cs && cs.matches) || null));
    check('注入脚本文件存在', cs.js.every((f) => fs.existsSync(EXT_PATH + '/' + f)), cs.js.join(','));
  } catch (e) {
    check('manifest.json 可读', false, e.message);
  }

  const context = await launch();
  let extensionRequests = 0;
  context.on('request', (req) => {
    const initiator = (req.headers() && (req.headers().origin || req.headers().initiator)) || '';
    if (initiator.includes('chrome-extension://')) extensionRequests++;
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    // ===== 1. 注入：每条数据行一个本地按钮 =====
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let injected = true;
    try { await waitForInjectedButtons(page); } catch (e) { injected = false; }
    check('每条数据行注入且只有一个 jd-local-btn', injected);

    const rows = await rowsInfo(page);
    check('数据行数 >= 20', rows.length >= 20, 'rows=' + rows.length);
    check('操作列宽保持 32px', rows.every((r) => Math.abs(r.opTdWidth - 32) < 0.6), 'sample=' + (rows[0] && rows[0].opTdWidth));
    check('按钮数全部为 1（无重复注入）', rows.every((r) => r.btnCount === 1));

    // 原按钮未被改动
    const origOk = await page.evaluate(() => {
      const tr = document.querySelector('table.jsl-table-body > tbody tr');
      const a = tr.children[1].querySelector('a[title^="加["]');
      if (!a) return false;
      const cs = getComputedStyle(a);
      return cs.color === 'rgb(32, 103, 152)' && a.querySelector('.jisilu-icons') !== null;
    });
    check('集思录原 + 按钮颜色与图标未改动', origOk);

    // 几何：不覆盖原按钮（原按钮 right <= 我们 left）
    const geom = await page.evaluate(() => {
      const tr = document.querySelector('table.jsl-table-body > tbody tr');
      const td = tr.children[1];
      const orig = td.querySelector('a[title^="加["]');
      const mine = td.querySelector('a.jd-local-btn');
      const or = orig.getBoundingClientRect(), mr = mine.getBoundingClientRect(), dr = td.getBoundingClientRect();
      return { origRight: or.right, myLeft: mr.left, myRight: mr.right, tdRight: dr.right, myW: mr.width, myH: mr.height };
    });
    check('本地按钮不覆盖原按钮', geom.myLeft >= geom.origRight - 0.5, JSON.stringify({ origRight: +geom.origRight.toFixed(1), myLeft: +geom.myLeft.toFixed(1) }));
    check('本地按钮不超出操作格', geom.myRight <= geom.tdRight + 0.5, `myRight=${geom.myRight.toFixed(1)} tdRight=${geom.tdRight.toFixed(1)}`);

    // ===== 2. 目标行初始状态（未加入） =====
    const first = rows[0], second = rows[1];
    const code1 = first.code, code2 = second.code;
    check('初始为橙色 +', first.btnText === '+' && first.btnColor === PLUS_RGB, `${first.btnText} ${first.btnColor}`);
    check('初始名称保持页面原色', first.nameColor === NAME_DEFAULT_RGB && first.nameInlineColor === '');

    // ===== 3. 点击 + ：加入本地自选 =====
    await page.click(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code1}"]) a.jd-local-btn`);
    await page.waitForFunction(
      (code) => {
        const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
        const tr = a && a.closest('tr');
        const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
        return btn && btn.textContent.trim() === '-';
      },
      code1, { timeout: 10000 }
    );
    const r1 = await rowByCode(page, code1);
    check('保存成功后切换为红色 -', r1.btnText === '-' && r1.btnColor === RED_RGB, `${r1.btnText} ${r1.btnColor}`);
    check('悬浮提示为「从本地自选移出[名称]」', r1.btnTitle === `从本地自选移出[${await bondName(page, code1)}]`, r1.btnTitle);

    // 名称变红且与 - 同色；代码与其他字段样式不变
    const cellColors = await page.evaluate((code) => {
      const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
      const tr = a.closest('tr');
      return {
        nameInline: tr.children[3].querySelector('span').style.color,
        nameComputed: getComputedStyle(tr.children[3].querySelector('span')).color,
        codeColor: getComputedStyle(tr.children[2].querySelector('a')).color,
        priceColor: getComputedStyle(tr.children[4].querySelector('span') || tr.children[4]),
      };
    }, code1);
    check('已加入行名称与本地 - 同为红色', cellColors.nameComputed === RED_RGB && cellColors.nameInline === RED_RGB, cellColors.nameComputed);
    check('代码字段颜色不变', cellColors.codeColor === SITE_LINK_BLUE, cellColors.codeColor);

    // ===== 4. 第二行加入：互不影响 =====
    await page.click(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code2}"]) a.jd-local-btn`);
    await page.waitForFunction((code) => {
      const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
      const tr = a && a.closest('tr');
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      return btn && btn.textContent.trim() === '-';
    }, code2, { timeout: 10000 });
    const both = await rowsInfo(page);
    const watched1 = both.find((r) => r.code === code1), watched2 = both.find((r) => r.code === code2);
    check('两行均加入且名称均标红', watched1.btnText === '-' && watched2.btnText === '-' && watched1.nameColor === RED_RGB && watched2.nameColor === RED_RGB);
    check('其余行保持 + 且名称未被插件改动（无内联色）', both.filter((r) => r.code !== code1 && r.code !== code2).every((r) => r.btnText === '+' && r.nameInlineColor === ''));

    // ===== 5. 点击 - ：只移出当前行 =====
    await page.click(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code1}"]) a.jd-local-btn`);
    await page.waitForFunction((code) => {
      const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
      const tr = a && a.closest('tr');
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      return btn && btn.textContent.trim() === '+';
    }, code1, { timeout: 10000 });
    const afterRemove = await rowsInfo(page);
    const removed = afterRemove.find((r) => r.code === code1), kept = afterRemove.find((r) => r.code === code2);
    check('移出后恢复橙色 + 且名称恢复原色', removed.btnText === '+' && removed.btnColor === PLUS_RGB && removed.nameColor === NAME_DEFAULT_RGB && removed.nameInlineColor === '');
    check('移出只影响当前行（另一行仍 -）', kept.btnText === '-' && kept.nameColor === RED_RGB);

    // 重新加入第一行，供后续持久化验证
    await page.click(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code1}"]) a.jd-local-btn`);
    await page.waitForFunction((code) => {
      const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
      const tr = a && a.closest('tr');
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      return btn && btn.textContent.trim() === '-';
    }, code1, { timeout: 10000 });

    // ===== 6. 页面刷新后状态恢复 =====
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForInjectedButtons(page);
    const reloaded = await rowsInfo(page);
    const rl1 = reloaded.find((r) => r.code === code1), rl2 = reloaded.find((r) => r.code === code2);
    check('页面刷新后两行均恢复红色 - 与名称标红', rl1 && rl2 && rl1.btnText === '-' && rl2.btnText === '-' && rl1.nameColor === RED_RGB && rl2.nameColor === RED_RGB);
    check('刷新后未加入行仍为 + 且无重复按钮', reloaded.every((r) => r.btnCount === 1) && reloaded.filter((r) => r.code !== code1 && r.code !== code2).every((r) => r.btnText === '+'));
    check('刷新后操作列宽仍为 32px', reloaded.every((r) => Math.abs(r.opTdWidth - 32) < 0.6));

    // ===== 7. 表格重渲染（点击表头排序）后不重复、状态正确 =====
    const sorted = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('.jsl-table-header th'));
      const th = ths.find((h) => (h.innerText || '').trim() === '现价');
      if (!th) return false;
      th.click();
      return true;
    });
    if (sorted) {
      await page.waitForTimeout(800);
      await waitForInjectedButtons(page);
      const resorted = await rowsInfo(page);
      const s1 = resorted.find((r) => r.code === code1), s2 = resorted.find((r) => r.code === code2);
      check('排序重渲染后每行仍只有一个按钮', resorted.every((r) => r.btnCount === 1));
      check('排序重渲染后已选状态与名称红色恢复', s1 && s2 && s1.btnText === '-' && s2.btnText === '-' && s1.nameColor === RED_RGB && s2.nameColor === RED_RGB);
    } else {
      check('排序重渲染场景（未找到现价表头，跳过）', true, 'skipped');
    }

    // ===== 8. 截图留档 =====
    const shotRow = await page.$(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code2}"])`);
    if (shotRow) await shotRow.screenshot({ path: '/tmp/jd-e2e-watched-row.png' });
    await page.screenshot({ path: '/tmp/jd-e2e-full.png', fullPage: false });

    // 移出第一行后再重启验证（只保留第二行）
    await page.click(`table.jsl-table-body > tbody tr:has(a[href="/data/convert_bond_detail/${code1}"]) a.jd-local-btn`);
    await page.waitForFunction((code) => {
      const a = document.querySelector(`a[href="/data/convert_bond_detail/${code}"]`);
      const tr = a && a.closest('tr');
      const btn = tr && tr.children[1].querySelector('a.jd-local-btn');
      return btn && btn.textContent.trim() === '+';
    }, code1, { timeout: 10000 });

    // ===== 9. 浏览器重启后状态恢复 =====
    await context.close();
    const context2 = await launch();
    const page2 = context2.pages()[0] || (await context2.newPage());
    context2.on('request', (req) => {
      const initiator = (req.headers() && (req.headers().origin || req.headers().initiator)) || '';
      if (initiator.includes('chrome-extension://')) extensionRequests++;
    });
    await page2.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForInjectedButtons(page2);
    const restarted = await rowsInfo(page2);
    const rs1 = restarted.find((r) => r.code === code1), rs2 = restarted.find((r) => r.code === code2);
    check('浏览器重启后：已移出行恢复 +', rs1 && rs1.btnText === '+' && rs1.nameColor === NAME_DEFAULT_RGB);
    check('浏览器重启后：未移出行保持红色 - 与名称标红', rs2 && rs2.btnText === '-' && rs2.nameColor === RED_RGB);

    // ===== 10. 插件不主动请求任何接口 =====
    check('全程无 chrome-extension:// 发起的请求', extensionRequests === 0, 'count=' + extensionRequests);

    await context2.close();
  } catch (e) {
    check('E2E 执行完整性', false, e.message);
    try { await context.close(); } catch (_) {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== E2E 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { console.log('失败项：\n' + failed.map((f) => ' - ' + f.name + ' | ' + f.detail).join('\n')); process.exitCode = 1; }
})();

async function bondName(page, code) {
  return page.evaluate((c) => {
    const a = document.querySelector(`a[href="/data/convert_bond_detail/${c}"]`);
    return (a.closest('tr').children[3].innerText || '').trim();
  }, code);
}
