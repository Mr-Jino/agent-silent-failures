// 体检 #1：人格卡真的进了上下文吗？
//
// 对应失效点：personaBlockV2() 首行 if (!roleState.role) return '' ——
// 配置页显示"已启用"，实际每轮注入空字符串，静默几周。
//
// 用法：
//   node check-persona-in-context.mjs --demo
//   node check-persona-in-context.mjs --session <会话文件(.zstd/.jsonl/文本)> --anchor "人格卡" --anchor "你是XX"
//
// 判据：锚点词在"最近一段内容"里命中 0 次 = 人格不存在。

import fs from 'node:fs';
import { readSessionFile, selfTest } from './lib/session-reader.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes('--' + n);

function die(msg) { console.error('[X] ' + msg); process.exit(2); }

// ---------- 仪器自检 ----------
const st = selfTest();
if (!st.ok) die(`体检仪自检失败（${st.detail}）——本报告不可信，先修仪器`);
console.log(`[自检] OK  ${st.detail}`);

// ---------- 取材料 ----------
let text, source;
if (has('demo')) {
  // 造一个"人格从未生效"的合成会话：47 轮里人格块全是空串
  const turns = [];
  for (let i = 0; i < 47; i++) {
    turns.push(JSON.stringify({
      role: 'user',
      text: `【当前时间】…【你的身份】昵称+QQ【反AI味】…【表情包策略】…【本回合形态】… 第${i + 1}轮输入：今天干嘛呢`,
    }));
  }
  text = turns.join('\n');
  source = 'demo（合成会话：47 轮、人格注入恒为空串）';
} else {
  const p = flag('session');
  if (!p) die('用法：node check-persona-in-context.mjs --session <文件> [--anchor 词]... 或 --demo');
  const s = readSessionFile(p);
  for (const n of s.notes) console.log(`[注意] ${n}`);
  text = s.text;
  source = `${p}（${s.frames} 帧 / ${(s.fileBytes / 1024).toFixed(0)} KB / ${s.lines.length} 行）`;
}

// ---------- 锚点词 ----------
const anchors = args.includes('--anchor') ? args.filter((a, i) => args[i - 1] === '--anchor') : ['人格卡', '这是你的'];
if (anchors.length === 0) die('至少给一个锚点词：人格卡正文里必然出现的独特短语（不是人名，是卡里的句式）');
console.log(`[材料] ${source}`);
console.log(`[锚点] ${anchors.join(' | ')}`);

// ---------- 计数 ----------
const total = text.length;
let hits = 0;
const hitPos = [];
for (const a of anchors) {
  let idx = 0, c = 0;
  while ((idx = text.indexOf(a, idx)) !== -1) { hits++; c++; hitPos.push(idx); idx += a.length; }
  console.log(`  "${a}" 命中 ${c} 次`);
}

// 最近 10% 的内容里有没有命中（越靠近末尾越接近"当前人格状态"）
const tailStart = Math.floor(total * 0.9);
const tailHits = hitPos.filter(p => p >= tailStart).length;

// ---------- 判定 ----------
const PASS = hits > 0 && tailHits > 0;
console.log('');
console.log(`[结果] 总命中 ${hits} 次；最近 10% 内容里命中 ${tailHits} 次`);
if (has('demo')) console.log('[说明] demo 材料就是"人格从未注入"的形状——你自己的材料应该长得不一样');
if (PASS) {
  console.log('[结论] PASS  人格卡出现在了最近的上下文里');
} else if (hits > 0) {
  console.log('[结论] WARN  曾经命中过，但最近没有——人格在某个时间点之后消失了（检查迁移/热更是否覆盖了 state/）');
} else {
  console.log('[结论] FAIL  锚点词全文 0 命中——人格卡从未进入上下文，去查注入函数的提前 return');
}
process.exit(PASS ? 0 : 1);
