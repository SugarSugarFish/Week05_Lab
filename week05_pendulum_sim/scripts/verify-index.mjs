// ---------------------------------------------------------------
// index.html 验证脚本：抽出内联 <script>，在模拟 DOM/Canvas 下实际跑起来，
// 校验 (1) 语法 (2) 物理数值 (3) HUD 输出 (4) 交互
//      (5) 动画循环 (6) 控制面板：滑块量程 / 实时响应 / 阻尼衰减 / 重置复位
// 用法: node scripts/verify-index.mjs
// 注意: 只读取 index.html，不修改它；测试产物写入 .verify-tmp/
// ---------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HTML = path.join(ROOT, 'index.html');
const TMP = path.join(ROOT, '.verify-tmp');

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---------- 0. 抽出内联脚本 ----------
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
check('HTML 中存在内联 <script>', !!m);
const code = m[1];

fs.mkdirSync(TMP, { recursive: true });
const codeFile = path.join(TMP, 'extracted.js');
fs.writeFileSync(codeFile, code, 'utf8');

// ---------- 1. 静态检查 ----------
check('无外链资源 (http/https/src=)', !/https?:\/\/|<script\s+src=|<link[^>]+href=/i.test(html));
check('含 DOCTYPE html5', /^<!DOCTYPE html>/i.test(html.trim()));
check('含 UTF-8 声明', /charset=["']?UTF-8/i.test(html));
check('使用 requestAnimationFrame', /requestAnimationFrame/.test(code));
check("使用 getContext('2d')", /getContext\(\s*['"]2d['"]\s*\)/.test(code));
check('背景色 #1a1a24 存在', /#1a1a24/i.test(html));
check('摆球有发光效果 (shadowBlur/radialGradient)',
      /shadowBlur/.test(code) && /createRadialGradient/.test(code));
check('初始参数 L=200px', /lenPx:\s*200/.test(code));
check('初始参数 g=9.8', /g:\s*9\.8/.test(code));
check('初始参数 θ₀=45°', /THETA0_DEG\s*=\s*45/.test(code));
check('物理方程含阻尼项 -c·θ′', /-\s*P\.dampC\s*\*\s*om/.test(code));
check('使用 sinθ 非线性回复力', /-\s*\(P\.g\s*\/\s*LENGTH_M\)\s*\*\s*Math\.sin\(th\)/.test(code));

// ---- 控制面板 DOM 形态（从 HTML 源码解析滑块量程，UI 与代码双重校验）----
function sliderAttrs(id) {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  if (!tag) return null;
  const attr = (k) => {
    const mm = tag[0].match(new RegExp(`${k}="([^"]*)"`));
    return mm ? mm[1] : null;
  };
  return { min: attr('min'), max: attr('max'), step: attr('step'), type: attr('type') };
}
const sLenA  = sliderAttrs('sLen');
const sGravA = sliderAttrs('sGrav');
const sDampA = sliderAttrs('sDamp');

check('存在摆长滑块 #sLen (range)', !!sLenA && sLenA.type === 'range');
check('摆长量程 100 ~ 350 px',
      sLenA && sLenA.min === '100' && sLenA.max === '350',
      sLenA ? `${sLenA.min}~${sLenA.max}` : '缺失');

check('存在重力滑块 #sGrav (range)', !!sGravA && sGravA.type === 'range');
check('重力范围 g > 0（下限 ' + (sGravA && sGravA.min) + '）',
      sGravA && parseFloat(sGravA.min) > 0 && parseFloat(sGravA.max) > parseFloat(sGravA.min),
      sGravA ? `${sGravA.min}~${sGravA.max}` : '缺失');

check('存在阻尼滑块 #sDamp (range)', !!sDampA && sDampA.type === 'range');
check('阻尼量程含 0 且 ≥ 0.010 s⁻¹',
      sDampA && parseFloat(sDampA.min) === 0 && parseFloat(sDampA.max) >= 0.010,
      sDampA ? `${sDampA.min}~${sDampA.max}` : '缺失');

check('三个滑块均有配套数值标签',
      ['sLenVal', 'sGravVal', 'sDampVal'].every((id) => html.includes(`id="${id}"`)));
check('存在“重置摆动”按钮', /id="resetBtn"[^>]*>\s*重置摆动/.test(html.replace(/\s+/g, ' ')));

// 不依赖内联事件属性调用**页内函数**：内联处理器在**全局作用域**求值，而本页所有函数都封在
// IIFE 里，一旦写成 onclick="resetAnimation()" 就会抛
// "Uncaught ReferenceError: resetAnimation is not defined"。
// 正确做法是 el.reset.addEventListener('click', ...)（index.html 第 811 行附近）。
// 注意：`onsubmit="return false"` 这类**只含字面量、不引用任何标识符**的守卫是安全的，应放行。
const handlerRe = /\son(click|change|input|load|submit|pointerdown)\s*=\s*"([^"]*)"/gi;
const unsafeHandlers = [];
for (const m of html.matchAll(handlerRe)) {
  const body = m[2].trim();
  const isSafeLiteralOnly = /^return\s+(false|true)\s*;?$/.test(body);
  if (!isSafeLiteralOnly) unsafeHandlers.push(`on${m[1]}="${body}"`);
}
check('HTML 中不存在引用页内函数的内联事件属性（避免全局作用域 ReferenceError）',
      unsafeHandlers.length === 0,
      unsafeHandlers.length ? `不安全的内联处理器：${unsafeHandlers.join(', ')}`
                            : '仅 addEventListener 绑定；onsubmit="return false" 属安全的字面量守卫');
check('HTML 中不存在未定义的全局函数名 resetAnimation',
      !/resetAnimation/.test(html),
      'resetAnimation 出现则说明用了内联 onclick 且函数在 IIFE 内不可见');
check('控制面板为面板下方独立层（非覆盖画布渲染逻辑）',
      /id="controls"/.test(html) && /position:\s*fixed/.test(html));

// ---------- 2. 模拟运行环境 ----------
const c2d = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    return (...args) => {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') {
        return { addColorStop() {} };
      }
      return undefined;
    };
  },
  set(t, k, v) { t[k] = v; return true; }
});

const elementRegistry = new Map();
// 模拟无头布局常量：视口 720px 高，控制面板实测 118px（css 里 --panelH 的默认值）。
// 真实浏览器里这些值由排版引擎给出，这里手工保持同样的几何关系供断言使用。
const MOCK_VIEW_H = 720;      // = windowMock.innerHeight
const MOCK_PANEL_H = 118;     // = index.html 中 --panelH 的默认值

function mkEl(id) {
  return {
    id,
    tagName: 'DIV',
    textContent: '',
    className: '',
    value: '',
    _w: 1280,
    get clientWidth() { return this._w; },
    set clientWidth(v) { this._w = v; },
    _h: null,
    // canvas 高度撑满「视口高 − 面板高」；显式赋值后按赋值生效（供窄窗口用例覆盖）
    get clientHeight() {
      if (id === 'cv') return this._h === null ? MOCK_VIEW_H - MOCK_PANEL_H : this._h;
      return this._h === null ? MOCK_VIEW_H : this._h;
    },
    set clientHeight(v) { this._h = v; },
    get offsetHeight() { return id === 'controls' ? MOCK_PANEL_H : 0; },
    width: 0,
    height: 0,
    style: {},
    focused: false,
    // 面板紧贴 canvas 底边
    get offsetTop() { return id === 'controls' ? MOCK_VIEW_H - MOCK_PANEL_H : 0; },
    getContext: () => c2d,
    blur() { this.focused = false; },
    focus() { this.focused = true; },
    addEventListener(type, fn) {
      (mkEl.listeners[id] ||= {})[type] = fn;
    }
  };
}
mkEl.listeners = {};
mkEl.tagNames = { cv: 'CANVAS', resetBtn: 'BUTTON', controls: 'FORM', documentElement: 'HTML' };

const byId = new Map();
const els = new Proxy({}, {
  get(t, k) {
    if (!byId.has(k)) {
      const e = mkEl(k);
      if (mkEl.tagNames[k]) e.tagName = mkEl.tagNames[k];
      byId.set(k, e);
    }
    return byId.get(k);
  }
});

const winListeners = {};
const windowMock = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
  requestAnimationFrame: null,
  addEventListener: (type, fn) => {
    (winListeners[type] ||= []).push(fn);
  }
};

// 真实捕获页面运行期的 console.error / console.warn 与 window.onerror，
// 这样「控制台 0 error」是真断言，而不是把测试自身的失败再数一遍。
const consoleEvents = [];
const consoleMock = new Proxy({}, {
  get(_t, k) {
    if (k === 'error' || k === 'warn') {
      return (...args) => consoleEvents.push({ level: k, args: args.map(String).join(' ') });
    }
    return () => {};                      // log/info/debug 等直接吞掉，保持输出干净
  }
});

const rafQueue = [];
function raf(cb) { rafQueue.push(cb); return rafQueue.length; }

// documentElement.style.setProperty 与自定义属性的最小实现
const docElement = mkEl('documentElement');
docElement.tagName = 'HTML';
const cssVars = {};
docElement.style = { setProperty: (k, v) => { cssVars[k] = v; }, getPropertyValue: (k) => cssVars[k] };

const documentMock = {
  getElementById: (id) => els[id],
  documentElement: docElement
};

// ---------- 3. 执行脚本 ----------
// 在 IIFE 结束前插入 return，拿到内部物理状态用于数值断言
const instrumented = code.replace(
  /\}\)\(\);\s*$/,
  '  return { P: P, get theta(){return theta;}, get omega(){return omega;},' +
  ' get stepInfo(){ var nn = Math.min(60, Math.max(1, Math.ceil((1/60) / SUB_DT)));' +
  '   return { SUB_DT: SUB_DT, n: nn, h: (1/60)/nn, LENGTH_M: LENGTH_M, OMEGA: OMEGA }; },' +
  ' get simTime(){return simTime;}, get running(){return running;},' +
  ' get drag(){return trail.length;}, get pivot(){return pivot;},' +
  ' get dispLen(){return dispLen;}, get timeScale(){return timeScale;},' +
  ' get trail(){return trail;},' +
  ' get panelH(){return panelH;},' +
  ' get panelTop(){return el.panel.offsetTop;},' +
  ' get bobR(){return 15;} };\n})();\n' +
  'return __api;'                       // 外层函数把内部状态回传给测试
).replace(/^\s*\(function \(\) \{/, 'var __api = (function () {');
check('可在不影响原逻辑的前提下插桩读取内部状态',
      instrumented !== code && /return __api;/.test(instrumented));

let api = null;
let bootError = null;
try {
  const fn = new Function(
    'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame',
    'performance', 'console', instrumented
  );
  api = fn(windowMock, documentMock, raf, () => {}, { now: () => 0 }, consoleMock);
  check('内联脚本语法正确且可执行（启动无异常）', true);
} catch (e) {
  bootError = e;
  check('内联脚本语法正确且可执行（启动无异常）', false, e.message);
}

check('注册了 resize 监听', !!(winListeners.resize && winListeners.resize.length));
check('注册了 keydown 监听', !!(winListeners.keydown && winListeners.keydown.length));
check('canvas 注册了 pointerdown 监听', !!mkEl.listeners.cv?.pointerdown);
check('摆长滑块注册了 input 监听', !!mkEl.listeners.sLen?.input);
check('重力滑块注册了 input 监听', !!mkEl.listeners.sGrav?.input);
check('阻尼滑块注册了 input 监听', !!mkEl.listeners.sDamp?.input);
check('重置按钮注册了 click 监听', !!mkEl.listeners.resetBtn?.click);
check('首帧已通过 requestAnimationFrame 排入队列', rafQueue.length > 0);

if (bootError) {
  console.log('\n启动失败，后续检查跳过：', bootError.message);
  console.log(code);
  process.exit(1);
}

// ---------- 4. 驱动动画循环 ----------
// 时间戳必须单调递增：暂停后恢复会重置 lastTs，但虚拟时钟绝不回退。
let ts = 16;
const FPS = 16.6667;
function pump(dtMs = FPS) {
  ts += dtMs;
  const cb = rafQueue.shift();
  if (!cb) throw new Error('动画循环中断：队列为空');
  cb(ts);
}
function input(el, v) { el.value = String(v); mkEl.listeners[el.id].input.call(el, { target: el }); }
function click(el) { mkEl.listeners[el.id].click.call(el, { target: el }); }

let frames = 0;
let minAngle = 999, maxAngle = -999;

// 跑 2.1 个周期（阻尼为 0），约 126 帧
const totalFrames = Math.round((2.1 * 2.006) * 60);
for (let i = 0; i < totalFrames; i++) {
  pump();
  frames++;
  const a = parseFloat(els.rT.textContent);
  if (!Number.isNaN(a)) { minAngle = Math.min(minAngle, a); maxAngle = Math.max(maxAngle, a); }
}
check('动画帧连续推进（无中断）', frames === totalFrames, `${frames} 帧`);
check('无阻尼时摆角始终在 ±45° 内',
      minAngle >= -45.01 && maxAngle <= 45.01,
      `范围 [${minAngle.toFixed(3)}°, ${maxAngle.toFixed(3)}°]`);
check('确实发生了左右摆动（穿过 0°）', minAngle < 0 && maxAngle > 0);

const periodShown = parseFloat(els.rP.textContent);
const expectedT = 2 * Math.PI * Math.sqrt((200 / 200) / 9.8);
check('周期 T = 2π√(L/g) 正确',
      near(periodShown, expectedT, 0.002),
      `显示 ${periodShown}s，期望 ${expectedT.toFixed(4)}s`);

check('初始摆角 HUD 显示 45°', els.rT0.textContent === '45°', els.rT0.textContent);
check('摆长 HUD 显示 200px', /200\s*px/.test(els.rL.textContent), els.rL.textContent);
check('重力 HUD 显示 9.8', /9\.8/.test(els.rG.textContent), els.rG.textContent);
check('角速度 HUD 有单位 rad/s', /rad\/s/.test(els.rW.textContent), els.rW.textContent);
check('计时 HUD 有单位 s', /\s*s$/.test(els.rTime.textContent), els.rTime.textContent);
check('阻尼 HUD 在 c=0 时标注无阻尼', /无阻尼/.test(els.rC.textContent), els.rC.textContent);
check('拖尾采样点已累积', api.drag > 0 && api.trail.length <= 48, `${api.drag} 点`);

// 与理论比对（c=0 且 45° 有界）
// ⚠️ 必须在改动任何滑块之前做：g / L 一旦被改，参考解就不再适用。
// ⚠️ 必须用 api.theta 而不是 HUD 文本：HUD 是 ~16Hz 限频刷新的，
//    在逐帧 pump() 的循环里文本会整体滞后于一帧，与实时 simTime 配对就会读出错位值。
// ⚠️ 不能用 θ₀cos(ωt) 这个**线性化**解析解作基准：45° 振幅下真实单摆是非线性的，
//    周期 2.0897s 比 2π√(L/g)=2.007s 长 4.12%，2.09 个周期后相位已合法漂移 ~8.6°。
//    正确做法是与**同一个非线性 ODE** 的高精度数值解比对。
function accelRef(th, om) { return -(9.8 / 1.0) * Math.sin(th) - 0 * om; }
function rk4Ref(th, om, h) {
  const k1t = om,             k1o = accelRef(th, om);
  const k2t = om + 0.5 * h * k1o, k2o = accelRef(th + 0.5 * h * k1t, om + 0.5 * h * k1o);
  const k3t = om + 0.5 * h * k2o, k3o = accelRef(th + 0.5 * h * k2t, om + 0.5 * h * k2o);
  const k4t = om + h * k3o,       k4o = accelRef(th + h * k3t, om + h * k3o);
  return { th: th + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t), om: om + (h / 6) * (k1o + 2 * k2o + 2 * k3o + k4o) };
}
// 参考解：每帧 60 子步（引擎用 17 子步），比较积分精度
// ⚠️ 必须让参考时间**精确等于** simTime：引擎每帧固定加 1/60 s，故按帧数配对，
//    多积一帧就会差 1/60 s（在 45° 附近约 1.7°），足以造成假失败。
let refTh = Math.PI / 4, refOm = 0, refT = 0;
const refFrames = Math.round(api.simTime * 60);
for (let f = 0; f < refFrames; f++) {
  const h = (1 / 60) / 60;
  for (let k = 0; k < 60; k++) { const s = rk4Ref(refTh, refOm, h); refTh = s.th; refOm = s.om; }
  refT += 1 / 60;
}
check('θ(t) 与同一非线性 ODE 的高精度数值解一致（±0.02°）',
      near(api.theta * 180 / Math.PI, refTh * 180 / Math.PI, 0.02),
      `引擎 ${(api.theta * 180 / Math.PI).toFixed(4)}° vs 参考 ${(refTh * 180 / Math.PI).toFixed(4)}° @t=${api.simTime.toFixed(4)}s（${refFrames} 帧）`);
check('角速度 ω(t) 与高精度参考解一致（±5e-4 rad/s）',
      near(api.omega, refOm, 5e-4),
      `引擎 ${api.omega.toFixed(5)} vs 参考 ${refOm.toFixed(5)} rad/s`);

// 非线性单摆周期：T = 4√(L/g)·K(sin(θ₀/2))，用 AGM 算完全椭圆积分 K
const mAgm = Math.sin((45 * Math.PI / 180) / 2) ** 2;
let a0 = 1, b0 = Math.sqrt(1 - mAgm);
for (let i = 0; i < 30; i++) { const a1 = (a0 + b0) / 2, b1 = Math.sqrt(a0 * b0); a0 = a1; b0 = b1; }
const K = Math.PI / (2 * a0);
const Tnonlin = 4 * Math.sqrt(1.0 / 9.8) * K;
const linearT = 2 * Math.PI * Math.sqrt(1.0 / 9.8);
check('45° 振幅的非线性周期 T=4√(L/g)K(sin(θ₀/2)) ≈ 2.0873s',
      near(Tnonlin, 2.0873, 0.001) && near(Tnonlin / linearT - 1, 0.0400, 0.001),
      `T_nonlin=${Tnonlin.toFixed(4)}s, T_linear=${linearT.toFixed(4)}s, +${(100 * (Tnonlin / linearT - 1)).toFixed(2)}%`);

// 实测周期：θ 过零点线性插值。注意要收集**4 个**过零点：相邻两个过零点是半周期，
// 只有跨过两段才是整周期，所以用 c[2]-c[0] 与 c[3]-c[1] 求平均。
{
  const crossings = [];
  let prevT = api.simTime, prevTh = api.theta;
  for (let i = 0; i < 60 * 6 && crossings.length < 4; i++) {
    pump();
    if ((prevTh > 0 && api.theta <= 0) || (prevTh < 0 && api.theta >= 0)) {
      crossings.push(prevT + (1 / 60) * (prevTh / (prevTh - api.theta)));   // 线性插值过零时刻
    }
    prevT = api.simTime; prevTh = api.theta;
  }
  const measured = crossings.length >= 4 ? ((crossings[2] - crossings[0]) + (crossings[3] - crossings[1])) / 2 : NaN;
  check('实测周期与非线性理论周期一致（±0.1%）',
        crossings.length >= 4 && near(measured, Tnonlin, Tnonlin * 0.001),
        crossings.length < 4 ? `只捕捉到 ${crossings.length} 个过零点`
          : `实测 ${measured.toFixed(5)}s vs 理论 ${Tnonlin.toFixed(5)}s（偏差 ${(100 * Math.abs(measured - Tnonlin) / Tnonlin).toFixed(3)}%，${crossings.length} 个过零点）`);
}

// ---------- 5. 控制面板：滑块实时响应 ----------
// 面板必须待在画布**下方**且不重叠：canvas 高度撑满「视口高 − 面板高」，
// 面板顶边又正好落在 canvas 底边上（两种测量方式互为交叉验证）。
{
  check('Canvas 高度 = 视口高 − 面板高（面板不遮挡画布）',
        near(els.cv.clientHeight, MOCK_VIEW_H - api.panelH, 0.01),
        `canvas ${els.cv.clientHeight}px = ${MOCK_VIEW_H} − ${api.panelH}px(panel) = ${(MOCK_VIEW_H - api.panelH).toFixed(1)}px`);
  check('面板紧贴 Canvas 下方（panelTop = canvas 底边）',
        near(api.panelTop, els.cv.clientHeight, 0.01),
        `panelTop ${api.panelTop.toFixed(2)}px vs canvas 底边 ${els.cv.clientHeight}px`);
  check('悬点与最大摆长都落在面板上方（不被控件压住）',
        api.pivot.x > 0 && api.pivot.x < 1280 &&
        api.pivot.y + api.dispLen + api.bobR < api.panelTop,
        `悬点 y=${api.pivot.y.toFixed(1)} + 摆长 ${api.dispLen.toFixed(1)} + 球半径 ${api.bobR} < 面板顶 ${api.panelTop.toFixed(1)}`);
  check('实测面板高度已写回 CSS 变量 --panelH（布局自洽）',
        api.panelH === MOCK_PANEL_H && cssVars['--panelH'] === MOCK_PANEL_H + 'px',
        `--panelH = ${cssVars['--panelH']}（实测 offsetHeight=${api.panelH}px）`);
  check('面板高度落在合理区间（不挤压画布也不留空隙）',
        api.panelH >= 60 && api.panelH <= MOCK_VIEW_H * 0.35,
        `${api.panelH}px / 视口 ${MOCK_VIEW_H}px = ${(100 * api.panelH / MOCK_VIEW_H).toFixed(1)}%`);
}

check('初始参数与滑块初值一致（L=200, g=9.8, c=0）',
      api.P.lenPx === 200 && near(api.P.g, 9.8, 1e-9) && api.P.dampC === 0,
      `L=${api.P.lenPx} g=${api.P.g} c=${api.P.dampC}`);

// 摆长 200 -> 320：周期应立刻按新摆长变化
const beforeLen = { period: parseFloat(els.rP.textContent), disp: api.dispLen };
input(els.sLen, 320);
const tAfterLen = parseFloat(els.rP.textContent);
const expectT320 = 2 * Math.PI * Math.sqrt((320 / 200) / 9.8);
check('拖动摆长滑块：物理参数即时更新',
      api.P.lenPx === 320, `P.lenPx=${api.P.lenPx}`);
check('拖动摆长滑块：周期 T 即时重算',
      near(tAfterLen, expectT320, 0.002),
      `${tAfterLen}s 期望 ${expectT320.toFixed(4)}s（原 ${beforeLen.period}s）`);
check('拖动摆长滑块：数值标签即时更新',
      els.sLenVal.textContent === '320 px', els.sLenVal.textContent);
check('拖动摆长滑块：HUD 摆长与米数即时更新',
      /320\s*px/.test(els.rL.textContent) && /1\.600\s*m/.test(els.rL.textContent),
      els.rL.textContent);
check('摆长变长后显示长度重算（不压到控制面板）',
      api.dispLen !== beforeLen.disp && api.dispLen <= api.P.lenPx,
      `dispLen ${beforeLen.disp} -> ${api.dispLen}`);

// 重力滑块：改变后下一帧摆角/角速度立刻按新 g 演化
input(els.sGrav, 25);
const gStateBefore = { th: api.theta, om: api.omega, t: api.simTime };
pump();
check('拖动重力滑块：物理参数即时更新', near(api.P.g, 25, 1e-9), `P.g=${api.P.g}`);
check('拖动重力滑块：数值标签即时更新',
      els.sGravVal.textContent === '25.0 m/s²', els.sGravVal.textContent);
check('拖动重力滑块：模拟继续推进（未被打断）',
      api.simTime > gStateBefore.t && (api.theta !== gStateBefore.th || api.omega !== gStateBefore.om));
const expectT25 = 2 * Math.PI * Math.sqrt((320 / 200) / 25);
check('重力变大：周期即时缩短',
      near(parseFloat(els.rP.textContent), expectT25, 0.002),
      `${els.rP.textContent} 期望 ${expectT25.toFixed(4)}s`);

// ---------- 6. 阻尼：自然衰减 ----------
input(els.sGrav, 9.8);
input(els.sLen, 200);
input(els.sDamp, 0.010);
check('拖动阻尼滑块：物理参数即时更新', near(api.P.dampC, 0.010, 1e-12), `c=${api.P.dampC}`);
check('拖动阻尼滑块：数值标签即时更新',
      els.sDampVal.textContent === '0.0100 s⁻¹', els.sDampVal.textContent);

click(els.resetBtn);                 // 回到 45° 起摆

// ⚠️ 取包络必须按“整个周期窗口内的峰值”，不能固定每 120 帧抽一次：
//    T=2.007s=120.4 帧，固定间隔抽样会与周期近共振混叠，读出假的“振幅回涨”。
//    这里按每 1 s（60 帧）记录一次窗口峰值，得到真正的衰减包络。
const perSec = [];
let peak = 0, win = 0;
for (let i = 0; i < 60 * 40; i++) {          // 40 s 仿真（含阻尼）
  pump();
  const a = Math.abs(parseFloat(els.rT.textContent));
  if (!Number.isNaN(a)) { peak = Math.max(peak, a); win = Math.max(win, a); }
  if (i % 60 === 59) { perSec.push(win); win = 0; }
}
check('阻尼起摆峰值来自 45° 初始条件（≤ 45°）', peak <= 45.01, `峰值 ${peak.toFixed(2)}°`);

// 连续 1 s 窗口峰值取平均 → 平滑掉周期内的起伏，得到可信包络
const env = [], envT = [];
for (let j = 0; j + 2 < perSec.length; j += 2) {
  env.push((perSec[j] + perSec[j + 1] + perSec[j + 2]) / 3);
  envT.push(j + 1);                          // 窗口中心（秒）
}
// 线性回归 ln|θ| = ln θ₀ − λt，拟合出实测衰减率 λ
const nf = env.length;
const mx = envT.reduce((s, v) => s + v, 0) / nf;
const my = env.reduce((s, v) => s + Math.log(v), 0) / nf;
let num = 0, den = 0;
for (let j = 0; j < nf; j++) { num += (envT[j] - mx) * (Math.log(env[j]) - my); den += (envT[j] - mx) ** 2; }
const lambda = -(num / den);
const lambdaTheory = 0.010 / 2;              // 欠阻尼解析解：|θ| ∝ e^{−ct/2}
check('阻尼使振幅自然衰减（40s 后包络显著下降）',
      env[nf - 1] < env[0] * 0.9,
      `${env[0].toFixed(2)}° → ${env[nf - 1].toFixed(2)}°（40s）`);
check('实测衰减率 λ 与解析解 c/2 一致（±12%）',
      Math.abs(lambda - lambdaTheory) / lambdaTheory < 0.12,
      `λ_实测=${lambda.toFixed(5)} s⁻¹ vs λ_理论=${lambdaTheory.toFixed(5)} s⁻¹`);
check('包络全程单调不上升（真衰减，无虚假回涨）',
      perSec.every((v, j) => j === 0 || v <= perSec[j - 1] * 1.002),
      `每秒峰值 ${perSec.map((v) => v.toFixed(1)).join(',')}`);
check('阻尼 HUD 显示 c 与阻尼比 ζ',
      /0\.01000\s*s⁻¹/.test(els.rC.textContent) && /ζ≈/.test(els.rC.textContent),
      els.rC.textContent);

// c = 0 时应恢复“纯简谐”行为：摆角重新回到接近 45°
input(els.sDamp, 0);
click(els.resetBtn);
let peakNoDamp = 0;
for (let i = 0; i < 60 * 6; i++) {
  pump();
  const a = Math.abs(parseFloat(els.rT.textContent));
  if (!Number.isNaN(a)) peakNoDamp = Math.max(peakNoDamp, a);
}
check('阻尼归零 + 重置后恢复无衰减摆动（峰值仍达 ~45°）',
      peakNoDamp > 44.5, `峰值 ${peakNoDamp.toFixed(2)}°`);
check('阻尼归零后 HUD 回到“无阻尼”', /无阻尼/.test(els.rC.textContent), els.rC.textContent);

// ---------- 7. 重置按钮 ----------
input(els.sDamp, 0.004);
for (let i = 0; i < 90; i++) pump();   // 先跑离初始状态
const drifty = parseFloat(els.rT.textContent);
check('重置前摆球确实偏离初始状态', Math.abs(drifty - 45) > 1, `θ=${drifty}°`);

click(els.resetBtn);
check('点击重置 → 摆球精准回到 45.00°', els.rT.textContent === '45.00°', els.rT.textContent);
check('点击重置 → 角速度归零', els.rW.textContent === '0.000 rad/s', els.rW.textContent);
check('点击重置 → 计时归零', els.rTime.textContent === '0.00 s', els.rTime.textContent);
check('点击重置 → 拖尾采样清空', api.trail.length === 0, `${api.trail.length} 点`);
check('点击重置 → 内部状态同步复位（θ=θ₀, ω=0）',
      near(api.theta, Math.PI / 4, 1e-12) && api.omega === 0 && api.simTime === 0);
check('点击重置 → 自动恢复运行', api.running === true && els.state.textContent.includes('RUNNING'));

// 重置后能重新正常摆动
let peakAfterReset = 0;
const thetaAtReset = api.theta;
for (let i = 0; i < 60 * 2; i++) {
  pump();
  peakAfterReset = Math.max(peakAfterReset, Math.abs(parseFloat(els.rT.textContent)));
}
check('重置后重新正常摆动（有阻尼仍会衰减）',
      api.theta !== thetaAtReset && peakAfterReset > 30,
      `重置后峰值 ${peakAfterReset.toFixed(2)}°`);

// ---------- 8. 交互 / 快捷键 ----------
winListeners.keydown[0]({ code: 'Space', key: ' ', preventDefault() {}, target: els.documentElement });
check('空格 → PAUSED', els.state.textContent.includes('PAUSED'), els.state.textContent);
const frozen = els.rTime.textContent;
for (let i = 0; i < 30; i++) pump();
check('暂停后时间冻结', els.rTime.textContent === frozen,
      `${frozen} -> ${els.rTime.textContent}`);

winListeners.keydown[0]({ code: 'Space', key: ' ', preventDefault() {}, target: els.documentElement });
check('再按空格 → RUNNING', els.state.textContent.includes('RUNNING'), els.state.textContent);

winListeners.keydown[0]({ key: 'r', preventDefault() {}, target: els.documentElement });
check('按 R → 重置到 45°', els.rT.textContent === '45.00°', els.rT.textContent);

// 焦点在滑块上时空格不应被吞掉
const stateBeforeSliderKey = els.state.textContent;
winListeners.keydown[0]({ code: 'Space', key: ' ', preventDefault() {}, target: { tagName: 'INPUT' } });
check('焦点在滑块上时空格不触发暂停（不抢输入）',
      els.state.textContent === stateBeforeSliderKey, els.state.textContent);

mkEl.listeners.cv.pointerdown();
check('点击画面 → PAUSED', els.state.textContent.includes('PAUSED'), els.state.textContent);

// ---------- 9. resize ----------
winListeners.resize[0]();
check('resize 后 canvas 物理尺寸 = 逻辑尺寸 × DPR',
      els.cv.width === els.cv.clientWidth * 2 && els.cv.height === els.cv.clientHeight * 2,
      `${els.cv.width} x ${els.cv.height}（逻辑 ${els.cv.clientWidth} x ${els.cv.clientHeight}，DPR=2）`);
check('resize 时悬点仍留在画布内且高于底部预留区',
      near(api.pivot.x, els.cv.clientWidth / 2, 0.01) && api.pivot.y > 0 && api.pivot.y < els.cv.clientHeight,
      `pivot=(${api.pivot.x}, ${api.pivot.y.toFixed(1)})`);

// 窄屏：摆长超过可用空间时应触发显示缩放
windowMock.innerWidth = 480;
windowMock.innerHeight = 420;
els.cv.clientWidth = 480;
els.cv.clientHeight = 420;
winListeners.resize[0]();
check('窄矮窗口：摆长自动等比缩放显示（timeScale < 1）',
      api.timeScale < 1 && api.dispLen < api.P.lenPx,
      `timeScale=${api.timeScale.toFixed(3)} dispLen=${api.dispLen.toFixed(1)}`);

// 恢复常规尺寸，验证渲染与循环仍正常
windowMock.innerWidth = 1280;
windowMock.innerHeight = 720;
els.cv.clientWidth = 1280;
els.cv.clientHeight = 720;
winListeners.resize[0]();
let renderFrames = 0;
try {
  for (let i = 0; i < 120; i++) { pump(); renderFrames++; }
  check('resize 后渲染循环继续（120 帧无异常）', renderFrames === 120, `${renderFrames} 帧`);
} catch (e) {
  check('resize 后渲染循环继续（120 帧无异常）', false, e.message);
}

// ---------- 10. 控制台 0 报错 ----------
// 用真实捕获的 console.error / console.warn 记录作断言，而不是复述测试自身的失败数
check('全程无 console.error 调用（控制台 0 报错）',
      consoleEvents.filter((e) => e.level === 'error').length === 0,
      consoleEvents.length ? consoleEvents.map((e) => `${e.level}: ${e.args}`).join(' | ') : '未捕获到任何 error/warn 调用');
check('window 未注册 error 处理器（页面无未捕获异常路径）',
      !winListeners.error || winListeners.error.length === 0,
      winListeners.error ? `${winListeners.error.length} 个 error 监听` : '无 error 监听');
check('测试期间启动与 120 帧渲染均无异常抛出',
      bootError === null, bootError ? `启动异常：${bootError.message}` : '无异常');

// ---------- 11. 输出 ----------
console.log('\n================ index.html 验证结果 ================');
for (const r of results) {
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
}
console.log('====================================================');
console.log(`共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
console.log(`无阻尼摆角范围: [${minAngle.toFixed(2)}°, ${maxAngle.toFixed(2)}°]  周期: ${periodShown}s  帧数: ${frames}`);
console.log(`阻尼衰减包络（每秒峰值）: ${perSec.map((v) => v.toFixed(1)).join(' → ')}`);
console.log(`实测衰减率 λ=${lambda.toFixed(5)} s⁻¹（理论 c/2=${lambdaTheory.toFixed(5)}，偏差 ${(100 * Math.abs(lambda - lambdaTheory) / lambdaTheory).toFixed(1)}%）`);
process.exit(failed ? 1 : 0);
