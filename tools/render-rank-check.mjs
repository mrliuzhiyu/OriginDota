#!/usr/bin/env node
// render-rank-check.mjs
// 段位真实度 HTML 报告。优先用 AI 实战 MMR 估算（基于录像），STRATZ 数据作辅助。
//
// 输入: tools/players.json (含 combat_mmr_ai 字段) + tools/rank-check-output.json (可选 STRATZ 数据)
// 输出: analysis/段位真实度.html

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const players = JSON.parse(readFileSync(join(__dirname, 'players.json'), 'utf-8')).players;

// 可选：读 STRATZ 数据（如果已跑过 rank-check.mjs）
const stratzPath = join(__dirname, 'rank-check-output.json');
const stratzMap = {};
if (existsSync(stratzPath)) {
  const arr = JSON.parse(readFileSync(stratzPath, 'utf-8'));
  for (const r of arr) stratzMap[r.n] = r;
}

function diffBadge(d, label = '') {
  if (d == null) return '<span class="b mute">—</span>';
  const sign = d > 0 ? '+' : '';
  if (Math.abs(d) < 500) return `<span class="b ok">${sign}${d}${label}</span>`;
  if (Math.abs(d) < 1000) return `<span class="b warn">${sign}${d}${label}</span>`;
  return `<span class="b danger">${sign}${d}${label}</span>`;
}

function verdict(reported, combat) {
  if (combat == null || reported == null) return '— 未参赛 / 数据不足';
  const diff = reported - combat;
  if (diff >= 1000) return '🔴 高分低报（报名 > 实战 ≥ 1000）';
  if (diff <= -1000) return '🔴 低分高报（实战 > 报名 ≥ 1000，疑藏分）';
  if (Math.abs(diff) >= 500) return '🟡 略有偏差（500-999）';
  return '🟢 报名与实战匹配';
}

const stratzUrl = (id64) => id64
  ? `https://stratz.com/players/${BigInt(id64) - 76561197960265728n}`
  : null;

const rows = players.map(p => {
  const stratz = stratzMap[p.n];
  const reported = p.reported;
  const combat = p.combat_mmr_ai;
  const stratzMmr = stratz?.real_mmr;
  const stratzName = stratz?.rank_name;
  const sUrl = stratzUrl(p.steam_id);
  const diffCombat = (combat != null && reported != null) ? reported - combat : null;
  const cls = !p.combat_played ? 'row-mute'
    : diffCombat == null ? ''
    : diffCombat >= 1000 ? 'row-danger'
    : diffCombat <= -1000 ? 'row-info'
    : Math.abs(diffCombat) >= 500 ? 'row-warn' : '';

  return `
  <tr class="${cls}">
    <td class="num">#${String(p.n).padStart(2, '0')}</td>
    <td class="name">${p.name}</td>
    <td class="num">${reported ?? '—'}</td>
    <td class="num">${combat ?? '—'}${combat ? ` <span class="games">(${p.combat_played} 局)</span>` : ''}</td>
    <td class="num">${diffBadge(diffCombat)}</td>
    <td>${stratzMmr ? `${stratzName} (${stratzMmr})` : '—'}</td>
    <td>${sUrl ? `<a href="${sUrl}" target="_blank">主页</a>` : '—'}</td>
    <td class="status">${verdict(reported, combat)}</td>
    <td class="note">${p.combat_note || ''}</td>
  </tr>`;
}).join('');

const dangerHigh = players.filter(p => p.combat_mmr_ai != null && p.reported != null && p.reported - p.combat_mmr_ai >= 1000).length;
const dangerLow = players.filter(p => p.combat_mmr_ai != null && p.reported != null && p.reported - p.combat_mmr_ai <= -1000).length;
const warn = players.filter(p => p.combat_mmr_ai != null && p.reported != null && Math.abs(p.reported - p.combat_mmr_ai) >= 500 && Math.abs(p.reported - p.combat_mmr_ai) < 1000).length;
const ok = players.filter(p => p.combat_mmr_ai != null && p.reported != null && Math.abs(p.reported - p.combat_mmr_ai) < 500).length;
const noData = players.filter(p => !p.combat_played).length;

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
  .page{max-width:1280px;margin:0 auto;padding:48px 32px 80px}
  .actions{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;margin-bottom:24px;border-bottom:1px solid var(--line)}
  .crumb{font-size:12px;color:var(--ink-mute);letter-spacing:1px}
  .crumb a{color:var(--ink-soft);text-decoration:none;border-bottom:1px dotted var(--ink-mute)}
  .actions button{padding:8px 14px;font-size:12px;border:1px solid var(--ink);background:var(--bg);color:var(--ink);cursor:pointer;font-family:inherit;letter-spacing:1px}
  header{text-align:center;margin-bottom:36px;padding-bottom:24px;border-bottom:2px solid var(--ink)}
  header .eyebrow{font-size:11px;letter-spacing:5px;color:var(--ink-mute);margin-bottom:12px}
  header h1{font-size:28px;font-weight:600;letter-spacing:1px}
  header .meta{margin-top:10px;font-size:13px;color:var(--ink-soft)}
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:32px}
  .stat{border:1px solid var(--line);background:var(--bg-card);padding:16px;text-align:center}
  .stat .v{font-size:30px;font-weight:700;font-feature-settings:"tnum"}
  .stat .l{font-size:11px;letter-spacing:1px;color:var(--ink-mute);margin-top:4px}
  .stat.ok .v{color:var(--ok)}
  .stat.warn .v{color:var(--warn)}
  .stat.danger .v{color:var(--danger)}
  .stat.info .v{color:var(--info)}
  .stat.mute .v{color:var(--ink-mute)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px}
  th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;letter-spacing:1px;color:var(--ink-mute);background:var(--bg-card);font-weight:500}
  td.num{text-align:right;font-feature-settings:"tnum";font-weight:500;white-space:nowrap}
  td.name{font-weight:600;white-space:nowrap}
  td.note{font-size:11px;color:var(--ink-soft);line-height:1.5;max-width:380px}
  td.status{font-size:12px;color:var(--ink-soft);white-space:nowrap}
  td .games{font-size:10px;color:var(--ink-mute);font-weight:400;font-feature-settings:normal}
  tr.row-danger td{background:var(--danger-bg)}
  tr.row-info td{background:var(--info-bg)}
  tr.row-warn td{background:var(--warn-bg)}
  tr.row-mute td{color:var(--ink-mute)}
  tr.row-mute td.name{color:var(--ink)}
  .b{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;letter-spacing:0.5px;border-radius:2px;font-feature-settings:"tnum"}
  .b.ok{background:var(--ok-bg);color:var(--ok)}
  .b.warn{background:var(--warn-bg);color:var(--warn)}
  .b.danger{background:var(--danger-bg);color:var(--danger)}
  .b.mute{background:#f5f5f5;color:var(--ink-mute)}
  .notes{margin-top:32px;padding:18px 22px;background:var(--bg-card);border-left:3px solid var(--ink-mute);font-size:12px;color:var(--ink-soft);line-height:1.8}
  .notes h3{font-size:13px;color:var(--ink);margin-bottom:8px;letter-spacing:1px}
  .notes ul{margin-left:20px}
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
    <div class="eyebrow">原点 DOTA2 内战 · 防止虚报 · AI 实战分析</div>
    <h1>段位真实度核查</h1>
    <div class="meta">
      数据：38 位报名玩家 · 22 人实际参赛 · AI 基于 5 局录像表现估算实战 MMR · 报名分对比
    </div>
  </header>

  <section class="stats">
    <div class="stat danger">
      <div class="v">${dangerHigh}</div>
      <div class="l">高分低报<br>（差 ≥ +1000）</div>
    </div>
    <div class="stat info">
      <div class="v">${dangerLow}</div>
      <div class="l">低分高报<br>（差 ≤ −1000）</div>
    </div>
    <div class="stat warn">
      <div class="v">${warn}</div>
      <div class="l">略偏差<br>（500-999）</div>
    </div>
    <div class="stat ok">
      <div class="v">${ok}</div>
      <div class="l">报名匹配<br>（差 < 500）</div>
    </div>
    <div class="stat mute">
      <div class="v">${noData}</div>
      <div class="l">未参赛<br>无法核查</div>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th style="width:50px;">报名</th>
        <th>玩家</th>
        <th class="num">报名分</th>
        <th class="num">AI 实战估算</th>
        <th class="num">差距</th>
        <th>STRATZ 段位</th>
        <th>主页</th>
        <th>结论</th>
        <th>分析依据</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <div class="notes">
    <h3>关于核查方法</h3>
    <ul>
      <li><b>报名分</b>：玩家自填（接龙时写的 MMR）</li>
      <li><b>AI 实战估算</b>：基于本期 5 局录像的实际表现（KDA / GPM / XPM / 位置）综合判断的 MMR</li>
      <li><b>差距 ≥ +1000 (红色)</b>：报名分明显高于实战 → 疑似<b>高分低报</b>（虚高），建议管理员核实</li>
      <li><b>差距 ≤ −1000 (蓝色)</b>：实战段位高于报名 → 疑似<b>低分高报</b>（藏分子），可能是马甲号</li>
      <li><b>500-999 偏差 (黄色)</b>：略有偏差，可接受</li>
      <li><b>STRATZ 段位</b>：第三方数据（参考）。国服玩家很多在 STRATZ 上"未排位"是正常的（因为 STRATZ 拿不到国服天梯数据），不代表玩家可疑</li>
    </ul>
    <h3 style="margin-top:14px;">本期重点关注</h3>
    <ul>
      <li>🔴 <b>Error 404</b>：报 3000，STRATZ 守护 3 (1925)，实战 0/11/12 ｜ <b>高分低报 +1000 已确认</b></li>
      <li>🔴 <b>赵子龙</b>：报 5000，PA 5/7/7 + 司夜刺客 5/15 ｜ 双场表现像 4000 ｜ <b>高分低报 +1000</b></li>
      <li>🔴 <b>攻击精神</b>：报 1500，3-01 痛苦女王 12/0/13 神级 ｜ <b>低分高报 −1500（疑藏分）</b></li>
      <li>🔴 <b>AR.Chalice</b>：报 4500，主宰 11/0 + PA 18/4 双场 carry 神级 ｜ <b>低分高报 −1300（实力 5500+）</b></li>
    </ul>
  </div>

  <div class="footer">
    <p>📊 数据：5/9 五局录像 (OpenDota Parser) + STRATZ (辅助) ｜ AI: Claude</p>
    <p>🔄 更新流程：<code>node tools/render-rank-check.mjs</code></p>
  </div>

</div>
</body>
</html>
`;

writeFileSync(join(__dirname, '..', 'analysis', '段位真实度.html'), html);
console.log('✓ analysis/段位真实度.html 已生成');
console.log(`\n核查结果：`);
console.log(`  🔴 高分低报: ${dangerHigh} 人 (报名 > 实战 ≥ 1000)`);
console.log(`  🔵 低分高报: ${dangerLow} 人 (实战 > 报名 ≥ 1000)`);
console.log(`  🟡 略偏差: ${warn} 人`);
console.log(`  🟢 匹配: ${ok} 人`);
console.log(`  ⊘ 未参赛: ${noData} 人`);
