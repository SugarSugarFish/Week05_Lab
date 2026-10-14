// ---------------------------------------------------------------
// index.html 验证脚本：抽出内联 <script>，在模拟 DOM/Canvas 下实际跑起来，
// 校验 (1) 语法 (2) 物理数值 (3) HUD 输出 (4) 交互 (5) 动画循环
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
check('使用 getContext(\'2d\')', /getContext\(\s*['"]2d['"]\s*\)/.test(code));
check('背景色 #1a1a24 存在', /#1a1a24/i.test(html));
check('摆球有发光效果 (shadowBlur/radialGradient)',
      /shadowBlur/.test(code) && /createRadialGradient/.test(code));
check('参数 L=200', /LENGTH_PX\s*=\s*200/.test(code));
check('参数 g=9.8', /G_ACC\s*=\s*9\.8/.test(code));
check('参数 θ₀=45', /THETA0_DEG\s*=\s*45/.test(code));

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

function mkEl(id) {
  return {
    id,
    textContent: '',
    className: '',
    clientWidth: 1280,
    clientHeight: 720,
    width: 0,
    height: 0,
    style: {},
    getContext: () => c2d,
    addEventListener: (type, fn) => {
      (mkEl.listeners[id] ||= {})[type] = fn;
    }
  };
}
mkEl.listeners = {};

const byId = new Map();
const els = new Proxy({}, {
  get(t, k) {
    if (!byId.has(k)) byId.set(k, mkEl(k));
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

let rafCb = null;
const rafQueue = [];
function raf(cb) { rafQueue.push(cb); return rafQueue.length; }

const documentMock = { getElementById: (id) => els[id] };

// ---------- 3. 执行脚本 ----------
const payload = `"use strict";\n${code}\n;return { THETA0_DEG: (typeof THETA0_DEG!=="undefined")?THETA0_DEG:null };`;
let api = null;
try {
  const fn = new Function(
    'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame',
    'performance', 'console', payload
  );
  fn(windowMock, documentMock, raf, () => {}, { now: () => 0 }, console);
  check('内联脚本语法正确且可执行', true);
} catch (e) {
  check('内联脚本语法正确且可执行', false, e.message);
}

check('注册了 resize 监听', !!(winListeners.resize && winListeners.resize.length));
check('注册了 keydown 监听', !!(winListeners.keydown && winListeners.keydown.length));
check('canvas 注册了 pointerdown 监听', !!mkEl.listeners.cv?.pointerdown);
check('首帧已通过 requestAnimationFrame 排入队列', rafQueue.length > 0);

// ---------- 4. 驱动动画循环，校验物理 ----------
function pump(ms) {
  const cb = rafQueue.shift();
  if (!cb) throw new Error('动画循环中断：队列为空');
  cb(ms);
}

let ts = 16;
let frames = 0;
const FPS = 16.6667;
let minAngle = 999, maxAngle = -999;

// 跑 2.1 个周期，约 126 帧
const totalFrames = Math.round((2.1 * 2.006) * 60);
for (let i = 0; i < totalFrames; i++) {
  ts = 16 + i * FPS;
  pump(ts);
  frames++;
  const raw = els.rT.textContent.replace('°', '');
  const a = parseFloat(raw);
  if (!Number.isNaN(a)) { minAngle = Math.min(minAngle, a); maxAngle = Math.max(maxAngle, a); }
}
check('动画帧连续推进（无中断）', frames === totalFrames, `${frames} 帧`);

const angleNow = parseFloat(els.rT.textContent);
check('摆角始终在 ±45° 内（简谐解析解有界）',
      minAngle >= -45.01 && maxAngle <= 45.01,
      `范围 [${minAngle.toFixed(3)}°, ${maxAngle.toFixed(3)}°]`);
check('确实发生了左右摆动（穿过 0°）', minAngle < 0 && maxAngle > 0);

const periodShown = parseFloat(els.rP.textContent);
const expectedT = 2 * Math.PI * Math.sqrt((200 / 200) / 9.8);
check('周期 T = 2π√(L/g) 正确',
      Math.abs(periodShown - expectedT) < 0.002,
      `显示 ${periodShown}s，期望 ${expectedT.toFixed(4)}s`);

check('初始摆角 HUD 显示 45°', els.rT0.textContent === '45°', els.rT0.textContent);
check('摆长 HUD 显示 200px', /200\s*px/.test(els.rL.textContent), els.rL.textContent);
check('重力 HUD 显示 9.8', /9\.8/.test(els.rG.textContent), els.rG.textContent);
check('角速度 HUD 有单位 rad/s', /rad\/s/.test(els.rW.textContent), els.rW.textContent);
check('计时 HUD 有单位 s', /\s*s$/.test(els.rTime.textContent), els.rTime.textContent);

// 解析解校验：取当前 simTime，算出理论角，和 HUD 比对
const tNow = parseFloat(els.rTime.textContent);
const w = Math.sqrt(9.8 / 1.0);
const theory = 45 * Math.cos(w * tNow);
check('θ(t) 与解析解 θ₀cos(ωt) 一致',
      Math.abs(angleNow - theory) < 0.5,
      `HUD ${angleNow}° vs 理论 ${theory.toFixed(2)}°`);

// ---------- 5. 交互校验 ----------
winListeners.keydown[0]({ code: 'Space', key: ' ', preventDefault() {} });
check('空格 → PAUSED', els.state.textContent.includes('PAUSED'), els.state.textContent);
const frozen = els.rTime.textContent;
for (let i = 0; i < 30; i++) { ts += FPS; pump(ts); }
check('暂停后时间冻结', els.rTime.textContent === frozen,
      `${frozen} -> ${els.rTime.textContent}`);

winListeners.keydown[0]({ code: 'Space', key: ' ', preventDefault() {} });
check('再按空格 → RUNNING', els.state.textContent.includes('RUNNING'), els.state.textContent);

winListeners.keydown[0]({ key: 'r', preventDefault() {} });
check('按 R → 重置到 45°', els.rT.textContent === '45.00°', els.rT.textContent);

mkEl.listeners.cv.pointerdown();
check('点击画面 → PAUSED', els.state.textContent.includes('PAUSED'), els.state.textContent);

// ---------- 6. resize ----------
winListeners.resize[0]();
check('resize 后 canvas 物理尺寸 = 逻辑尺寸 × DPR',
      els.cv.width === 2560 && els.cv.height === 1440,
      `${els.cv.width} x ${els.cv.height}`);

// ---------- 7. 输出 ----------
console.log('\n================ index.html 验证结果 ================');
for (const r of results) {
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
}
console.log('====================================================');
console.log(`共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
console.log(`摆角范围: [${minAngle.toFixed(2)}°, ${maxAngle.toFixed(2)}°]  周期: ${periodShown}s  帧数: ${frames}`);
process.exit(failed ? 1 : 0);
