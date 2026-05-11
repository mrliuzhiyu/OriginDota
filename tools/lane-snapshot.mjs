#!/usr/bin/env node
// lane-snapshot.mjs
// 从 OpenDota Parser 的 JSONL 提取对线期切片，专门服务"段位真实度"分析。
// 默认快照点: 5:00 / 10:00 (秒数 300 / 600)
//
// 用法:
//   node tools/lane-snapshot.mjs parsed/8806988261.jsonl
// 输出:
//   parsed/8806988261-lane.json (≈3-5KB)

import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroes = JSON.parse(readFileSync(join(__dirname, 'heroes.json'), 'utf-8'));
const heroesCn = JSON.parse(readFileSync(join(__dirname, 'heroes-cn.json'), 'utf-8'));
const players = JSON.parse(readFileSync(join(__dirname, 'players.json'), 'utf-8')).players;

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node lane-snapshot.mjs <path-to-jsonl>');
  process.exit(1);
}
const inputPath = argv[0];
const outputPath = inputPath.replace(/\.jsonl$/, '-lane.json');

function heroCn(id) { return heroesCn[String(id)] || heroes[String(id)]?.localized_name || `Hero${id}`; }
function fmtTime(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function decodeBytes(arr) {
  if (!Array.isArray(arr)) return '';
  return Buffer.from(arr.map(x => x < 0 ? x + 256 : x)).toString('utf-8');
}

const SNAPSHOTS = [300, 600];  // 5:00, 10:00
const LANE_END = 600;
const slotStats = {};       // slot -> { snapshots: { 300: {...}, 600: {...} }, last_seen: 0 }
const slotMeta = {};        // slot -> { hero_id, hero, name, team }
const slotName = {};        // slot -> player name (from epilogue)
const kills = [];           // 0-LANE_END 内的英雄击杀
const towerKills = [];      // 0-LANE_END 内的塔
const firstBlood = { claimed: false };
let epilogue = null;

console.log(`\n===== 对线期切片 (0 → ${LANE_END}s) =====`);
console.log(`输入: ${inputPath}`);

const stream = createReadStream(inputPath);
const rl = createInterface({ input: stream, crlfDelay: Infinity });
let lineN = 0;

for await (const line of rl) {
  lineN++;
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }

  if (e.type === 'interval' && e.time != null && e.slot != null) {
    const slot = e.slot;
    if (!slotStats[slot]) slotStats[slot] = { snapshots: {} };
    // 在每个 SNAPSHOTS 点收集"最接近且 >= 该时间"的第一个 interval
    for (const t of SNAPSHOTS) {
      if (e.time >= t && !slotStats[slot].snapshots[t]) {
        slotStats[slot].snapshots[t] = {
          time: e.time,
          gold: e.gold, lh: e.lh, denies: e.denies,
          xp: e.xp, level: e.level,
          kills: e.kills, deaths: e.deaths, assists: e.assists,
          networth: e.networth,
          obs_placed: e.obs_placed, sen_placed: e.sen_placed,
          creeps_stacked: e.creeps_stacked, camps_stacked: e.camps_stacked,
          rune_pickups: e.rune_pickups,
          stuns: e.stuns,
          teamfight_participation: e.teamfight_participation,
          firstblood_claimed: e.firstblood_claimed,
          towers_killed: e.towers_killed,
          x: e.x, y: e.y,
        };
        if (e.hero_id && !slotMeta[slot]) {
          slotMeta[slot] = {
            hero_id: e.hero_id,
            hero: heroCn(e.hero_id),
            team: slot < 5 ? 'radiant' : 'dire',
          };
        }
      }
    }
  }
  else if (e.type === 'CHAT_MESSAGE_HERO_KILL' && e.time != null && e.time >= 0 && e.time <= LANE_END) {
    // player1 = 受害者, player2 = 击杀者（aggregate.mjs 已纠正过）
    kills.push({
      time: e.time,
      time_min: fmtTime(e.time),
      victim_slot: e.player1,
      killer_slot: e.player2,
    });
  }
  else if (e.type === 'CHAT_MESSAGE_FIRSTBLOOD' && e.time != null) {
    firstBlood.time = e.time;
    firstBlood.time_min = fmtTime(e.time);
    firstBlood.killer_slot = e.player1;
  }
  else if (e.type === 'CHAT_MESSAGE_TOWER_KILL' && e.time != null && e.time >= 0 && e.time <= LANE_END) {
    towerKills.push({ time: e.time, time_min: fmtTime(e.time), team: e.team });
  }
  else if (e.type === 'epilogue') {
    try { epilogue = JSON.parse(e.key); } catch {}
  }
}
console.log(`✓ 读取 ${lineN} 行`);

// 从 epilogue 提取玩家名 + 真实英雄（aggregate.mjs 同款解码）
if (epilogue?.gameInfo_?.dota_?.playerInfo_) {
  epilogue.gameInfo_.dota_.playerInfo_.forEach((p, i) => {
    slotName[i] = decodeBytes(p.playerName_?.bytes) || `Slot${i}`;
    if (!slotMeta[i] || !slotMeta[i].hero) {
      slotMeta[i] = {
        hero: slotMeta[i]?.hero || decodeBytes(p.heroName_?.bytes).replace(/^npc_dota_hero_/, ''),
        team: i < 5 ? 'radiant' : 'dire',
      };
    }
  });
}

// 匹配 players.json 的报名分数（用 steam_id 或 fuzzy name）
function matchReported(slot) {
  const name = slotName[slot] || '';
  // 模糊匹配玩家名
  for (const p of players) {
    if (!p.name) continue;
    // 把玩家自报名当 needle，看是不是出现在 in-game name 中
    const nick = p.name.replace(/[（(].*$/, '').trim().toLowerCase();
    if (nick && name.toLowerCase().includes(nick)) return p;
    if (p.name === name) return p;
  }
  // 反向：用 Steam ID
  return null;
}

// 组装最终输出
const out = {
  source: inputPath,
  generated_at: new Date().toISOString(),
  match_id: epilogue?.matchId_ || epilogue?.matchId,
  duration: epilogue?.endTime_ ? null : null,
  winner: null, // 不用知道，对线期分析不需要
  lane_end_s: LANE_END,
  first_blood: firstBlood.time != null ? {
    ...firstBlood,
    killer_name: slotName[firstBlood.killer_slot],
    killer_hero: slotMeta[firstBlood.killer_slot]?.hero,
  } : null,
  players: [],
  kills_in_lane: kills.map(k => ({
    ...k,
    killer: slotName[k.killer_slot],
    killer_hero: slotMeta[k.killer_slot]?.hero,
    victim: slotName[k.victim_slot],
    victim_hero: slotMeta[k.victim_slot]?.hero,
  })),
  tower_kills_in_lane: towerKills,
};

for (let slot = 0; slot < 10; slot++) {
  const meta = slotMeta[slot] || {};
  const name = slotName[slot];
  const matched = matchReported(slot);
  const stats = slotStats[slot]?.snapshots || {};
  const s5 = stats[300];
  const s10 = stats[600];

  out.players.push({
    slot,
    team: meta.team,
    hero: meta.hero,
    name,
    reported_mmr: matched?.reported ?? null,
    reported_n: matched?.n ?? null,
    matched_name: matched?.name ?? null,
    at_5min: s5 ? {
      lh: s5.lh, denies: s5.denies,
      k: s5.kills, d: s5.deaths, a: s5.assists,
      level: s5.level,
      networth: s5.networth,
      xp: s5.xp,
      stuns: Math.round(s5.stuns || 0),
      rune_pickups: s5.rune_pickups,
      creeps_stacked: s5.creeps_stacked,
    } : null,
    at_10min: s10 ? {
      lh: s10.lh, denies: s10.denies,
      k: s10.kills, d: s10.deaths, a: s10.assists,
      level: s10.level,
      networth: s10.networth,
      gpm: Math.round((s10.networth / 600) * 60),
      xp: s10.xp,
      xpm: Math.round((s10.xp / 600) * 60),
      stuns: Math.round(s10.stuns || 0),
      obs_placed: s10.obs_placed,
      sen_placed: s10.sen_placed,
      creeps_stacked: s10.creeps_stacked,
      camps_stacked: s10.camps_stacked,
      rune_pickups: s10.rune_pickups,
      teamfight_participation: s10.teamfight_participation,
      firstblood_claimed: s10.firstblood_claimed,
      towers_killed: s10.towers_killed,
    } : null,
  });
}

writeFileSync(outputPath, JSON.stringify(out, null, 2));
const size = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1);
console.log(`\n===== 切片输出 =====`);
console.log(`文件: ${outputPath} (${size} KB)`);
console.log(`首杀: ${out.first_blood ? `${out.first_blood.time_min} ${out.first_blood.killer_hero}` : '?'}`);
console.log(`对线期击杀: ${kills.length} 次｜推塔: ${towerKills.length} 座`);
console.log(`\n10:00 各人快照:`);
for (const p of out.players) {
  if (!p.at_10min) { console.log(`  slot${p.slot} ${p.name} - 无快照`); continue; }
  const s = p.at_10min;
  const team = p.team === 'radiant' ? '🟢' : '🔴';
  const rep = p.reported_mmr != null ? String(p.reported_mmr).padStart(5) : ' 未填';
  console.log(`  ${team} slot${p.slot} ${(p.name||'').padEnd(18)} ${(p.hero||'').padEnd(8)} 报${rep}  ${s.k}/${s.d}/${s.a}  lh${String(s.lh).padStart(3)}/${String(s.denies).padStart(2)}  净${String(s.networth).padStart(5)}  GPM${String(s.gpm).padStart(3)} XPM${String(s.xpm).padStart(3)}  L${s.level}`);
}
