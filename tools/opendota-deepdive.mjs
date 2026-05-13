#!/usr/bin/env node
// opendota-deepdive.mjs
// 通过 OpenDota 免费 API 调查玩家真实段位，输出推荐分段 + 主玩位置 + 主玩英雄。
// 适用于"自报无段位 / 自己估不准"的玩家（如冠绝快速匹配玩家）。
//
// 用法:
//   单个: node tools/opendota-deepdive.mjs 350060373
//   批量: node tools/opendota-deepdive.mjs 350060373 130401362 294917742
//   从文件: node tools/opendota-deepdive.mjs --file tools/deepdive-ids.txt
//   全员: node tools/opendota-deepdive.mjs --all   # 读 tools/players.json 里所有 steam_id
//
// 输出:
//   tools/deepdive-output.json    机器可读，所有原始字段 + 推荐
//   tools/deepdive-report.md      人读，每人一段总结，可粘到花名册"段位深挖"区

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const OPENDOTA = 'https://api.opendota.com/api';

// ===== rank_tier (Dota medal) → 中文段位 + MMR 中点 =====
// 编码: 第一位段, 第二位星 (1=先驱..7=神族, 80=冠绝)
function decodeRank(tier) {
  if (tier == null || tier === 0) return { name: '未排位', mmr: null };
  if (tier >= 80) return { name: '冠绝', mmr: 5500 };
  const tiers = ['先驱', '卫士', '十字军', '执政官', '传奇', '万古', '超凡'];
  const big = Math.floor(tier / 10);
  const star = tier % 10;
  const name = tiers[big - 1] || `?`;
  // 每个大段约 770 分，每星约 154 分
  const mmrMid = (big - 1) * 770 + (star - 0.5) * 154;
  return { name: `${name} ${star}`, mmr: Math.round(mmrMid) };
}

// SteamID64 → SteamID32 (Dota account_id)
function id64to32(id64) {
  if (!id64) return null;
  return Number(BigInt(id64) - 76561197960265728n);
}

async function fetchJson(url, label, { optional = false, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'OriginDota/0.1 (opendota-deepdive)' },
      });
      if (resp.status === 404) return null;
      if (resp.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!resp.ok) {
        if (optional) {
          console.warn(`  ⚠ ${label} HTTP ${resp.status}（跳过，非必需）`);
          return null;
        }
        throw new Error(`${label} HTTP ${resp.status}`);
      }
      return resp.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
    }
  }
  if (optional) {
    console.warn(`  ⚠ ${label} 重试 ${retries} 次仍失败（跳过）`);
    return null;
  }
  throw lastErr;
}

// ===== 给一个 Dota account_id 深挖 =====
async function deepDive(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) {
    return { id: accountId, error: '无效的 account_id（必须是整数 Dota ID）' };
  }

  const result = { id, fetchedAt: new Date().toISOString() };

  // 1) profile
  const profile = await fetchJson(`${OPENDOTA}/players/${id}`, 'profile');
  if (!profile || !profile.profile) {
    return { id, error: 'OpenDota 无此玩家' };
  }
  result.persona = profile.profile.personaname;
  result.steamid = profile.profile.steamid;
  result.plus = !!profile.profile.plus;
  result.rank_tier = profile.rank_tier;
  result.leaderboard_rank = profile.leaderboard_rank;
  result.computed_mmr = profile.computed_mmr;
  result.computed_mmr_turbo = profile.computed_mmr_turbo;
  result.aliases = (profile.aliases || []).map(a => a.personaname);

  // 2) total W/L
  const wl = await fetchJson(`${OPENDOTA}/players/${id}/wl`, 'wl', { optional: true });
  if (wl) {
    result.total_win = wl.win;
    result.total_lose = wl.lose;
    result.total_games = wl.win + wl.lose;
    result.total_winrate = result.total_games ? +(wl.win * 100 / result.total_games).toFixed(2) : null;
  }

  // 3) counts (game_mode / lobby_type / lane_role)
  const counts = await fetchJson(`${OPENDOTA}/players/${id}/counts`, 'counts', { optional: true });
  if (counts) {
    result.ranked_games = counts.lobby_type?.['7']?.games || 0;
    result.normal_games = counts.lobby_type?.['0']?.games || 0;
    // 各 lane 分布
    result.lane_dist = {};
    for (const [k, v] of Object.entries(counts.lane_role || {})) {
      result.lane_dist[k] = v.games;
    }
  }

  // 4) recent 30 matches
  const matches = await fetchJson(`${OPENDOTA}/players/${id}/matches?limit=30`, 'matches', { optional: true });
  if (matches && matches.length) {
    const ranks = matches.map(m => m.average_rank).filter(r => r != null && r > 0);
    ranks.sort((a, b) => a - b);
    const median = ranks.length ? ranks[Math.floor(ranks.length / 2)] : null;
    const min = ranks[0];
    const max = ranks[ranks.length - 1];
    result.recent_count = matches.length;
    result.recent_avg_rank_min = min;
    result.recent_avg_rank_max = max;
    result.recent_avg_rank_median = median;
    // mode 分布
    result.recent_modes = {};
    for (const m of matches) {
      const key = `${m.game_mode}/${m.lobby_type}`;
      result.recent_modes[key] = (result.recent_modes[key] || 0) + 1;
    }
    // hero 频次
    const heroFreq = {};
    for (const m of matches) heroFreq[m.hero_id] = (heroFreq[m.hero_id] || 0) + 1;
    result.recent_top_heroes = Object.entries(heroFreq)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([h, c]) => ({ hero_id: +h, games: c }));
    // 最近 lane_role (从 lane_dist 已拿过历史，这里看最近)
    const recLaneFreq = {};
    for (const m of matches) {
      if (m.lane_role) recLaneFreq[m.lane_role] = (recLaneFreq[m.lane_role] || 0) + 1;
    }
    result.recent_lane = recLaneFreq;
  }

  // ===== 推荐段位 =====
  const sources = [];
  // (a) computed_mmr_turbo
  if (result.computed_mmr_turbo) {
    sources.push({ src: 'OpenDota turbo MMR', mmr: Math.round(result.computed_mmr_turbo) });
  }
  // (b) computed_mmr (ranked)
  if (result.computed_mmr) {
    sources.push({ src: 'OpenDota ranked MMR', mmr: Math.round(result.computed_mmr) });
  }
  // (c) 最近 lobby 平均段位中位数
  if (result.recent_avg_rank_median) {
    const r = decodeRank(result.recent_avg_rank_median);
    if (r.mmr) sources.push({ src: `最近 lobby 中位数（${r.name}）`, mmr: r.mmr });
  }
  // (d) profile rank_tier
  if (result.rank_tier) {
    const r = decodeRank(result.rank_tier);
    if (r.mmr) {
      const lbHint = result.leaderboard_rank ? `榜 ${result.leaderboard_rank}` : '';
      sources.push({ src: `Profile rank_tier（${r.name}${lbHint ? ' · ' + lbHint : ''}）`, mmr: r.mmr });
    }
  }
  result.recommendation_sources = sources;

  if (sources.length) {
    // 折中：取所有数据源 MMR 的中位数
    const mmrs = sources.map(s => s.mmr).sort((a, b) => a - b);
    const recommended = mmrs[Math.floor(mmrs.length / 2)];
    result.recommended_mmr = recommended;
    result.recommended_tier = mmrToTierName(recommended);
  } else {
    result.recommended_mmr = null;
    result.recommended_tier = '数据不足';
  }

  // 推荐位置：基于 lane_dist + recent_lane
  const laneSum = { ...(result.lane_dist || {}) };
  for (const [k, v] of Object.entries(result.recent_lane || {})) {
    laneSum[k] = (laneSum[k] || 0) + v * 10; // 最近权重 ×10
  }
  delete laneSum['0']; // 0 = unknown
  const lanes = Object.entries(laneSum).sort((a, b) => b[1] - a[1]);
  if (lanes.length) {
    const top = lanes[0][0];
    result.recommended_position = laneName(top);
  } else {
    result.recommended_position = '不明';
  }

  return result;
}

function mmrToTierName(mmr) {
  if (mmr >= 5500) return '冠绝 / 超凡';
  if (mmr >= 4400) return '超凡 1-5';
  if (mmr >= 3700) return '万古 1-5';
  if (mmr >= 3000) return '传奇 1-5';
  if (mmr >= 2200) return '执政官 1-5';
  if (mmr >= 1500) return '十字军 1-5';
  if (mmr >= 770) return '卫士 1-5';
  return '先驱 1-5';
}

function laneName(lane) {
  return ({ '1': '安全路 / 1·2 号位', '2': '中路 / 2 号位', '3': '劣单 / 3 号位', '4': '游走辅助 / 4·5 号位' })[lane] || `lane ${lane}`;
}

// ===== Markdown 报告生成 =====
function renderMarkdown(results) {
  const lines = [];
  lines.push('# 段位深挖报告');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('');
  for (const r of results) {
    if (r.error) {
      lines.push(`## ID ${r.id} — ❌ ${r.error}`);
      lines.push('');
      continue;
    }
    lines.push(`## ${r.persona || '(无名)'} · Dota ID ${r.id}`);
    lines.push('');
    lines.push(`- **Steam ID**: \`${r.steamid || '?'}\`${r.plus ? ' · Plus' : ''}`);
    if (r.aliases?.length) {
      const aliasesShort = r.aliases.slice(0, 5).join(' / ');
      lines.push(`- **历史别名**: ${aliasesShort}${r.aliases.length > 5 ? ` · 共 ${r.aliases.length} 个` : ''}`);
    }
    if (r.total_games) {
      lines.push(`- **总局**: ${r.total_games}（天梯 ${r.ranked_games || '?'} + 普通 ${r.normal_games || '?'}）· 胜率 **${r.total_winrate}%**`);
    }
    const profileTier = r.rank_tier ? decodeRank(r.rank_tier).name : '未排位';
    const lbStr = r.leaderboard_rank ? `（榜 ${r.leaderboard_rank}）` : '';
    lines.push(`- **Profile 段位**: ${profileTier}${lbStr}${r.computed_mmr ? ` · ranked MMR 估算 ${Math.round(r.computed_mmr)}` : ''}${r.computed_mmr_turbo ? ` · turbo MMR 估算 ${Math.round(r.computed_mmr_turbo)}` : ''}`);
    if (r.recent_avg_rank_median) {
      const med = decodeRank(r.recent_avg_rank_median);
      const min = decodeRank(r.recent_avg_rank_min);
      const max = decodeRank(r.recent_avg_rank_max);
      lines.push(`- **最近 ${r.recent_count} 局 lobby 平均段位**: ${min.name} → ${max.name} · 中位数 **${med.name}**`);
    }
    if (r.recent_top_heroes?.length) {
      const hs = r.recent_top_heroes.map(h => `${heroName(h.hero_id)} ×${h.games}`).join(' / ');
      lines.push(`- **最近主玩**: ${hs}`);
    }
    lines.push('');
    if (r.recommended_mmr) {
      lines.push(`> 🎯 **推荐段位：${r.recommended_mmr} ${r.recommended_tier}** · 主玩 ${r.recommended_position}`);
      const srcLines = r.recommendation_sources.map(s => `${s.src} → ${s.mmr}`).join(' ｜ ');
      lines.push(`> 数据源：${srcLines}`);
    } else {
      lines.push('> ⚠ 数据不足，无法推荐段位');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// 英雄 ID → 中文名（heroes-cn.json 是 {id: name} 平铺 map）
let HERO_MAP = null;
function heroName(id) {
  if (!HERO_MAP) {
    const path = join(__dirname, 'heroes-cn.json');
    if (existsSync(path)) {
      try { HERO_MAP = JSON.parse(readFileSync(path, 'utf-8')); }
      catch { HERO_MAP = {}; }
    } else HERO_MAP = {};
  }
  return HERO_MAP[String(id)] || HERO_MAP[id] || `h${id}`;
}

// ===== CLI =====
async function main() {
  const args = process.argv.slice(2);
  let ids = [];

  if (args[0] === '--all') {
    const players = JSON.parse(readFileSync(join(__dirname, 'players.json'), 'utf-8')).players;
    for (const p of players) {
      if (p.steam_id) {
        const id32 = id64to32(p.steam_id);
        if (id32) ids.push(id32);
      }
    }
    console.log(`从 players.json 读出 ${ids.length} 个有 Steam ID 的玩家`);
  } else if (args[0] === '--file' && args[1]) {
    const content = readFileSync(args[1], 'utf-8');
    ids = content.split(/\s+/).map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  } else if (args.length) {
    ids = args.map(Number).filter(Number.isFinite);
  } else {
    console.error('用法:');
    console.error('  node tools/opendota-deepdive.mjs <accountId> [accountId...]');
    console.error('  node tools/opendota-deepdive.mjs --file tools/deepdive-ids.txt');
    console.error('  node tools/opendota-deepdive.mjs --all   # 跑 players.json 里所有人');
    process.exit(1);
  }

  if (!ids.length) { console.error('没有 ID 可处理'); process.exit(1); }

  console.log(`\n===== OpenDota 段位深挖 · ${ids.length} 人 =====\n`);
  const results = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    process.stdout.write(`[${i + 1}/${ids.length}] ${id} ... `);
    try {
      const r = await deepDive(id);
      results.push(r);
      if (r.error) {
        console.log(`❌ ${r.error}`);
      } else {
        const rec = r.recommended_mmr ? `${r.recommended_mmr} ${r.recommended_tier} · ${r.recommended_position}` : '数据不足';
        console.log(`${r.persona || '?'} · ${rec}`);
      }
    } catch (e) {
      const err = { id, error: e.message };
      results.push(err);
      console.log(`❌ ${e.message}`);
    }
    // OpenDota 免费 API 速率 60 req/min。我们每人 4 次请求，所以单人间隔 ~5s 比较稳。
    if (i < ids.length - 1) await new Promise(r => setTimeout(r, 5000));
  }

  const outJson = join(__dirname, 'deepdive-output.json');
  const outMd = join(__dirname, 'deepdive-report.md');
  writeFileSync(outJson, JSON.stringify(results, null, 2));
  writeFileSync(outMd, renderMarkdown(results));
  console.log(`\n✓ 完成`);
  console.log(`  JSON: ${outJson}`);
  console.log(`  报告: ${outMd}`);
  console.log(`\n下一步：把 deepdive-report.md 里的段落贴到花名册的"段位深挖"区，或人工核查后定段位。`);
}

main().catch(e => { console.error(e); process.exit(1); });
