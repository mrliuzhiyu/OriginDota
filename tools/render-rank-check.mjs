#!/usr/bin/env node
// render-rank-check.mjs
// 把 rank-check-output.json 渲染成 段位真实度 HTML 报告
//
// 用法:
//   node tools/render-rank-check.mjs
//   输出: analysis/段位真实度.html

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, 'rank-check-output.json'), 'utf-8'));

function diffBadge(d) {
  if (d == null) return '<span class="b mute">无数据</span>';
  if (Math.abs(d) < 500) return `<span class="b ok">${d > 0 ? '+' : ''}${d}</span>`;
  if (Math.abs(d) < 1000) return `<span class="b warn">${d > 0 ? '+' : ''}${d}</span>`;
  return `<span class="b danger">${d > 0 ? '+' : ''}${d}</span>`;
}

function flagText(p) {
  if (p.flag === 'low_reported') return '⚠ 高分低报（实际段位低于报名）';
  if (p.flag === 'high_reported') return '⚠ 低分高报（实际段位高于报名）';
  if (p.real_mmr) return '✓ 报名与实际段位匹配';
  if (!p.steam_id) return '— 未提供 Steam ID';
  return '— STRATZ 数据不足，待人工核查';
}

const stratzUrl = (id64) => id64
  ? `https://stratz.com/players/${BigInt(id64) - 76561197960265728n}`
  : null;

const rows = data.map(p => {
  const realMmr = p.real_mmr;
  const reported = p.reported ?? '—';
  const sUrl = stratzUrl(p.steam_id);
  const cls = p.flag === 'low_reported' ? 'row-danger'
    : p.flag === 'high_reported' ? 'row-info'
    : (!p.steam_id || !p.real_mmr) ? 'row-mute' : '';
  return `
  <tr class="${cls}">
    <td class="num">#${String(p.n).padStart(2, '0')}</td>
    <td class="name">${p.name}${p.note ? ` <span class="note">（${p.note}）</span>` : ''}</td>
    <td class="num">${reported}</td>
    <td>${p.rank_name || '—'}${p.lb_rank ? ` · 榜 ${p.lb_rank}` : ''}</td>
    <td class="num">${realMmr || '—'}</td>
    <td class="num">${diffBadge(p.diff)}</td>
    <td>${p.match_count ? `${p.match_count} 场 / ${p.win_count || 0} 胜（${p.match_count > 0 ? Math.round((p.win_count || 0) / p.match_count * 100) : 0}%）` : '—'}</td>
    <td>${sUrl ? `<a href="${sUrl}" target="_blank">主页</a>` : '—'}</td>
    <td class="status">${flagText(p)}</td>
  </tr>`;
}).join('');

const dangerCount = data.filter(p => p.flag === 'low_reported').length;
const infoCount = data.filter(p => p.flag === 'high_reported').length;
const okCount = data.filter(p => p.flag === 'ok' && p.real_mmr).length;
const muteCount = data.filter(p => !p.real_mmr).length;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>段位真实度核查 · 原点 Dota2 内战</title>
<meta name="theme-color" content="#1a1a1a">
<style>
  :root { --ink:#1a1a1a; --ink-soft:#444; --ink-mute:#888; --line:#e6e6e6; --bg:#fff; --bg-card:#fafafa;
    --ok:#2d5a3d; --ok-bg:#f0f7f2; --warn:#b8860b; --warn-bg:#fdf9ed; --danger:#c00; --danger-bg:#fef2f2; --info:#1f6f8b; --info-bg:#eef6f9; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7}
  .page{max-width:1200px;margin:0 auto;padding:48px 32px 80px}
  .actions{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;margin-bottom:24px;border-bottom:1px solid var(--line)}
  .crumb{font-size:12px;color:var(--ink-mute);letter-spacing:1px}
  .crumb a{color:var(--ink-soft);text-decoration:none;border-bottom:1px dotted var(--ink-mute)}
  .actions button{padding:8px 14px;font-size:12px;border:1px solid var(--ink);background:var(--bg);color:var(--ink);cursor:pointer;font-family:inherit;letter-spacing:1px}
  header{text-align:center;margin-bottom:36px;padding-bottom:24px;border-bottom:2px solid var(--ink)}
  header .eyebrow{font-size:11px;letter-spacing:5px;color:var(--ink-mute);margin-bottom:12px}
  header h1{font-size:28px;font-weight:600;letter-spacing:1px}
  header .meta{margin-top:10px;font-size:13px;color:var(--ink-soft)}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:32px}
  .stat{border:1px solid var(--line);background:var(--bg-card);padding:18px;text-align:center}
  .stat .v{font-size:30px;font-weight:700;font-feature-settings:"tnum"}
  .stat .l{font-size:11px;letter-spacing:2px;color:var(--ink-mute);margin-top:4px}
  .stat.ok .v{color:var(--ok)}
  .stat.warn .v{color:var(--warn)}
  .stat.danger .v{color:var(--danger)}
  .stat.mute .v{color:var(--ink-mute)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
  th{font-size:11px;letter-spacing:1px;color:var(--ink-mute);background:var(--bg-card);font-weight:500}
  td.num{text-align:right;font-feature-settings:"tnum";font-weight:500}
  td.name{font-weight:600}
  td.name .note{font-weight:400;font-size:11px;color:var(--ink-mute)}
  td.status{font-size:12px;color:var(--ink-soft)}
  tr.row-danger td{background:var(--danger-bg)}
  tr.row-info td{background:var(--info-bg)}
  tr.row-mute td{color:var(--ink-mute)}
  tr.row-mute td.name{color:var(--ink)}
  .b{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;letter-spacing:0.5px;border-radius:2px}
  .b.ok{background:var(--ok-bg);color:var(--ok)}
  .b.warn{background:var(--warn-bg);color:var(--warn)}
  .b.danger{background:var(--danger-bg);color:var(--danger)}
  .b.mute{background:#f5f5f5;color:var(--ink-mute)}
  .notes{margin-top:32px;padding:18px 22px;background:var(--bg-card);border-left:3px solid var(--ink-mute);font-size:12px;color:var(--ink-soft);line-height:1.8}
  .notes h3{font-size:13px;color:var(--ink);margin-bottom:8px;letter-spacing:1px}
  .footer{margin-top:32px;padding-top:18px;border-top:1px solid var(--line);font-size:11px;color:var(--ink-mute);text-align:center}
  a{color:var(--ink-soft)}
  @media print {
    .actions{display:none}
    body{font-size:11px}
  }
</style>
</head>
<body>
<div class="page">

  <div class="actions">
    <div class="crumb">
      <a href="../index.html">原点 Dota2 内战</a> ›
      <a href="../20260509-内战对战表.html">5.9 对战表</a> ›
      段位真实度核查
    </div>
    <button onclick="window.print()">下载 PDF</button>
  </div>

  <header>
    <div class="eyebrow">原点 DOTA2 内战 · 防止虚报</div>
    <h1>段位真实度核查</h1>
    <div class="meta">数据来源：STRATZ GraphQL · 38 位报名玩家 · 报名分 vs STRATZ 真实段位对比</div>
  </header>

  <section class="stats">
    <div class="stat danger">
      <div class="v">${dangerCount}</div>
      <div class="l">疑似虚报（差≥1000）</div>
    </div>
    <div class="stat ok">
      <div class="v">${okCount}</div>
      <div class="l">报名匹配</div>
    </div>
    <div class="stat warn">
      <div class="v">${infoCount}</div>
      <div class="l">低分高报（差≤−1000）</div>
    </div>
    <div class="stat mute">
      <div class="v">${muteCount}</div>
      <div class="l">数据不足 / 待人工核查</div>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th style="width:55px;">报名</th>
        <th>玩家</th>
        <th class="num">报名分</th>
        <th>STRATZ 段位</th>
        <th class="num">估算 MMR</th>
        <th class="num">差距</th>
        <th>STRATZ 战绩</th>
        <th>主页</th>
        <th>结论</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <div class="notes">
    <h3>关于数据</h3>
    <ul style="margin-left:20px;">
      <li><b>STRATZ 段位</b>：优先用当季 seasonRank；当季无数据则查最近天梯比赛平均段位；都无数据则标"未排位"</li>
      <li><b>差距 ≥ +1000</b>（红色行）= 玩家报名分明显高于 STRATZ 真实段位 → <b>疑似高分低报</b>，建议管理员核实</li>
      <li><b>差距 ≤ −1000</b>（蓝色行）= 报名分低于 STRATZ 真实段位 → 可能是马甲号或埋深</li>
      <li><b>未排位</b>：STRATZ 拉不到段位（可能没刷段位赛、或 Steam ID 错误、或国服数据不全）— 点"主页"链接手动核查</li>
      <li><b>STRATZ 国服数据局限</b>：很多国服玩家不在 STRATZ 主流数据池里，数据完整度不如东南亚/欧服。这是常态，不代表玩家可疑</li>
    </ul>
  </div>

  <div class="footer">
    <p>📊 数据来源 <a href="https://stratz.com" target="_blank">STRATZ.com</a> · 自动生成 · 信誉分系统配套工具</p>
    <p>🔄 更新方式：<code>node tools/rank-check.mjs</code> → <code>node tools/render-rank-check.mjs</code></p>
  </div>

</div>
</body>
</html>
`;

writeFileSync(join(__dirname, '..', 'analysis', '段位真实度.html'), html);
console.log('✓ analysis/段位真实度.html 已生成');
console.log(`  疑似虚报: ${dangerCount} ｜ 匹配: ${okCount} ｜ 低报高: ${infoCount} ｜ 待核查: ${muteCount}`);
