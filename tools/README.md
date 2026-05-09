# 录像分析工具链

把 Dota 2 `.dem` 录像 → AI 自动生成战报。

## 架构

```
.dem 录像 (50–200MB)
    ↓ docker: odota/parser (Java + Clarity)
raw events JSONL (~100MB)
    ↓ aggregate.mjs (Node.js)
match-summary.json (~50KB, AI 友好)
    ↓ Claude API（或直接发给 Claude Code）
战报 .md（自然语言分析）
    ↓ git push
公示网页新页面
```

## 一次性环境准备

```powershell
# 1. 拉解析器镜像（已完成）
docker pull odota/parser:latest

# 2. 启动解析器（已启动，端口 5600，开机自启）
docker run -d --name odota-parser -p 5600:5600 --restart unless-stopped odota/parser:latest

# 3. 验证
curl http://localhost:5600/   # 应返回 HTTP 200
```

如果重启后 docker 没跑：

```powershell
docker start odota-parser
```

## 每期内战的工作流

### 第 1 步：把录像放进 replays/

```
OriginDota/replays/内战1-第1局.dem
```

> 录像哪里来：Dota 2 客户端「观看」→「录像」→「下载」按钮（或者本地 `Steam\steamapps\common\dota 2 beta\game\dota\replays\`）

### 第 2 步：解析

```powershell
.\tools\parse-replay.ps1 -DemPath ".\replays\内战1-第1局.dem"
```

输出 `parsed\内战1-第1局.jsonl`（100MB+ 的事件流，本地用，不入 git）

### 第 3 步：聚合

```powershell
node tools\aggregate.mjs parsed\内战1-第1局.jsonl
```

输出 `parsed\内战1-第1局-summary.json`（~50KB 的 AI 友好摘要）

### 第 4 步：让 Claude 写战报

把 summary.json 内容贴给 Claude（或者 Claude Code 自己读），让它生成 markdown 战报。可以指定风格：

- 简版：本场关键时刻 + MVP + 黑锅，500 字
- 详版：每个玩家点评 + 团战逐个分析 + 改进建议，2000 字
- 趣味版：本场咸鱼奖、金身奖、沸腾奖、神操作集锦

### 第 5 步：发布

```powershell
git add analysis/内战1-第1局-战报.md
git commit -m "战报: 5.9 内战 1 第 1 局 AI 分析"
git push
```

加链接到主公示网页即可。

## 文件说明

| 文件 | 作用 |
|---|---|
| `parse-replay.ps1` | PowerShell 包装：调 Docker parser，POST .dem，存 JSONL |
| `aggregate.mjs` | Node.js 聚合：读 JSONL 流，输出结构化 summary |
| `README.md` | 本文件 |

## summary.json 输出结构

```json
{
  "match": { "duration": "42:30", "total_kills": 47, ... },
  "players": [
    { "slot": 0, "hero_id": 1, "personaname": "Joy",
      "kills": 12, "deaths": 3, "assists": 8,
      "gold_per_min": 720, "xp_per_min": 690,
      "items_timeline": [{ "time_min": "8:00", "item": "soul_ring" }, ...] },
    ...
  ],
  "key_moments": [
    { "time_min": "1:23", "type": "first_blood" },
    { "time_min": "12:45", "type": "teamfight_burst", "deaths": 4 },
    { "time_min": "18:30", "type": "roshan_kill" },
    ...
  ],
  "chat_log": [...],
  "ward_stats": { ... },
  "event_type_counts": { ... }
}
```

## 故障排查

**Parser 连不上**：
```powershell
docker ps           # 看 odota-parser 是否 Up
docker logs odota-parser
docker restart odota-parser
```

**.dem 文件 POST 失败 / 超时**：
- 检查 .dem 是否完整（应 > 1MB，太小可能损坏）
- 提高 `parse-replay.ps1` 里的 `--max-time` 参数
- 看 docker logs 有没有 Java 异常

**aggregate.mjs 报错**：
- 确认 Node.js >= 18（用 `node -v` 检查）
- 确认 .jsonl 文件不为空
