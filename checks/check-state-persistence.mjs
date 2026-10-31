// 体检 #3：内存状态 vs 持久化白名单 差集
//
// 对应失效点：st.life 一直在内存里被读写（运行时看起来一切正常），
// 但 saveSocialV2State() 的白名单里没有它 → 每次重启生活线清零，静默失忆。
//
// 用法：
//   node check-state-persistence.mjs --demo
//   node check-state-persistence.mjs --memory <运行态.json> --persisted <落盘.json>
//
// 运行态怎么取？两个办法：
//   a) 给你的调试端口加一个 /debug/state，把整个内存对象吐出来；
//   b) 或在保存函数处加一行 console.log(JSON.stringify(Object.keys(state)))。

import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes('--' + n);

function die(m) { console.error('[X] ' + m); process.exit(2); }

function deepKeys(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.add(path);
      for (const sub of deepKeys(v, path)) out.add(sub);
    } else {
      out.add(path);
    }
  }
  return out;
}

// ---------- 取材料 ----------
let memory, persisted, source;
if (has('demo')) {
  // 运行态有 7 个字段；落盘白名单只存了 4 个 → life / lastPhotoAt / moodEvery restart 后归零
  memory = {
    activeTopic: '修桥接', ownerProfile: ['喜欢数值读数'], nickname: 'Jino',
    life: { events: ['把桥接修好了', '第一次唱歌'] },
    lastPhotoAt: '2026-10-29T13:42:00Z',
    mood: { energy: 0.6, bored: 0.2 },
    voiceTuned: true,
  };
  persisted = {
    activeTopic: '修桥接', ownerProfile: ['喜欢数值读数'], nickname: 'Jino',
    voiceTuned: true,
  };
  source = 'demo';
} else {
  const m = flag('memory'), p = flag('persisted');
  if (!m || !p) die('用法：--memory <运行态.json> --persisted <落盘.json> 或 --demo');
  memory = JSON.parse(fs.readFileSync(m, 'utf8'));
  persisted = JSON.parse(fs.readFileSync(p, 'utf8'));
  source = `${m} vs ${p}`;
}

const memKeys = deepKeys(memory);
const perKeys = deepKeys(persisted);
console.log(`[材料] ${source}`);
console.log(`[材料] 运行态字段 ${memKeys.size} 个；落盘字段 ${perKeys.size} 个`);

// 落盘里凭空多出的键也要报（可能是死代码在写旧结构）
const ghosts = [...perKeys].filter(k => !memKeys.has(k));

const lost = [...memKeys].filter(k => !perKeys.has(k));
console.log('');
if (lost.length === 0) {
  console.log('[结论] PASS  运行态字段全部进了持久化白名单');
} else {
  console.log('[结论] FAIL  以下字段运行时存在、落盘时被丢弃（每次重启静默归零）：');
  for (const k of lost) {
    const v = k.split('.').reduce((o, s) => (o ? o[s] : undefined), memory);
    const preview = typeof v === 'string' ? JSON.stringify(v).slice(0, 40) : Array.isArray(v) ? `Array(${v.length})` : typeof v === 'object' && v ? 'Object' : String(v);
    console.log(`  - ${k}  （当前值：${preview}）`);
  }
  console.log('');
  console.log('修法二选一：加进保存白名单；或明确标注 @volatile 并接受重启丢失——');
  console.log('最危险的不是丢，是"你以为它存了"。');
  process.exitCode = 1;
}
if (ghosts.length) {
  console.log(`[注意] 落盘里有 ${ghosts.length} 个运行态不存在的键（旧结构残留？）：${ghosts.slice(0, 8).join(', ')}`);
}
