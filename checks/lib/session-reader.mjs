// 会话文件读取器（多帧 zstd 安全版）
//
// 为什么存在：zstd 的"多帧拼接"文件（一个文件里连着 N 个 28 B5 2F FD 帧头），
// 用 zlib.zstdDecompressSync(整个 buffer) 只会解出第一帧就"成功"返回——
// 不报错。551KB 可能只解出 227 字符，而你以为你读全了。
//
// 用法：
//   import { readSessionFile, decompressBuffer, selfTest } from './lib/session-reader.mjs';

import fs from 'node:fs';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function zstdAvailable() {
  return typeof zlib.zstdDecompressSync === 'function';
}

/**
 * 逐帧解压一个 buffer。
 * 返回 { text, frames, ok, fails, notes }：
 *   frames  成功解出的帧数
 *   fails   失败帧 [{ index, error }]
 *   notes   值得警惕的观察（例如"只有 1 帧但文件很大"）
 */
export function decompressBuffer(buf) {
  const notes = [];
  const fails = [];
  let text = '';
  let frames = 0;

  if (!zstdAvailable()) {
    throw new Error(
      `本 Node (${process.version}) 没有 zstd API，需要 >= 22.15。` +
      `此时 zstdDecompressSync 是 undefined——又一个静默失败。`
    );
  }

  // 找出全部帧起点
  const starts = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
      starts.push(i);
    }
  }

  // 没有 zstd 魔数：当普通文本/JSONL 处理
  if (starts.length === 0) {
    return { text: buf.toString('utf8'), frames: 0, ok: true, fails, notes: ['非 zstd 文件，按纯文本读取'] };
  }

  // 帧边界 = 下一个魔数的位置
  for (let k = 0; k < starts.length; k++) {
    const begin = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    const seg = buf.subarray(begin, end);
    try {
      text += zlib.zstdDecompressSync(seg).toString('utf8');
      frames++;
    } catch (e) {
      fails.push({ index: k, error: String(e && e.message || e) });
    }
  }

  // 自我怀疑：解出来的量相对于压缩量是否异常小？
  if (frames === 1 && buf.length > 64 * 1024) {
    notes.push(`整个 ${buf.length} 字节的文件只解出 1 帧——如果是多帧拼接文件，这里丢了内容`);
  }
  const ratio = text.length / Math.max(1, buf.length);
  if (ratio < 0.5) {
    notes.push(`解压比异常（${(ratio * 100).toFixed(1)}%），正常 zstd 日志文本通常 ≥ 3x，请怀疑帧没解全`);
  }
  if (fails.length > 0) {
    notes.push(`${fails.length} 帧解压失败——这些帧里的内容不可见，不要把它当成"没有"`);
  }

  return { text, frames, ok: fails.length === 0, fails, notes };
}

/** 读一个会话文件（.zstd / .jsonl / 纯文本都行），并附上自检信息 */
export function readSessionFile(path) {
  const buf = fs.readFileSync(path);
  const st = decompressBuffer(buf);
  st.file = path;
  st.fileBytes = buf.length;
  st.lines = st.text ? st.text.split(/\r?\n/).filter(Boolean) : [];
  return st;
}

/**
 * 仪器自检：造一段已知内容 → 单帧压 → 多帧拼 → 解回来 → 逐字符比对。
 * 自检不过就不许出报告——体检仪必须自带铅封。
 */
export function selfTest() {
  const a = Buffer.from(JSON.stringify({ role: 'user', text: '自检片段A：' + '苔藓'.repeat(500) }) + '\n');
  const b = Buffer.from(JSON.stringify({ role: 'user', text: '自检片段B：' + '潮汐'.repeat(500) }) + '\n');
  const multi = Buffer.concat([zlib.zstdCompressSync(a), zlib.zstdCompressSync(b)]);
  const st = decompressBuffer(multi);
  const okA = st.text.includes('自检片段A');
  const okB = st.text.includes('自检片段B');
  return {
    ok: st.ok && okA && okB && st.frames === 2,
    frames: st.frames,
    detail: `多帧自检：期望 2 帧，实得 ${st.frames}；片段A ${okA ? 'OK' : '丢失'}；片段B ${okB ? 'OK' : '丢失'}`,
  };
}
