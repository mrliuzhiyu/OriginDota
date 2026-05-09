#!/usr/bin/env node
// aggregate.mjs
// 把 OpenDota Parser 输出的 raw JSONL 聚合成 AI 友好的 match-summary.json
//
// 用法:
//   node tools/aggregate.mjs parsed/内战201.jsonl
//
// 输出:
//   parsed/内战201-summary.json (KB 级，可直接喂给 Claude API)

import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node aggregate.mjs <path-to-jsonl>');
  process.exit(1);
}

const inputPath = argv[0];
const outputPath = inputPath.replace(/\.jsonl$/, '-summary.json');

console.log(`\n===== 聚合 OpenDota Parser 输出 =====`);
console.log(`输入: ${inputPath}`);
console.log(`输出: ${outputPath}\n`);

// ===== 数据收集器 =====
const players = {}; // slot -> player data
const epilogue = { raw: null };
let matchInfo = null;
const purchases = []; // {time, slot, item}
const kills = []; // {time, killer, victim}
const ability_uses = {};
const chat = [];
const obs = []; // observer wards
const sen = []; // sentry wards
const objectives = []; // tower/barracks/roshan
const teamfights = [];
let lastInterval = {}; // slot -> latest interval snapshot

function getPlayer(slot) {
  if (!players[slot]) {
    players[slot] = {
      slot,
      hero_id: null,
      account_id: null,
      personaname: null,
      kills: 0,
      deaths: 0,
      assists: 0,
      gold: 0,
      gold_per_min: 0,
      xp_per_min: 0,
      level: 1,
      net_worth: 0,
      last_hits: 0,
      denies: 0,
      hero_damage: 0,
      tower_damage: 0,
      hero_healing: 0,
      items: [],
      backpack: [],
      neutral_item: null,
      first_purchase: {}, // item -> time
      ability_uses: {},
      runes: [],
      buybacks: 0,
    };
  }
  return players[slot];
}

let lineCount = 0;
let processedCount = 0;
const eventTypes = {};

const rl = createInterface({
  input: createReadStream(inputPath, { encoding: 'utf-8' }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  lineCount++;
  if (!line.trim()) continue;

  let evt;
  try {
    evt = JSON.parse(line);
  } catch (e) {
    continue; // 忽略损坏行
  }

  processedCount++;
  const type = evt.type;
  eventTypes[type] = (eventTypes[type] || 0) + 1;

  // ===== 比赛元数据 =====
  if (type === 'epilogue' || type === 'match_id' || type === 'DOTA_COMBATLOG_GAME_STATE') {
    if (evt.key) matchInfo = { ...matchInfo, ...evt };
  }
  if (type === 'epilogue') {
    epilogue.raw = evt;
  }

  // ===== 周期性快照（每秒一次玩家状态）=====
  if (type === 'interval' && evt.slot !== undefined) {
    const p = getPlayer(evt.slot);
    lastInterval[evt.slot] = evt;
    // 实时更新最新值
    if (evt.gold !== undefined) p.gold = evt.gold;
    if (evt.lh !== undefined) p.last_hits = evt.lh;
    if (evt.denies !== undefined) p.denies = evt.denies;
    if (evt.level !== undefined) p.level = evt.level;
    if (evt.kills !== undefined) p.kills = evt.kills;
    if (evt.deaths !== undefined) p.deaths = evt.deaths;
    if (evt.assists !== undefined) p.assists = evt.assists;
    if (evt.hero_id !== undefined) p.hero_id = evt.hero_id;
    if (evt.x !== undefined && evt.y !== undefined) {
      // 位置可以用来做热力图（先不存，太多）
    }
  }

  // ===== 购买物品 =====
  if (type === 'DOTA_COMBATLOG_PURCHASE' || type === 'purchase') {
    purchases.push({
      time: evt.time,
      slot: evt.slot,
      item: evt.key || evt.itemname,
    });
    const p = getPlayer(evt.slot);
    const itemName = evt.key || evt.itemname;
    if (itemName && !p.first_purchase[itemName]) {
      p.first_purchase[itemName] = evt.time;
    }
  }

  // ===== 击杀 =====
  if (type === 'kills_log' || type === 'DOTA_COMBATLOG_DEATH') {
    kills.push({
      time: evt.time,
      slot: evt.slot,
      victim: evt.key || evt.targetname,
    });
  }

  // ===== 玩家信息 (player slot, name, hero_id) =====
  if (type === 'player_slot' || type === 'name' || type === 'hero_id') {
    if (evt.slot !== undefined) {
      const p = getPlayer(evt.slot);
      if (type === 'name' && evt.key) p.personaname = evt.key;
      if (type === 'hero_id' && evt.value !== undefined) p.hero_id = evt.value;
    }
  }

  // ===== 视野 =====
  if (type === 'obs') obs.push({ time: evt.time, slot: evt.slot, x: evt.x, y: evt.y });
  if (type === 'sen') sen.push({ time: evt.time, slot: evt.slot, x: evt.x, y: evt.y });

  // ===== 聊天 =====
  if (type === 'chat' || type === 'CHAT_MESSAGE') {
    chat.push({
      time: evt.time,
      slot: evt.slot,
      msg: evt.key || evt.value,
    });
  }

  // ===== 建筑摧毁 / Roshan / Aegis =====
  if (type === 'building_kill' || type === 'CHAT_MESSAGE_TOWER_KILL'
      || type === 'CHAT_MESSAGE_ROSHAN_KILL' || type === 'CHAT_MESSAGE_AEGIS') {
    objectives.push({
      time: evt.time,
      type: type,
      slot: evt.slot,
      key: evt.key,
    });
  }

  // ===== 团战 =====
  if (type === 'teamfights' || type === 'teamfight') {
    teamfights.push(evt);
  }

  // ===== Buyback =====
  if (type === 'buyback' || type === 'CHAT_MESSAGE_BUYBACK') {
    const p = getPlayer(evt.slot);
    p.buybacks++;
  }

  // ===== Rune =====
  if (type === 'runes_log' || type === 'rune') {
    const p = getPlayer(evt.slot);
    p.runes.push({ time: evt.time, key: evt.key });
  }
}

console.log(`✓ 读取完成: ${lineCount} 行, ${processedCount} 个有效事件`);
console.log(`\n事件类型统计 (Top 20):`);
const sortedTypes = Object.entries(eventTypes).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [t, c] of sortedTypes) {
  console.log(`  ${t.padEnd(40)} ${c}`);
}

// ===== 派生计算 =====
const matchDuration = epilogue.raw?.key?.gameInfo_?.dota_?.endTime
  || (Math.max(...Object.values(lastInterval).map(i => i?.time || 0)) || 0);

// 估算 GPM/XPM
for (const slot in players) {
  const p = players[slot];
  const li = lastInterval[slot];
  if (li && li.time > 0) {
    const minutes = li.time / 60;
    p.gold_per_min = Math.round((li.gold || 0) / minutes);
    p.xp_per_min = Math.round((li.xp || 0) / minutes);
    p.net_worth = li.gold || 0;
  }
}

// 物品时间线 (每人前 10 个购买)
for (const slot in players) {
  const p = players[slot];
  const myPurchases = purchases
    .filter(x => x.slot == slot)
    .sort((a, b) => a.time - b.time);
  p.items_timeline = myPurchases.slice(0, 25).map(x => ({
    time: x.time,
    time_min: `${Math.floor(x.time / 60)}:${String(x.time % 60).padStart(2, '0')}`,
    item: x.item,
  }));
}

// ===== 关键时刻提取 =====
const keyMoments = [];

// 第一滴血
if (kills.length > 0) {
  const fb = kills[0];
  keyMoments.push({
    time: fb.time,
    time_min: fmtTime(fb.time),
    type: 'first_blood',
    killer_slot: fb.slot,
    victim_hero: fb.victim,
  });
}

// 集中击杀（团战）：5 秒内 ≥3 人死亡
const sortedKills = [...kills].sort((a, b) => a.time - b.time);
let i = 0;
while (i < sortedKills.length) {
  const cluster = [sortedKills[i]];
  let j = i + 1;
  while (j < sortedKills.length && sortedKills[j].time - cluster[0].time <= 30) {
    cluster.push(sortedKills[j]);
    j++;
  }
  if (cluster.length >= 3) {
    keyMoments.push({
      time: cluster[0].time,
      time_min: fmtTime(cluster[0].time),
      type: 'teamfight_burst',
      deaths: cluster.length,
      duration_s: cluster[cluster.length - 1].time - cluster[0].time,
    });
    i = j;
  } else {
    i++;
  }
}

// Roshan 击杀
for (const obj of objectives) {
  if (obj.type === 'CHAT_MESSAGE_ROSHAN_KILL' || (obj.key && obj.key.toString().toLowerCase().includes('roshan'))) {
    keyMoments.push({
      time: obj.time,
      time_min: fmtTime(obj.time),
      type: 'roshan_kill',
      killer_slot: obj.slot,
    });
  }
}

keyMoments.sort((a, b) => a.time - b.time);

function fmtTime(s) {
  if (s < 0) return `-${fmtTime(-s)}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ===== 输出 =====
const summary = {
  source: inputPath,
  generated_at: new Date().toISOString(),
  parser: 'odota/parser:latest',
  match: {
    duration_s: matchDuration,
    duration: fmtTime(matchDuration),
    total_kills: kills.length,
    total_purchases: purchases.length,
    total_chat_messages: chat.length,
    raw_event_count: processedCount,
  },
  players: Object.values(players).sort((a, b) => a.slot - b.slot),
  key_moments: keyMoments,
  chat_log: chat
    .filter(c => c.msg && c.msg.length > 0)
    .map(c => ({ time: c.time, time_min: fmtTime(c.time), slot: c.slot, msg: c.msg })),
  objectives_count: objectives.length,
  objectives_sample: objectives.slice(0, 30).map(o => ({
    time: o.time,
    time_min: fmtTime(o.time),
    type: o.type,
    slot: o.slot,
    key: o.key,
  })),
  ward_stats: {
    obs_total: obs.length,
    sen_total: sen.length,
    obs_per_player: countBy(obs, 'slot'),
    sen_per_player: countBy(sen, 'slot'),
  },
  event_type_counts: eventTypes,
};

function countBy(arr, key) {
  const result = {};
  for (const item of arr) {
    const k = item[key];
    if (k !== undefined) result[k] = (result[k] || 0) + 1;
  }
  return result;
}

writeFileSync(outputPath, JSON.stringify(summary, null, 2));

const summarySize = Buffer.byteLength(JSON.stringify(summary)) / 1024;
console.log(`\n✓ 摘要已保存: ${outputPath}`);
console.log(`  大小: ${summarySize.toFixed(1)} KB`);
console.log(`  玩家: ${Object.keys(players).length} 人`);
console.log(`  关键时刻: ${keyMoments.length} 个`);
console.log(`  聊天消息: ${chat.length} 条`);
console.log(`  Roshan/塔击杀: ${objectives.length} 个`);
console.log(`\n下一步: 把 ${outputPath} 发给 Claude，让我做 AI 战报分析\n`);
