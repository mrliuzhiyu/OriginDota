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
  // d = 实战 - 报名: 正=段位低估，负=段位虚高
  if (d == null) return '<span class="b mute">—</span>';
  const arrow = d > 0 ? '↑' : (d < 0 ? '↓' : '');
  const text = `${arrow}${Math.abs(d)}${label}`;
  if (Math.abs(d) < 500) return `<span class="b ok">${text}</span>`;
  if (Math.abs(d) < 1000) return `<span class="b warn">${text}</span>`;
  return d > 0
    ? `<span class="b info">${text} 低估</span>`
    : `<span class="b danger">${text} 虚高</span>`;
}

function verdict(reported, combat) {
  if (combat == null || reported == null) return '— 未参赛 / 数据不足';
  // 实战 - 报名：正=段位低估（实力高于报名），负=段位虚高（报名高于实力）
  const diff = combat - reported;
  if (diff >= 1000) return '🔵 段位低估';
  if (diff <= -1000) return '🔴 段位虚高';
  if (Math.abs(diff) >= 500) return '🟡 略有偏差';
  return '🟢 报名属实';
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
  // 方向: 实战 - 报名 (正=大号藏分蓝色, 负=小号虚报红色)
  const diffCombat = (combat != null && reported != null) ? combat - reported : null;
  const cls = !p.combat_played ? 'row-mute'
    : diffCombat == null ? ''
    : diffCombat <= -1000 ? 'row-danger'   // 小号虚报（报名>实战）
    : diffCombat >= 1000 ? 'row-info'      // 大号藏分（实战>报名）
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

// 小号嫌疑 = 报名 > 实战 ≥ 1000 (虚报，假装大号)
// 大号嫌疑 = 实战 > 报名 ≥ 1000 (藏分，假装小号)
const fakeHigh = players.filter(p => p.combat_mmr_ai != null && p.reported != null && (p.reported - p.combat_mmr_ai) >= 1000).length;
const hidden = players.filter(p => p.combat_mmr_ai != null && p.reported != null && (p.combat_mmr_ai - p.reported) >= 1000).length;
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
      <div class="v">${fakeHigh}</div>
      <div class="l">🔴 段位虚高<br><span style="opacity:.6">报得比实力高 ≥ 1000</span></div>
    </div>
    <div class="stat info">
      <div class="v">${hidden}</div>
      <div class="l">🔵 段位低估<br><span style="opacity:.6">报得比实力低 ≥ 1000</span></div>
    </div>
    <div class="stat warn">
      <div class="v">${warn}</div>
      <div class="l">🟡 略有偏差<br><span style="opacity:.6">差 500-999</span></div>
    </div>
    <div class="stat ok">
      <div class="v">${ok}</div>
      <div class="l">🟢 报名属实<br><span style="opacity:.6">差 &lt; 500</span></div>
    </div>
    <div class="stat mute">
      <div class="v">${noData}</div>
      <div class="l">⚪ 未参赛<br><span style="opacity:.6">无法核查</span></div>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th style="width:50px;">报名</th>
        <th>玩家</th>
        <th class="num">报名分</th>
        <th class="num">AI 实战估算</th>
        <th class="num">实战 − 报名</th>
        <th>STRATZ 辅助</th>
        <th>主页</th>
        <th>判定</th>
        <th>分析依据</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <!-- 三角证据深挖 -->
  <section style="margin-top:48px;">
    <h2 style="font-size:22px; font-weight:600; padding-bottom:12px; margin-bottom:24px; border-bottom:2px solid var(--ink);">🔬 重点 4 人 · 三角证据深挖</h2>
    <p style="font-size:13px; color:var(--ink-soft); margin-bottom:24px;">
    <b>主轴：AI 实战 MMR</b>（5 局录像表现）｜ <b>辅助：STRATZ 国际服段位</b>（客观但国服数据少）｜ <b>对比：玩家自报段位</b>。
    判断报名分跟实力是否匹配——<b>段位虚高</b>（吹牛）或<b>段位低估</b>（实力被低估，可能藏分）。
    </p>

    <!-- 案例 1: Error 404 -->
    <div class="evidence-card danger">
      <div class="ec-head">🔴 #08 Error 404 · <b>段位虚高 ↓1075</b></div>
      <div class="ec-grid">
        <div class="ec-cell"><div class="ec-label">报名分</div><div class="ec-val">3000</div><div class="ec-src">玩家自填</div></div>
        <div class="ec-cell"><div class="ec-label">STRATZ 真实</div><div class="ec-val">~1925</div><div class="ec-src">守护 3 · 国际服客观</div></div>
        <div class="ec-cell"><div class="ec-label">AI 实战估算</div><div class="ec-val">~2000</div><div class="ec-src">2-01 录像分析</div></div>
        <div class="ec-cell highlight"><div class="ec-label">综合判定</div><div class="ec-val danger">段位虚高 ↓1075</div><div class="ec-src">三角全部印证</div></div>
      </div>
      <div class="ec-detail">
        <p><b>结论：报得比实力高 1075</b>，三角证据：</p>
        <ul>
          <li><b>STRATZ 客观数据（国际服）</b>：守护 3 = 1925 MMR。这是 STRATZ 极少数能拉到的国服玩家之一，说明他在国际服打过天梯 → 数据可信</li>
          <li><b>2-01 实战表现</b>：天涯墨客 0 杀 11 死 12 助攻，金钱/分 223（中分桌全场最低）。报名 3000 的玩家在中分桌（均分 3580）至少应该 2-3 杀</li>
          <li><b>STRATZ + 实战双重印证</b>：1925 vs 2000，两个独立数据源给出几乎相同结论 → <b>真实段位约 2000</b>，但报名时填了 3000</li>
        </ul>
        <p><b>建议</b>：下期改报 2000-2500，更符合实力。这次失信扣分跟虚报无关，但报名分应该校准。</p>
      </div>
    </div>

    <!-- 案例 2: 赵子龙 -->
    <div class="evidence-card danger">
      <div class="ec-head">🔴 #20 赵子龙 · <b>段位虚高 ↓1000</b></div>
      <div class="ec-grid">
        <div class="ec-cell"><div class="ec-label">报名分</div><div class="ec-val">5000</div><div class="ec-src">玩家自填</div></div>
        <div class="ec-cell"><div class="ec-label">STRATZ 真实</div><div class="ec-val">未排位</div><div class="ec-src">国服 STRATZ 无数据</div></div>
        <div class="ec-cell"><div class="ec-label">AI 实战估算</div><div class="ec-val">~4000</div><div class="ec-src">1-01 + 1-02 双场</div></div>
        <div class="ec-cell highlight"><div class="ec-label">综合判定</div><div class="ec-val danger">段位虚高 ↓1000</div><div class="ec-src">双场样本 + 同位对比</div></div>
      </div>
      <div class="ec-detail">
        <p><b>结论：实力 4000 但报 5000，虚高 1000</b>。证据：</p>
        <ul>
          <li><b>1-01 高分桌 1 号位幻影刺客</b>：5/7/7，正补 335（全场最高），金钱/分 551 — 数据像 4500 段位，不像 5000</li>
          <li><b>1-02 高分桌 5 号位司夜刺客</b>：5/15/29，<b>15 死全场最高</b> — 5 号位 15 死说明视野判断 / 走位有问题</li>
          <li><b>同位对比</b>：报 6000 的 苏三 SS 在 1-01 编织者 1 号位打出 18/4 — 5000 段位的 PA 至少应该 8/4，5/7 偏低</li>
          <li><b>桌位印证</b>：1-01 是高分桌（均分 5650），队友 6000+，赵子龙打不出 5000 应有水平</li>
        </ul>
        <p><b>建议</b>：下期改报 4000-4500。<b>注意</b>：可能是当晚状态差 / 不熟悉英雄，建议再观察 2-3 期定论，不要立刻判罚。</p>
      </div>
    </div>

    <!-- 案例 3: AR.Chalice -->
    <div class="evidence-card info">
      <div class="ec-head">🔵 #38 AR.Chalice · <b>段位低估 ↑1300（最严重）</b></div>
      <div class="ec-grid">
        <div class="ec-cell"><div class="ec-label">报名分</div><div class="ec-val">4500</div><div class="ec-src">玩家自填</div></div>
        <div class="ec-cell"><div class="ec-label">STRATZ 真实</div><div class="ec-val">未排位</div><div class="ec-src">国服 STRATZ 无数据</div></div>
        <div class="ec-cell"><div class="ec-label">AI 实战估算</div><div class="ec-val">~5800</div><div class="ec-src">2-01 + 2-02 双场神级</div></div>
        <div class="ec-cell highlight"><div class="ec-label">综合判定</div><div class="ec-val info">段位低估 ↑1300</div><div class="ec-src">双场神级 + 同位对比</div></div>
      </div>
      <div class="ec-detail">
        <p><b>结论：实力 5800 但报 4500，低估 1300</b>（疑似藏分）。证据：</p>
        <ul>
          <li><b>2-01 中分桌主宰（1 号位）</b>：<b>11 杀 0 死</b> 6 助攻，金钱/分 769。1 号 carry 全场 0 死亡是顶级标志（绝大多数 5500+ 玩家也做不到）</li>
          <li><b>2-02 中分桌幻影刺客（1 号位）</b>：<b>18 杀 4 死 15 助攻</b>，金钱/分 797（全场最佳），6 个多杀（4 双 + 2 三）</li>
          <li><b>关键同位对比</b>：报 <b>6000</b> 的苏三 SS 在 1-01 编织者 1 号位打出 18/4/12 — <b>跟 AR.Chalice 18/4 PA 数据完全一样</b>。SS 报 6000，AR.Chalice 报 4500，但表现一样</li>
          <li><b>稳定性印证</b>：双场都顶级（不是单场运气）。0 死 carry + 6 个多杀 = 走位、装备节奏、收割能力全到顶级</li>
        </ul>
        <p><b>建议</b>：下期强制改报 <b>5500-6000</b>。如果继续报 4500 进中分桌，会再次碾压破坏游戏体验。最严厉做法：升到高分桌打 6000+ 玩家。</p>
      </div>
    </div>

    <!-- 案例 4: 攻击精神 -->
    <div class="evidence-card info">
      <div class="ec-head">🔵 #24 攻击精神 · <b>段位低估 ↑1500（最显眼）</b></div>
      <div class="ec-grid">
        <div class="ec-cell"><div class="ec-label">报名分</div><div class="ec-val">1500</div><div class="ec-src">玩家自填 仅 2 号位</div></div>
        <div class="ec-cell"><div class="ec-label">STRATZ 真实</div><div class="ec-val">未排位</div><div class="ec-src">国服 STRATZ 无数据</div></div>
        <div class="ec-cell"><div class="ec-label">AI 实战估算</div><div class="ec-val">~3000</div><div class="ec-src">3-01 神级 + 1-02 借调</div></div>
        <div class="ec-cell highlight"><div class="ec-label">综合判定</div><div class="ec-val info">段位低估 ↑1500</div><div class="ec-src">普通桌 0 死神级</div></div>
      </div>
      <div class="ec-detail">
        <p><b>结论：实力 3000 但报 1500，低估 1500</b>（普通桌神级表现明显藏分）。证据：</p>
        <ul>
          <li><b>3-01 普通桌中单痛苦女王</b>：<b>12 杀 0 死</b> 13 助攻，金钱/分 516。<b>0 死亡是全场所有玩家最低死亡数</b>（连 5 号支持都死了 4+ 次）</li>
          <li><b>普通桌均分 1750</b>，对手都是 1500 或更低段位的玩家。在这种环境下打出 mid 痛苦女王 12/0 是「专精玩家碾压低分对手」的典型表现</li>
          <li><b>1-02 借调到高分桌</b>：4 号位痛苦女王 5/10/22，金钱/分 395。借调到 5500+ 高分桌也能拿 5 杀 22 助攻 → 实力远超 1500</li>
          <li><b>专精迹象</b>：报名时写「仅 2 号位」 — 通常这种"仅 X 位"玩家把一个位置 / 几个英雄练得很专精，实战大于天梯段位</li>
        </ul>
        <p><b>建议</b>：下期强制改报 <b>2500-3000</b>，让他打中分桌。如果继续报 1500 进普通桌，纯属欺负低分玩家。</p>
      </div>
    </div>
  </section>

  <style>
    .evidence-card { border:2px solid var(--line); padding:20px 24px; margin-bottom:20px; background:var(--bg); }
    .evidence-card.danger { border-color:var(--danger); background:#fff8f8; }
    .evidence-card.info { border-color:var(--info); background:#f0f8fa; }
    .ec-head { font-size:16px; font-weight:700; margin-bottom:14px; padding-bottom:10px; border-bottom:1px dashed var(--line); }
    .ec-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:14px; }
    .ec-cell { padding:10px 12px; background:var(--bg); border:1px solid var(--line); text-align:center; }
    .ec-cell.highlight { background:#fffae8; border-color:var(--gold); }
    .ec-cell .ec-label { font-size:10px; letter-spacing:1px; color:var(--ink-mute); margin-bottom:4px; }
    .ec-cell .ec-val { font-size:18px; font-weight:700; font-feature-settings:"tnum"; }
    .ec-cell .ec-val.danger { color:var(--danger); font-size:15px; }
    .ec-cell .ec-val.info { color:var(--info); font-size:15px; }
    .ec-cell .ec-src { font-size:10px; color:var(--ink-mute); margin-top:4px; }
    .ec-detail { font-size:13px; color:var(--ink-soft); line-height:1.7; }
    .ec-detail p { margin-bottom:8px; }
    .ec-detail ul { margin-left:20px; }
    .ec-detail li { margin-bottom:6px; }
    .ec-detail b { color:var(--ink); }
    @media (max-width:760px) { .ec-grid { grid-template-columns:1fr 1fr; } }
  </style>

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
    <h3 style="margin-top:14px;">本期重点关注 4 人</h3>
    <ul>
      <li>🔴 <b>Error 404</b> · 段位虚高 ↓1075 ｜ 报 3000 但 STRATZ 守护 3 (1925) + 实战 0/11/12 ≈ <b>实力 2000</b></li>
      <li>🔴 <b>赵子龙</b> · 段位虚高 ↓1000 ｜ 报 5000 但 PA 5/7 + 司夜刺客 5/15 ≈ <b>实力 4000</b></li>
      <li>🔵 <b>AR.Chalice</b> · 段位低估 ↑1300 ｜ 报 4500 但主宰 11/0 + PA 18/4 双场神级 ≈ <b>实力 5800</b></li>
      <li>🔵 <b>攻击精神</b> · 段位低估 ↑1500 ｜ 报 1500 但痛苦女王 12/0 神级 + 高分桌借调能用 ≈ <b>实力 3000</b></li>
    </ul>
    <p style="margin-top:10px;"><b>术语</b>：<br>
    🔴 <b>段位虚高</b>↓ = 报名分高于实战水平（吹牛 / 实力不符）<br>
    🔵 <b>段位低估</b>↑ = 报名分低于实战水平（藏分 / 大佬潜伏）</p>
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
console.log(`  🔴 段位虚高: ${fakeHigh} 人 (报名 > 实战 ≥ 1000)`);
console.log(`  🔵 段位低估: ${hidden} 人 (实战 > 报名 ≥ 1000)`);
console.log(`  🟡 略偏差: ${warn} 人`);
console.log(`  🟢 报名属实: ${ok} 人`);
console.log(`  ⊘ 未参赛: ${noData} 人`);
