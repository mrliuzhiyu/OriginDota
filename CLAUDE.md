# 原点 Dota2 内战 · 对战表项目规则

这个仓库存放每期"原点 Dota2 内战"的对战表 HTML，托管在 GitHub Pages 让群里玩家直接打开手机浏览器看。

**Pages 链接（发给群里）：** https://mrliuzhiyu.github.io/OriginDota/

---

## 文件结构

- `index.html` — 跳转到最新一期对战表（用 `<meta http-equiv="refresh">`）
- `YYYYMMDD-内战对战表.html` — 每期独立文件，文件名带日期
- `CLAUDE.md` — 本文件，项目规则约定

新增一期：复制最新 HTML 改名 → 更新内容 → 改 `index.html` 跳转目标 → `git push`，Pages 自动重建（约 1 分钟）。

---

## 排兵布阵规则

### 1. 报名顺序优先

接龙编号（`#1, #2, ...`）是最高优先级规则。早报名的玩家优先进主力阵容，晚报名的玩家在没空位时只能进替补区。

- 高分晚报的人（哪怕 8000 分）也不能挤掉已报名的早报玩家
- 全员花名册按报名 `#1 → #N` 排，每张卡片右上角标"报名 #XX"

### 2. 不设专职队长，顺位首位玩家开房

每桌不设"专职队长 / 维护人"角色。由每桌**顺位首位**（按报名顺序，本桌最早报名的玩家）负责开房。

- 房间信息条标"开房：XXX (顺位首位 #N)"
- 暂停 / 处理掉线 / 换人协调由队伍队员一起决定
- 自报"纯潜水 / 观战"的玩家不要给"队长"头衔 — 他们就是想纯看戏

### 3. 自报观战 / 替补尊重个人选择

接龙里写"观战"、"替补"、"纯潜水"、"9 点替补或观战"等的玩家：

- 视为**本人主动选择不进主力**
- 即使段位高、位置紧缺，也不强拉上场
- 放在替补 / 观战区，注明本人意愿
- 缺人时可以问一声"愿不愿意上"，但默认是不强拉

### 4. 默认房间配置

- 房名：`原点 Dota 内战 1` / `原点 Dota 内战 2`（双桌时）
- 密码：`2016`
- 服务器：上海电信
- 模式：全英雄选择 (AP)
- 默认时间：周六 20:00
- 群内黑盒语音：<https://chat.xiaoheihe.cn/ia8us87s>
- 公示网页：<https://mrliuzhiyu.github.io/OriginDota/>

---

## 页面设计规则

### 5. 中文为主，英文做副标

所有 UI 标签**中文做主标，英文（如果保留）只能作为更小、更淡的装饰副标**。

| 错 | 对 |
|---|---|
| `Captain` | `队长` 或 `开房`（中文为主） |
| `Password` | `密码` |
| `Avg` | `均分` |
| `VOICE` | `语音` |
| `FULL ROSTER` | `全员名单` |
| `SUBSTITUTES` | `替补 · 观战` |
| 段位说"SEA" | 段位说"东南亚" |

例外：装饰性副标可保留小号英文，比如 `天辉 RADIANT`、`大哥位 Carry`、`高分桌 · HIGH`，前提是中文是主标且英文明显更小更淡。

### 6. 必须做手机自适应

群里玩家点链接基本都用手机，桌面布局在 360–390px 屏上挤成一坨。

必须有的 head 标签：
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a1a">
```

`@media (max-width: 600px)` 必须做的事：
- `.rooms` / `.teams` / `.captains` / `.subs-grid` / `.roster-grid` → 全部单列堆叠
- `.room-card .r-grid` 4 列 → 2 列
- `.voice-rows` → 2 列（用 `!important` 覆盖 inline style）
- `.battle-head` → flex-wrap，h2 占满宽，房名信息换行
- 字号整体下调 14px → 13px
- padding 从 56px 40px 缩到 24px 14px

`@media (max-width: 380px)` 进一步：
- `.room-card .r-grid` → 1 列
- `.voice-rows` → 1 列

inline style 里写的 `grid-template-columns` 必须用 `!important` 才能在 media query 里覆盖。

部署测试：iPhone SE（375px）、小屏 Android（360px）都要无横向滚动。

---

## 段位约定

- 段位即玩家的 Dota 2 天梯分数（MMR），单位"分"
- 表里的偏好位置 `1·2·3·4·5` 分别对应 大哥位 / 中单 / 劣单 / 游走辅助 / 硬辅
- 玩家最多写 3 个偏好位，**第一位是首选**
- 写"仅 X"表示只能 / 只想打 X 号位
- 玩家可能写在多服（国服 / 外服 / 东南亚），段位以本人填的为准
