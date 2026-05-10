#!/usr/bin/env node
// rank-check.mjs
// 拉 STRATZ 段位数据 + 跟玩家自报分数对比，标红虚报 ≥1000 分。
//
// 用法:
//   $env:STRATZ_TOKEN="<token>"; node tools/rank-check.mjs
//   输出: tools/rank-check-output.json + tools/rank-check-report.html

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.STRATZ_TOKEN;
if (!TOKEN) {
  console.error('错误: 缺少环境变量 STRATZ_TOKEN');
  console.error('用法: $env:STRATZ_TOKEN="..."; node tools/rank-check.mjs');
  process.exit(1);
}

const STRATZ_URL = 'https://api.stratz.com/graphql';
const players = JSON.parse(readFileSync(join(__dirname, 'players.json'), 'utf-8')).players;

// ===== STRATZ rankTier → 中文段位 + MMR 中点 =====
// 编码规则: 第一位是大段(1=先驱…7=神族, 8=超凡入圣)；第二位是星级 1-5
function decodeRank(tier) {
  if (tier == null) return { name: '未排位', mmr: null };
  if (tier >= 80) return { name: '超凡入圣（不朽）', mmr: 5500 };
  const tiers = ['先驱', '卫士', '守护', '十字军', '执政官', '传奇', '万古流芳', '神族'];
  const big = Math.floor(tier / 10);
  const star = tier % 10;
  const name = tiers[big - 1] || `?`;
  // MMR 中点估算: 每个大段 770 分，每星 154 分
  const mmrBase = (big - 1) * 770;
  const mmrMid = mmrBase + (star - 0.5) * 154;
  return { name: `${name} ${star}`, mmr: Math.round(mmrMid) };
}

// 转换 SteamID64 → SteamID32（STRATZ 要 32 位）
function id64to32(id64) {
  if (!id64) return null;
  return Number(BigInt(id64) - 76561197960265728n);
}

const QUERY = `
query PlayerRank($id: Long!) {
  player(steamAccountId: $id) {
    steamAccount {
      id
      name
      seasonRank
      seasonLeaderboardRank
      smurfFlag
    }
    matchCount
    winCount
    behaviorScore
    firstMatchDate
    lastMatchDate
    matches(request: {take: 30, isParsed: true}) {
      rank
      durationSeconds
    }
  }
}`;

async function fetchPlayer(steamId32) {
  const resp = await fetch(STRATZ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'OriginDota/0.1 (rank-check)',
    },
    body: JSON.stringify({ query: QUERY, variables: { id: steamId32 } }),
  });
  if (resp.status >= 500) throw new Error(`STRATZ ${resp.status}`);
  const body = await resp.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data?.player;
}

console.log('===== 段位真实度验证 =====\n');
const results = [];
for (const p of players) {
  if (!p.steam_id) {
    results.push({ ...p, status: 'no_id', note: 'Steam ID 未填' });
    console.log(`⊘ #${p.n} ${p.name.padEnd(20)}  无 Steam ID`);
    continue;
  }
  const id32 = id64to32(p.steam_id);
  try {
    const data = await fetchPlayer(id32);
    if (!data) {
      results.push({ ...p, status: 'not_found', note: 'STRATZ 无此玩家数据' });
      console.log(`✗ #${p.n} ${p.name.padEnd(20)}  STRATZ 无数据`);
      continue;
    }

    // 优先用 seasonRank（当季）；为空则用 leaderboard / 最近比赛平均段位推估
    const seasonRank = data.steamAccount?.seasonRank;
    const lbRank = data.steamAccount?.seasonLeaderboardRank;
    const recentRanks = (data.matches || []).map(m => m.rank).filter(r => r != null && r > 0);
    const avgRecentRank = recentRanks.length ? Math.round(recentRanks.reduce((a, b) => a + b, 0) / recentRanks.length) : null;

    let rankCode = seasonRank;
    let rankSource = 'season';
    if (!rankCode && lbRank && lbRank > 0) {
      rankCode = 80;
      rankSource = 'leaderboard';
    }
    if (!rankCode && avgRecentRank) {
      rankCode = avgRecentRank;
      rankSource = `recent ${recentRanks.length} 场平均`;
    }
    const rank = decodeRank(rankCode);
    const realMmr = rank.mmr;
    const lbBonus = lbRank && lbRank > 0 ? `（榜 ${lbRank}）` : '';
    const reported = p.reported || 0;
    const diff = realMmr ? reported - realMmr : null;
    const flag = diff != null && Math.abs(diff) >= 1000 ? (diff > 0 ? 'low_reported' : 'high_reported') : 'ok';
    const r = {
      ...p,
      stratz_name: data.steamAccount?.name,
      season_rank_code: data.steamAccount?.seasonRank,
      lb_rank: lbRank,
      rank_source: rankSource,
      recent_match_count: recentRanks.length,
      rank_name: rank.name,
      real_mmr: realMmr,
      diff,
      flag,
      match_count: data.matchCount,
      win_count: data.winCount,
      behavior: data.behaviorScore,
      last_match: data.lastMatchDate,
    };
    results.push(r);
    const flagSym = flag === 'ok' ? '✓' : (flag === 'low_reported' ? '↑' : '↓');
    console.log(`${flagSym} #${String(p.n).padStart(2)} ${p.name.padEnd(20)}  报${reported}  实${rank.name.padEnd(8)}${lbBonus}(${realMmr || '?'})  差${diff ?? '?'}  ${data.steamAccount?.name || ''}`);
  } catch (e) {
    results.push({ ...p, status: 'error', note: e.message });
    console.log(`✗ #${p.n} ${p.name.padEnd(20)}  错误: ${e.message}`);
  }
  // 限速
  await new Promise(r => setTimeout(r, 250));
}

writeFileSync(join(__dirname, 'rank-check-output.json'), JSON.stringify(results, null, 2));
console.log(`\n✓ 数据保存: tools/rank-check-output.json`);
console.log(`下一步: node tools/render-rank-check.mjs`);
