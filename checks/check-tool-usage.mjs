// 体检 #2：工具存在吗？被用过吗？
//
// 对应失效点：① config 缺一段 → 工具根本没注册，她"物理上没有嘴"；
// ② 工具在清单里，但形态骰子永远不选它 → 30 天调用数 = 0。
// 两张表都要看：注册表 和 调用流水。
//
// 用法：
//   node check-tool-usage.mjs --demo
//   node check-tool-usage.mjs --calls <tool-calls.jsonl> --registered "say,sing,draw,memory" [--days 30]
//
// tool-calls.jsonl 每行一个 JSON：{ "ts": "...", "tool": "qq_sing", "ok": true }

import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes('--' + n);

function die(m) { console.error('[X] ' + m); process.exit(2); }

// ---------- 取材料 ----------
let registered, lines, source;
if (has('demo')) {
  registered = ['qq_say', 'qq_sing', 'qq_draw', 'qq_memory_append', 'qq_diary_write'];
  // 合成流水：画图调了 6 次但 0 次成功发出（对应"看不见图的模型被要求审图"）
  let tick = 0;
  const mk = (tool, ok) => JSON.stringify({
    ts: new Date(Date.now() - (++tick) * 3600e3).toISOString(), tool, ok,
  });
  lines = [
    mk('qq_say', true), mk('qq_say', true), mk('qq_say', true),
    mk('qq_memory_append', true), mk('qq_memory_append', true), mk('qq_memory_append', true),
    mk('qq_memory_append', true), mk('qq_memory_append', true),
    mk('qq_draw', false), mk('qq_draw', false), mk('qq_draw', false),
    mk('qq_draw', false), mk('qq_draw', false), mk('qq_draw', false),
    // qq_sing / qq_diary_write：注册了，零调用
  ];
  source = 'demo';
} else {
  const p = flag('calls');
  if (!p || !flag('registered')) die('用法：--calls <jsonl> --registered "a,b,c" [--days 30] 或 --demo');
  registered = flag('registered').split(',').map(s => s.trim()).filter(Boolean);
  lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  source = p;
}

const days = Number(flag('days')) || 30;
const since = Date.now() - days * 86400e3;

// ---------- 注册表这边（真实环境请接你的运行时工具枚举） ----------
console.log(`[材料] 流水 ${lines.length} 条（${source}）；注册表 ${registered.length} 个工具；窗口 ${days} 天`);
console.log('[提示] "注册"这一侧最好直接调你的运行时枚举（MCP tools/list 之类），');
console.log('       config 里"应该有"不算数——本脚本只负责对账和计数。');

// ---------- 流水计数 ----------
const stat = new Map(); // tool -> { calls, ok }
let skipped = 0;
for (const ln of lines) {
  let j;
  try { j = JSON.parse(ln); } catch { skipped++; continue; }
  const tool = j.tool || j.name;
  if (!tool) { skipped++; continue; }
  if (j.ts && Date.parse(j.ts) < since) continue; // 窗口外
  if (registered.length && !registered.includes(tool) && !registered.includes(tool.replace(/^qq_/, ''))) {
    // 流水里有注册表之外的工具 → 白名单可能拼错了名字（静默放行或静默拦截）
    if (!stat.has(tool)) console.log(`[注意] 流水里出现了注册表之外的工具：${tool}（检查是不是拼写差异）`);
  }
  const s = stat.get(tool) || { calls: 0, ok: 0 };
  s.calls++; if (j.ok !== false) s.ok++;
  stat.set(tool, s);
}
if (skipped) console.log(`[注意] ${skipped} 行解析失败被跳过（不要把它们当成"没有调用"）`);

// ---------- 报告 ----------
console.log('');
console.log('工具                       调用   成功   判定');
console.log('-'.repeat(52));
let problems = 0;
for (const t of registered) {
  const s = stat.get(t) || stat.get(t.replace(/^qq_/, '')) || { calls: 0, ok: 0 };
  let verdict, pad = String(t).padEnd(26);
  if (s.calls === 0) { verdict = 'FAIL  存在但 30 天 0 调用——能力在睡死'; problems++; }
  else if (s.ok === 0) { verdict = `FAIL  调了 ${s.calls} 次全部失败/被拦——链路有静默死路`; problems++; }
  else if (s.ok / s.calls < 0.3) { verdict = `WARN  成功率 ${((s.ok / s.calls) * 100).toFixed(0)}%，偏低`; problems++; }
  else verdict = 'PASS';
  console.log(`${pad}${String(s.calls).padEnd(6)} ${String(s.ok).padEnd(6)} ${verdict}`);
}
console.log('');
console.log(problems === 0
  ? '[结论] PASS  每个注册的工具都有健康的使用记录'
  : `[结论] ${problems} 个工具存在静默失效（0 调用或 0 成功）——先查存在性，再查决策，最后查链路`);
process.exit(problems ? 1 : 0);
