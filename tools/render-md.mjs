#!/usr/bin/env node
// render-md.mjs
// MD 战报 → HTML（带 OriginDota 统一样式 + 可下载 PDF）
//
// 用法:
//   node tools/render-md.mjs analysis/20260509/20260509-内战1-02-AI战报.md
//
// 输出: 同目录下 .html 文件

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { marked } from 'marked';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node render-md.mjs <path-to-md>');
  process.exit(1);
}

const inputPath = argv[0];
const md = readFileSync(inputPath, 'utf-8');
const outputPath = inputPath.replace(/\.md$/, '.html');

// 解析 front matter（简易 YAML，支持单行 key: value）
const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n/);
const meta = {};
let body = md;
if (fmMatch) {
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^([\w_]+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  body = md.slice(fmMatch[0].length);
} else {
  // 无 front matter：从 MD 内容提取 title（第一个 H1）
  const h1Match = md.match(/^#\s+(.+?)$/m);
  if (h1Match) meta.title = h1Match[1].trim();
}

// 自定义 marked 选项
marked.setOptions({ gfm: true, breaks: false });

const articleHtml = marked.parse(body);

const title = meta.title || '内战 AI 战报';
const description = meta.description || '原点 Dota2 内战 AI 战报';
const matchId = meta.match_id || '';
const dateLabel = meta.date || '';
const winner = meta.winner || ''; // radiant / dire
const radiantScore = meta.radiant_score || '';
const direScore = meta.dire_score || '';
const duration = meta.duration || '';
const phase = meta.phase || '';     // 比如 "高分桌"
const prevHref = meta.prev || '';   // 上一局链接
const nextHref = meta.next || '';   // 下一局链接

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta name="theme-color" content="#1a1a1a">
<title>${title} · 原点 Dota2</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="page">

  <div class="actions">
    <div class="crumb">
      <a href="../../index.html">原点 Dota2 内战</a> ›
      <a href="../../20260509-内战对战表.html">5.9 对战表</a> ›
      <a href="index.html">5.9 战报</a> ›
      ${title.replace(/^[\d.]+\s*/, '').replace(/\s*·\s*AI 战报/, '')}
    </div>
    <div class="btns">
      ${prevHref ? `<a class="btn" href="${prevHref}">← 上一局</a>` : ''}
      ${nextHref ? `<a class="btn" href="${nextHref}">下一局 →</a>` : ''}
      <button onclick="window.print()">下载 PDF</button>
    </div>
  </div>

  <header class="hero-header">
    <div class="eyebrow">原点 DOTA2 内战 · AI 战报</div>
    <h1>${title.replace(/\s*·\s*AI 战报.*$/, '')}</h1>
    <div class="meta-row">
      ${dateLabel ? `<span>${dateLabel}</span>` : ''}
      ${matchId ? `<span>比赛 ID ${matchId}</span>` : ''}
      ${phase ? `<span>${phase}</span>` : ''}
      ${duration ? `<span>时长 ${duration}</span>` : ''}
    </div>
  </header>

  ${radiantScore && direScore ? `
  <div class="scoreboard">
    <div class="ts r">
      <div class="label">天 辉</div>
      <div class="nm ${winner === 'radiant' ? 'win' : ''}">天辉</div>
      <div class="sc">${radiantScore}</div>
    </div>
    <div class="vs">VS</div>
    <div class="ts d">
      <div class="label">夜 魇</div>
      <div class="nm ${winner === 'dire' ? 'win' : ''}">夜魇</div>
      <div class="sc">${direScore}</div>
    </div>
  </div>
  ` : ''}

  <article>
${articleHtml}
  </article>

  <div class="report-footer">
    <p>📊 数据来源：<a href="https://github.com/odota/parser" target="_blank">OpenDota Parser</a> 解析比赛 ID ${matchId} → Claude AI 自动生成</p>
    <p>📖 <a href="index.html">返回 5.9 战报总览</a> · <a href="../../index.html">主页</a> · <a href="https://github.com/mrliuzhiyu/OriginDota">GitHub</a></p>
  </div>

</div>
</body>
</html>
`;

writeFileSync(outputPath, html);
console.log(`✓ ${inputPath} → ${outputPath}`);
console.log(`  大小: ${(html.length / 1024).toFixed(1)} KB`);
