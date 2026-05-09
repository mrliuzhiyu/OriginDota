#!/usr/bin/env node
// aggregate.mjs (v2)
// 把 OpenDota Parser 的 raw JSONL 聚合成 AI 友好的 match-summary.json
//
// 修复点 vs v1:
//   - 用 CHAT_MESSAGE_HERO_KILL 而非 DOTA_COMBATLOG_DEATH（避免把 creep 死亡算成击杀）
//   - 解析 epilogue 拿真实的 matchId / 胜方 / 玩家名 / 英雄名 / 真实时长
//   - 加 hero_id → 本地化名映射 (heroes.json)
//   - 加 item_id → 显示名映射 (items.json)
//   - 团战检测改用真实 hero kills（15s 窗口，≥3 死）
//   - 识别 Radiant / Dire（slot 0-4 = Radiant, 5-9 = Dire）

import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== 加载映射表 =====
const heroes = JSON.parse(readFileSync(join(__dirname, 'heroes.json'), 'utf-8'));
const heroesCn = JSON.parse(readFileSync(join(__dirname, 'heroes-cn.json'), 'utf-8'));
const items = JSON.parse(readFileSync(join(__dirname, 'items.json'), 'utf-8'));

function heroCnName(id) {
  return heroesCn[String(id)] || null;
}
function heroById(id) {
  const h = heroes[String(id)];
  if (!h) return { id, name: '', localized_name: `Hero${id}`, cn: `英雄${id}` };
  return { ...h, cn: heroCnName(id) || h.localized_name };
}
function heroByNpcName(npc) {
  for (const id in heroes) {
    if (heroes[id].name === npc) {
      return { ...heroes[id], cn: heroCnName(id) || heroes[id].localized_name };
    }
  }
  return { name: npc, localized_name: npc.replace(/^npc_dota_hero_/, ''), cn: npc.replace(/^npc_dota_hero_/, '') };
}
function itemDisplayName(itemKey) {
  if (!itemKey) return '';
  const key = itemKey.replace(/^item_/, '');
  return items[key]?.dname || key;
}

// 把 epilogue 里的 byte 数组（int8 数组，负数代表 UTF-8 高位）解码为字符串
function decodeBytes(arr) {
  if (!Array.isArray(arr)) return '';
  const buf = Buffer.from(arr.map(x => (x < 0 ? x + 256 : x)));
  return buf.toString('utf-8');
}

function fmtTime(s) {
  if (s == null) return '?';
  if (s < 0) return `-${fmtTime(-s)}`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ===== 输入参数 =====
const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node aggregate.mjs <path-to-jsonl>');
  process.exit(1);
}
const inputPath = argv[0];
const outputPath = inputPath.replace(/\.jsonl$/, '-summary.json');

console.log(`\n===== 聚合 OpenDota Parser 输出 (v2) =====`);
console.log(`输入: ${inputPath}`);
console.log(`输出: ${outputPath}\n`);

// ===== 数据收集器 =====
const slotToTeam = {};       // slot 0-9 -> 'radiant' | 'dire'
const heroKills = [];        // {time, killer_slot, victim_slot}
const purchases = {};        // slot -> [{time, item, dname}]
const startingItems = {};    // slot -> [item names]
const lastInterval = {};     // slot -> latest interval event
const towerKills = [];       // {time, slot}
const roshanKills = [];      // {time}
const aegisEvents = [];      // {time, slot}
const buybacks = {};         // slot -> [time]
const obs = [], sen = [];    // wards
const obsLeft = [], senLeft = []; // ward kills
const chats = [];
const draftActions = [];     // {time, type, hero}
const multikills = [];       // {time, slot, count}
const streakKills = [];      // {time, slot, streak}
const buildingKills = [];    // {time, type}
const disconnects = [];
const courierLost = [];
const scanUsed = [];
const glyphs = [];
const runesPickup = [];
const buildingTeamKills = []; // DOTA_COMBATLOG_TEAM_BUILDING_KILL
let firstBlood = null;
let epilogueData = null;
let firstHeroKillTime = null;
let lastEventTime = 0;

const eventTypes = {};
let lineCount = 0;

const rl = createInterface({
  input: createReadStream(inputPath, { encoding: 'utf-8' }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  lineCount++;
  if (!line.trim()) continue;
  let evt;
  try { evt = JSON.parse(line); } catch { continue; }

  const type = evt.type;
  eventTypes[type] = (eventTypes[type] || 0) + 1;
  if (typeof evt.time === 'number' && evt.time > lastEventTime) lastEventTime = evt.time;

  // 玩家阵营映射
  if (type === 'player_slot') {
    const slot = parseInt(evt.key);
    slotToTeam[slot] = evt.value < 128 ? 'radiant' : 'dire';
  }

  // 英雄击杀（HERO_KILL 事件: player1 = 受害者, player2 = 凶手）
  if (type === 'CHAT_MESSAGE_HERO_KILL') {
    heroKills.push({
      time: evt.time,
      victim_slot: evt.player1,
      killer_slot: evt.player2,
    });
    if (firstHeroKillTime === null) firstHeroKillTime = evt.time;
  }

  // 第一滴血
  if (type === 'CHAT_MESSAGE_FIRSTBLOOD') {
    firstBlood = { time: evt.time, killer_slot: evt.player1, victim_slot: evt.player2 };
  }

  // 购买（用 slot 字段，valuename 是 item_xxx）
  if (type === 'DOTA_COMBATLOG_PURCHASE' && evt.slot !== undefined && evt.valuename) {
    if (!purchases[evt.slot]) purchases[evt.slot] = [];
    purchases[evt.slot].push({
      time: evt.time,
      item: evt.valuename,
      dname: itemDisplayName(evt.valuename),
    });
  }

  // 起始装备
  if (type === 'STARTING_ITEM' && evt.slot !== undefined && evt.valuename) {
    if (!startingItems[evt.slot]) startingItems[evt.slot] = [];
    startingItems[evt.slot].push({
      item: evt.valuename,
      dname: itemDisplayName(evt.valuename),
    });
  }

  // 周期快照（只记 slot 0-9 的玩家）
  if (type === 'interval' && evt.slot !== undefined && evt.slot >= 0 && evt.slot <= 9) {
    lastInterval[evt.slot] = evt;
  }

  // 塔击杀
  if (type === 'CHAT_MESSAGE_TOWER_KILL') {
    towerKills.push({ time: evt.time, slot: evt.player1, value: evt.value });
  }

  // Roshan (player1 = killer slot, team 推)
  if (type === 'CHAT_MESSAGE_ROSHAN_KILL') {
    const killer = evt.player1;
    const team = killer !== undefined && killer >= 0 && killer <= 4 ? 'radiant'
              : killer !== undefined && killer >= 5 && killer <= 9 ? 'dire' : 'unknown';
    roshanKills.push({ time: evt.time, killer_slot: killer, team });
  }
  if (type === 'CHAT_MESSAGE_AEGIS') {
    aegisEvents.push({ time: evt.time, slot: evt.player1 });
  }

  // 买活 (player1 是 slot)
  if (type === 'CHAT_MESSAGE_BUYBACK') {
    const slot = evt.player1;
    if (slot !== undefined && slot >= 0 && slot <= 9) {
      if (!buybacks[slot]) buybacks[slot] = [];
      buybacks[slot].push(evt.time);
    }
  }

  // 视野
  if (type === 'obs') obs.push({ time: evt.time, slot: evt.slot });
  if (type === 'sen') sen.push({ time: evt.time, slot: evt.slot });
  if (type === 'obs_left') obsLeft.push({ time: evt.time });
  if (type === 'sen_left') senLeft.push({ time: evt.time });

  // 多杀 (attackername 是 hero_npc 名，需要查 slot)
  if (type === 'DOTA_COMBATLOG_MULTIKILL') {
    multikills.push({ time: evt.time, hero_npc: evt.attackername, count: evt.value });
  }
  if (type === 'CHAT_MESSAGE_STREAK_KILL') {
    streakKills.push({ time: evt.time, slot: evt.player1, streak: evt.value });
  }

  // 建筑
  if (type === 'DOTA_COMBATLOG_TEAM_BUILDING_KILL') {
    buildingTeamKills.push({ time: evt.time, value: evt.value });
  }

  // 掉线 (player1 是 slot)
  if (type === 'CHAT_MESSAGE_DISCONNECT') {
    disconnects.push({ time: evt.time, slot: evt.player1 });
  }

  // 信使阵亡
  if (type === 'CHAT_MESSAGE_COURIER_LOST') {
    courierLost.push({ time: evt.time });
  }

  // 扫描
  if (type === 'CHAT_MESSAGE_SCAN_USED') {
    scanUsed.push({ time: evt.time, team: evt.value });
  }

  // 真假眼
  if (type === 'CHAT_MESSAGE_GLYPH_USED') {
    glyphs.push({ time: evt.time, team: evt.value });
  }

  // 神符
  if (type === 'CHAT_MESSAGE_RUNE_PICKUP') {
    runesPickup.push({ time: evt.time, slot: evt.value, rune: evt.value });
  }

  // BP
  if (type === 'draft_timings' || type === 'draft_start') {
    draftActions.push(evt);
  }

  // Epilogue 终极元数据
  if (type === 'epilogue') {
    try {
      const data = JSON.parse(evt.key);
      const dota = data?.gameInfo_?.dota_;
      if (dota) {
        epilogueData = {
          matchId: dota.matchId_,
          gameMode: dota.gameMode_,
          winnerTeam: dota.gameWinner_, // 2=Radiant, 3=Dire
          replayDuration: data.playbackTime_,
          endTime: dota.endTime_,
          players: (dota.playerInfo_ || []).map(p => ({
            heroNpcName: decodeBytes(p.heroName_?.bytes),
            playerName: decodeBytes(p.playerName_?.bytes),
            steamId: String(p.steamid_ || ''),
            gameTeam: p.gameTeam_,
          })),
        };
      }
    } catch (e) {
      console.error('解析 epilogue 失败:', e.message);
    }
  }
}

console.log(`✓ 读取 ${lineCount} 行`);
console.log(`✓ 找到 ${heroKills.length} 次英雄击杀`);
console.log(`✓ 解析 epilogue:`, epilogueData ? 'OK' : '失败');

// ===== 派生计算 =====

// 真实游戏时长 = 最后一次 hero kill 的时间 + 60s（粗略）
const gameDurationS = heroKills.length > 0
  ? heroKills[heroKills.length - 1].time + 60
  : lastEventTime;

// 玩家聚合
const players = [];
for (let slot = 0; slot < 10; slot++) {
  const li = lastInterval[slot] || {};
  const team = slotToTeam[slot] || (slot < 5 ? 'radiant' : 'dire');
  const epPlayer = epilogueData?.players?.[slot] || {};

  // 用英雄 NPC 名字反查 hero_id
  let hero = null;
  if (epPlayer.heroNpcName) {
    hero = heroByNpcName(epPlayer.heroNpcName);
  } else if (li.hero_id) {
    hero = heroById(li.hero_id);
  }

  // 击杀 / 死亡 / 助攻：优先用 interval 末值（游戏官方统计）
  const myKills = li.kills !== undefined ? li.kills : heroKills.filter(k => k.killer_slot === slot).length;
  const myDeaths = li.deaths !== undefined ? li.deaths : heroKills.filter(k => k.victim_slot === slot).length;
  const myAssists = li.assists || 0;

  // 物品时间线
  const myPurchases = (purchases[slot] || []).sort((a, b) => a.time - b.time);
  const itemsTimeline = myPurchases.map(p => ({
    time: p.time,
    time_min: fmtTime(p.time),
    item: p.dname || p.item,
  }));

  // 起始装
  const myStart = (startingItems[slot] || []).map(s => s.dname);

  // 最后阶段的物品（最后 6 个购买）
  const finalItems = [...myPurchases]
    .reverse()
    .map(p => p.dname || p.item)
    .filter((v, i, a) => a.indexOf(v) === i)  // 去重
    .slice(0, 6);

  players.push({
    slot,
    team,
    hero_id: hero?.id || li.hero_id || null,
    hero: hero?.cn || hero?.localized_name || '?',
    hero_en: hero?.localized_name || '?',
    hero_npc: hero?.name || '',
    name: epPlayer.playerName || '?',
    steam_id: epPlayer.steamId || '',
    kills: myKills,
    deaths: myDeaths,
    assists: myAssists,
    kda: `${myKills}/${myDeaths}/${myAssists}`,
    level: li.level || 0,
    networth: li.gold || 0,
    last_hits: li.lh || 0,
    denies: li.denies || 0,
    gold_per_min: li.time > 0 ? Math.round((li.gold || 0) / (li.time / 60)) : 0,
    xp_per_min: li.time > 0 ? Math.round((li.xp || 0) / (li.time / 60)) : 0,
    starting_items: myStart,
    final_items: finalItems,
    items_count: myPurchases.length,
    buybacks: (buybacks[slot] || []).length,
    obs_placed: obs.filter(o => o.slot === slot).length,
    sen_placed: sen.filter(s => s.slot === slot).length,
  });
}

// 团战检测（15s 窗口内 ≥3 次 hero kills）
function detectTeamfights(kills) {
  const sorted = [...kills].sort((a, b) => a.time - b.time);
  const tfs = [];
  let i = 0;
  while (i < sorted.length) {
    const cluster = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].time - cluster[cluster.length - 1].time <= 15) {
      cluster.push(sorted[j]);
      j++;
    }
    if (cluster.length >= 3) {
      const radKills = cluster.filter(k => slotToTeam[k.killer_slot] === 'radiant').length;
      const direKills = cluster.length - radKills;
      tfs.push({
        start: cluster[0].time,
        end: cluster[cluster.length - 1].time,
        start_min: fmtTime(cluster[0].time),
        duration_s: cluster[cluster.length - 1].time - cluster[0].time,
        kills: cluster.length,
        radiant_kills: radKills,
        dire_kills: direKills,
        winner: radKills > direKills ? 'radiant' : (direKills > radKills ? 'dire' : 'tied'),
      });
    }
    i = j;
  }
  return tfs;
}

const teamfights = detectTeamfights(heroKills);

// 阵营总分
const radiantKills = players.filter(p => p.team === 'radiant').reduce((s, p) => s + p.kills, 0);
const direKills = players.filter(p => p.team === 'dire').reduce((s, p) => s + p.kills, 0);

// 胜方
let winner = 'unknown';
if (epilogueData?.winnerTeam === 2) winner = 'radiant';
else if (epilogueData?.winnerTeam === 3) winner = 'dire';

// ===== 输出 =====
const summary = {
  source: inputPath,
  generated_at: new Date().toISOString(),
  parser: 'odota/parser:latest',
  match: {
    match_id: epilogueData?.matchId || '',
    game_mode: epilogueData?.gameMode || 0,
    winner: winner,
    duration_s: gameDurationS,
    duration: fmtTime(gameDurationS),
    radiant_score: radiantKills,
    dire_score: direKills,
    total_hero_kills: heroKills.length,
    end_time_unix: epilogueData?.endTime || 0,
  },
  players,
  first_blood: firstBlood ? {
    time: firstBlood.time,
    time_min: fmtTime(firstBlood.time),
    killer: players[firstBlood.killer_slot]?.hero || '?',
    killer_name: players[firstBlood.killer_slot]?.name || '?',
    victim: players[firstBlood.victim_slot]?.hero || '?',
    victim_name: players[firstBlood.victim_slot]?.name || '?',
  } : null,
  teamfights: teamfights.map(tf => ({
    ...tf,
    note: `${tf.start_min} 团战 ${tf.duration_s}s · ${tf.kills} 死亡 (R${tf.radiant_kills}-${tf.dire_kills}D · ${tf.winner === 'radiant' ? '天辉占优' : tf.winner === 'dire' ? '夜魇占优' : '互换'})`,
  })),
  multikills: multikills.map(m => {
    const p = players.find(x => x.hero_npc === m.hero_npc);
    return {
      time_min: fmtTime(m.time),
      player: p?.name || m.hero_npc,
      hero: p?.hero || m.hero_npc,
      team: p?.team || '?',
      count: m.count,
      label: ['', '', '双杀', '三杀', '四杀', '五杀'][m.count] || `${m.count}杀`,
    };
  }),
  streak_kills: streakKills.map(s => ({
    time_min: fmtTime(s.time),
    player: players[s.slot]?.name || `slot${s.slot}`,
    hero: players[s.slot]?.hero || '?',
    streak_value: s.streak,
  })),
  objectives: {
    tower_kills: towerKills.map(t => ({
      time_min: fmtTime(t.time),
      destroyer: players[t.slot]?.hero || '?',
    })),
    roshan_kills: roshanKills.map(r => ({
      time_min: fmtTime(r.time),
      team: r.team === 2 ? 'radiant' : (r.team === 3 ? 'dire' : '?'),
    })),
    aegis_pickups: aegisEvents.map(a => ({
      time_min: fmtTime(a.time),
      player: players[a.slot]?.hero || '?',
    })),
    building_kills_count: buildingTeamKills.length,
  },
  vision: {
    obs_total: obs.length,
    sen_total: sen.length,
    obs_killed: obsLeft.length,
    sen_killed: senLeft.length,
  },
  events: {
    glyphs: glyphs.length,
    scans: scanUsed.length,
    courier_lost: courierLost.length,
    disconnects: disconnects
      .filter(d => d.time < gameDurationS - 30)  // 过滤掉游戏结束后退房
      .map(d => ({
        time_min: fmtTime(d.time),
        player: players[d.slot]?.name || `slot${d.slot}`,
        hero: players[d.slot]?.hero || '?',
      })),
    disconnects_after_game: disconnects.filter(d => d.time >= gameDurationS - 30).length,
  },
  raw_event_counts: eventTypes,
};

writeFileSync(outputPath, JSON.stringify(summary, null, 2));

const sizeKB = Buffer.byteLength(JSON.stringify(summary)) / 1024;
console.log('\n===== 摘要 =====');
console.log(`输出文件: ${outputPath}`);
console.log(`大小: ${sizeKB.toFixed(1)} KB`);
console.log(`比赛 ID: ${summary.match.match_id}`);
console.log(`时长: ${summary.match.duration}`);
console.log(`胜方: ${summary.match.winner === 'radiant' ? '天辉' : summary.match.winner === 'dire' ? '夜魇' : '?'}`);
console.log(`比分: 天辉 ${summary.match.radiant_score} - ${summary.match.dire_score} 夜魇`);
console.log(`英雄击杀: ${summary.match.total_hero_kills}`);
console.log(`团战: ${summary.teamfights.length}`);
console.log(`多杀: ${summary.multikills.length}`);
console.log(`Roshan: ${summary.objectives.roshan_kills.length} 次`);
console.log(`掉线: ${summary.events.disconnects.length} 次`);
console.log('\n玩家:');
for (const p of summary.players) {
  const teamLabel = p.team === 'radiant' ? '🟢' : '🔴';
  console.log(`  ${teamLabel} slot${p.slot} ${p.name.padEnd(15)} ${p.hero.padEnd(20)} ${p.kda.padEnd(10)} GPM ${String(p.gold_per_min).padStart(4)} XPM ${String(p.xp_per_min).padStart(4)}`);
}
