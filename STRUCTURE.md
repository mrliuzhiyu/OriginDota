# 仓库结构 · 新一期 checklist

写给未来的我（Claude）和未来的我（Joy）：进仓库先读这个文件，别再 ls 一遍。
规则约定见 [CLAUDE.md](CLAUDE.md)；本文件只讲**文件放哪、叫什么、谁产出、入不入 git**。

---

## 目录树（按"产物链路"排序）

```
OriginDota/
├── index.html                                ← 入口：meta refresh 跳最新一期对战表
├── YYYYMMDD-内战对战表.html                    ← 每期对战表（公示页面，群里发的就是它）
├── CLAUDE.md                                 ← 规则约定（中文优先、手机自适应、报名顺序…）
├── STRUCTURE.md                              ← 本文件
│
├── tools/                                    ← 录像解析工具链（一次性配置好就不动）
│   ├── README.md                             ← 工作流详解
│   ├── parse-replay.ps1                      ← .dem → .jsonl（调 docker odota/parser）
│   ├── aggregate.mjs                         ← .jsonl → summary.json
│   ├── heroes.json / heroes-cn.json          ← 英雄 ID ↔ 中英文名
│   └── items.json                            ← 装备 ID ↔ 名称
│
├── replays/YYYYMMDD/                         ← .dem 录像【不入 git】
│   └── YYYYMMDD-内战N-MM-{matchId}.dem
│
├── parsed/YYYYMMDD/                          ← 解析中间产物【不入 git，可重生成】
│   ├── YYYYMMDD-内战N-MM-{matchId}.jsonl     ← 100MB+ 事件流
│   └── YYYYMMDD-内战N-MM-{matchId}-summary.json  ← ~50KB AI 友好摘要
│
├── analysis/YYYYMMDD/                        ← AI 战报【入 git，公示】
│   ├── YYYYMMDD-内战N-MM-AI战报.md           ← 主交付物
│   └── YYYYMMDD-内战N-MM-AI战报.html         ← （可选）渲染版，方便手机看
│
└── screenshots/YYYYMMDD/                     ← 战报里引用的截图【入 git】
    └── YYYYMMDD-内战N-MM-XX.png
```

---

## 命名约定

`YYYYMMDD-内战N-MM-...`

| 段 | 含义 | 例 |
|---|---|---|
| `YYYYMMDD` | 内战日期（不是分析日期） | `20260509` |
| `内战N` | 第几桌 / 第几组（同一晚可能开多桌） | `内战1` `内战2` `内战3` |
| `MM` | 该桌第几局，两位补零 | `01` `02` |
| `{matchId}` | OpenDota 比赛 ID（仅 replays / parsed 用） | `8803928598` |

**对战表 HTML 例外**：只有日期，因为一份对战表覆盖整晚 → `20260509-内战对战表.html`。

---

## 每种文件做什么、谁产出

| 文件 | 谁产出 | 入 git | 说明 |
|---|---|---|---|
| `index.html` | 手改 | ✓ | 每期发布后改 `<meta http-equiv="refresh">` 的 url 指最新对战表，正文里那行"正在跳转到 …"的中文链接也要改 |
| `YYYYMMDD-内战对战表.html` | 手写（复制上一期改） | ✓ | 公示页面，发群里的就是它。规则见 CLAUDE.md（中文为主、手机自适应） |
| `tools/*.{ps1,mjs,json}` | 一次性配置 | ✓ | 工具链，除非要改才动 |
| `replays/.../*.dem` | Dota 客户端下载 | ✗（gitignore） | 太大，本地保留 |
| `parsed/.../*.jsonl` | `parse-replay.ps1` | ✗（gitignore） | 中间产物，可重生成 |
| `parsed/.../*-summary.json` | `aggregate.mjs` | ✗（gitignore） | AI 输入用，不需要保留 |
| `analysis/.../*.md` | Claude 读 summary.json 生成 | ✓ | 主交付物 |
| `analysis/.../*.html` | Claude 把 .md 转 HTML | ✓ | 可选，给手机看更舒服 |
| `screenshots/.../*.png` | 手动截图 | ✓ | 战报里 `![...](../../screenshots/YYYYMMDD/xxx.png)` 引用 |

`.gitignore` 里 `*.dem` / `parsed/**/*.jsonl` / `parsed/**/*-summary.json` 已配置。

---

## 新一期内战 checklist

**A. 出对战表（赛前 / 接龙截止后）**

1. 复制上一期 `YYYYMMDD-内战对战表.html` → 新文件名
2. 按接龙顺序填名单（CLAUDE.md「排兵布阵规则」）
3. 顺位首位标"开房：XXX"
4. 改 `index.html` 的 refresh url + 正文链接 → 指向新文件
5. `git push` → Pages 1 分钟后重建

**B. 录像 → 战报（赛后，每局重复）**

1. 录像放进 `replays/YYYYMMDD/YYYYMMDD-内战N-MM-{matchId}.dem`
2. `.\tools\parse-replay.ps1 -DemPath ...` → 出 `.jsonl`
3. `node tools\aggregate.mjs ...` → 出 `-summary.json`
4. Claude 读 summary.json 写 `analysis/YYYYMMDD/YYYYMMDD-内战N-MM-AI战报.md`
5. （可选）转一份 .html 进同目录
6. 截图（如有）放 `screenshots/YYYYMMDD/`，md 里相对路径引用
7. `git add analysis/YYYYMMDD screenshots/YYYYMMDD && git commit && git push`

**C. 工具链就绪自检（怀疑环境坏了再做）**

- `docker ps` 看 `odota-parser` 是否 Up；不行就 `docker start odota-parser`
- `node -v` ≥ 18

---

## 当前未串起来的环节（下次可以做）

- **对战表 HTML 不链接 AI 战报**：群里看完对战表的人，看不到当晚战报。可以在对战表底部加一行「📖 本场战报：…」指 `analysis/YYYYMMDD/`。
- **没有总目录页**：`index.html` 只是 redirect。期数多了之后可以做一个真正的首页，列出所有期 + 每期战报。
- **战报 .md → .html 没自动化**：现在是 Claude 手写 HTML。期数多了可以加个 `tools/render-report.mjs`。

这三件事不是 must do，是"等到觉得需要再做"。

---

## Claude 来读这个文件时的一句话指令

> 进仓库先 Read 这个文件 + CLAUDE.md。要新建文件时按上面的目录树和命名约定走，不要发明新的目录结构。
