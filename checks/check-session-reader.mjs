// 体检 #4：你的会话读取器是不是只解了第一帧？
//
// 对应失效点：多帧 zstd 文件用 zstdDecompressSync(整块 buffer) 只解第一帧就
// "成功"返回——551KB 解出 227 字符，而你的体检报告把"仪器读不到"呈现成了
// "她没有上下文"。仪器坏了比仪器没有更危险。
//
// 本脚本做三件事：
//   1) 对给定文件，用"天真法"（整块解）和"逐帧法"各解一遍，对比差异；
//   2) 对仪器做自检（造已知内容压过去再解回来，逐字符比对）；
//   3) 给出判定：读取器可信 / 不可信。
//
// 用法：
//   node check-session-reader.mjs --demo
//   node check-session-reader.mjs --file <会话文件>

import fs from 'node:fs';
import zlib from 'node:zlib';
import { decompressBuffer, selfTest } from './lib/session-reader.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes('--' + n);

function die(m) { console.error('[X] ' + m); process.exit(2); }

// ---------- 仪器自检 ----------
const st = selfTest();
console.log(`[自检] ${st.ok ? 'OK ' : 'X '} ${st.detail}`);
if (!st.ok) die('读取器自检失败——下面所有结论都不可信');

// ---------- 天真法（反面教材：你会怎么踩坑） ----------
function naive(buf) {
  if (typeof zlib.zstdDecompressSync !== 'function') return { text: '', err: 'no zstd api' };
  try {
    return { text: zlib.zstdDecompressSync(buf).toString('utf8'), err: null };
  } catch (e) {
    // 注意：整块解多帧文件时这里通常【不会】抛错，而是静默返回第一帧
    return { text: '', err: String(e.message || e) };
  }
}

// ---------- 取材料 ----------
let buf, source;
if (has('demo')) {
  // 造一个 5 帧拼接文件，每帧 200KB 文本
  const frames = [];
  for (let i = 0; i < 5; i++) {
    const line = JSON.stringify({ role: 'user', text: `第${i + 1}帧：` + '聊天气泡'.repeat(20000) });
    frames.push(zlib.zstdCompressSync(Buffer.from(line + '\n')));
  }
  buf = Buffer.concat(frames);
  source = 'demo（5 帧合成会话，每帧一条记录）';
} else {
  const p = flag('file');
  if (!p) die('用法：node check-session-reader.mjs --file <文件> 或 --demo');
  buf = fs.readFileSync(p);
  source = p;
}
console.log(`[材料] ${source}（${(buf.length / 1024).toFixed(0)} KB）`);

// ---------- 两种解法对比 ----------
const naiveR = naive(buf);
const goodR = decompressBuffer(buf);
for (const n of goodR.notes) console.log(`[注意] ${n}`);

const naiveKB = (naiveR.text.length / 1024).toFixed(0);
const goodKB = (goodR.text.length / 1024).toFixed(0);
console.log('');
console.log('解法               得到内容             帧数');
console.log('-'.repeat(48));
console.log(`${'天真法（整块解）'.padEnd(18)}${(naiveKB + ' KB').padEnd(20)}1`);
console.log(`${'逐帧法（按魔数切）'.padEnd(18)}${(goodKB + ' KB').padEnd(20)}${goodR.fails.length ? goodR.frames + '(+' + goodR.fails.length + '败)' : goodR.frames}`);
console.log('');

const lossRatio = goodR.text.length > 0 ? 1 - naiveR.text.length / goodR.text.length : 1;
if (goodR.frames <= 1) {
  console.log('[结论] 单帧文件，两种解法等价——但你的真实会话大概率不是单帧，跑跑真文件');
} else if (lossRatio > 0.05) {
  console.log(`[结论] FAIL  天真法丢了 ${(lossRatio * 100).toFixed(1)}% 的内容还"不报错"——`);
  console.log('       如果你此前的体检报告建立在整块解上，那些"0 命中"的结论全部作废，重测。');
  process.exitCode = 1;
} else {
  console.log('[结论] PASS  逐帧法与天真法结果一致，读取器可信');
}
