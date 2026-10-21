# SQL 透视镜 · sql-xray

把一坨几百行的「屎山 SQL」，变成看得懂的结构 + 说人话的解释。

**纯浏览器运行 · 不上传 · 不入库 · 不留痕 · MIT 开源**

[在线演示](https://yogurt5122.github.io/sql-xray/) · [问题反馈](https://github.com/Yogurt5122/sql-xray/issues) · [源码](https://github.com/Yogurt5122/sql-xray)

![SQL 透视镜界面预览](assets/preview.png)

> 当前 **M2 进行中**：M1 的分句、上色、逐句解释已就绪；M2 已上线「执行流程」与「结构树」。
> 语义 AST、血缘、MyBatis 容错在后续步骤。

---

## 目录

1. [为什么做](#1-为什么做)
2. [三条原则](#2-三条原则)
3. [现在能做什么](#3-现在能做什么)
4. [支持的方言](#4-支持的方言)
5. [快速开始](#5-快速开始)
6. [隐私](#6-隐私)
7. [设计](#7-设计)
8. [路线图](#8-路线图)
9. [决策记录](#9-决策记录)
10. [目录结构](#10-目录结构)
11. [部署](#11-部署)
12. [安全](#12-安全)
13. [License](#13-license)

---

## 1. 为什么做

接手别人的项目，最劝退的往往不是业务复杂，而是一坨几百行、没人敢改的 SQL：

- 一行一行读，读到最后忘了开头在干什么；
- 子查询套子查询，`t1`、`t2`、`a`、`b` 满天飞，不知道哪个字段从哪来；
- 想跑一下看结果？生产库没权限，测试库数据不对，跑一遍还要等；
- 丢给 AI？公司合规第一条就是「禁止把代码和 SQL 贴到外部网站」。

现有工具各有短板：在线格式化站点要先上传；IDE 插件只高亮不解释；`EXPLAIN` 要库权限；通用 AI 不敢贴。

所以做一个**打开就能用、关掉就没了、全程不联网**的单页工具。

## 2. 三条原则

1. **本地优先**
   解析、分析、解释、绘图全部在浏览器完成。服务器只发一次静态文件，没有接口可调，没有地方可写。
2. **零持久化**
   SQL 只存在于页面内存。刷新即清空，关标签页即消失。不写 localStorage / IndexedDB / Cookie，只记住主题、方言这类 UI 偏好。
3. **渐进降级**
   屎山 SQL 语法千奇百怪，严格解析器一定会失败。**解析失败也必须有用**：退化成「结构模式」，照样能分句、定位、看表、查风险。

## 3. 现在能做什么

### 已实现

| 能力 | 说明 |
| --- | --- |
| 四方言识别 | MySQL / SQL Server / PostgreSQL / DM8，按特征打分，可手动切换 |
| 语句与子句切分 | 顶层 `;` 切语句；`SELECT / FROM / JOIN / WHERE / GROUP BY / HAVING / ORDER BY / LIMIT` 等切子句；字符串、注释、括号内的关键字不误切 |
| 子句色条 | 编辑器左侧按语义上色，结构在文本里就能看见 |
| 执行流程 | 按 `FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT` 的真实求值顺序展示，点击阶段定位原文 |
| 结构树 | 语句 → 主查询 → 子句 → 子查询 / CTE；可折叠、搜索表/字段、只看含表，点击节点定位原文 |
| 逐句人话解释 | 每个子句一段大白话 + 术语版 + 涉及的表 |
| 一句话总结 | 从哪取数、关联谁、几个过滤条件、怎么分组、输出几列、怎么排序、取多少行 |
| 风险提示 | 已接入 5 条：`SELECT *`、缺连接条件、`NOT IN` NULL、`LIMIT` 无排序、DM8 `ROWNUM` 排序陷阱 |
| 双向定位 | 点行 → 高亮对应解释；点解释 → 滚动到原文行 |
| 隐私自证 | 构建产物扫描：无 `fetch` / XHR / WebSocket / 外链 |
| 测试 | 37 个单元测试，畸形输入不崩溃 |

### 规划中

| 阶段 | 能力 |
| --- | --- |
| M2 | 语义 AST、总结增强、结构树、MyBatis 容错、Web Worker |
| M3 | 表关系图、字段血缘、17 条风险规则、指标卡、导出、DM8 `(+)` 转连接边 |
| M4 | 大 SQL 性能、PWA、单文件离线版、暗色模式、正式发布 |
| V2 | 两版 SQL 对比、MyBatis 完整分支展开、可选 DDL、AI（BYOK） |

## 4. 支持的方言

| 方言 | 目标版本 | 解析策略 | 状态 |
| --- | --- | --- | --- |
| MySQL | 5.7 / 8.0 | `node-sql-parser` | P0 |
| SQL Server | 2016+（T-SQL） | `node-sql-parser`（TransactSQL） | P0 |
| PostgreSQL | 12+ | `node-sql-parser` | P0 |
| 达梦 DM8 | DM8（Oracle 兼容模式） | 结构模式 + 语法画像；语义解析用可选的 Oracle WASM 适配器 | P0 |

DM8 的语法接近 Oracle：`ROWNUM`、`(+)` 外连接、`NVL`、`DECODE`、`CONNECT BY`、`DUAL`、`MINUS`、`VARCHAR2`。现成 JS 解析器都不覆盖，所以 DM8 先用结构层保底。

Hive / ClickHouse 暂不列入首批。

## 5. 快速开始

要求：Node 22+、pnpm 11+。

```bash
cd app
pnpm install
pnpm dev              # http://localhost:5173
```

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 本地开发 |
| `pnpm test` | 37 个单元测试 |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm check:privacy` | 扫描构建产物：无网络 API、无外部资源 |
| `pnpm preview` | 预览生产构建 |

在线演示：<https://yogurt5122.github.io/sql-xray/>

## 6. 隐私

**你粘贴的 SQL 不会被发送到任何服务器，也不会被保存。**

```text
浏览器
  ├─ 粘贴 SQL
  ├─ 在内存中解析、分析、生成解释
  ├─ 结果只渲染在当前页面
  └─ 关闭页面 → 数据消失

服务器
  └─ 只发送一次 HTML / JS / CSS 静态文件，之后不再参与
```

- 没有后端接口、没有数据库、没有账号系统。
- 没有第三方脚本、统计 SDK、广告、字体 CDN。
- 不使用 Cookie；不把 SQL 或结果写入任何浏览器存储。
- 导出功能（M3）会在本地用 `Blob` 生成，不经过服务器。

### 你可以自己验证

1. DevTools → Network：粘贴并分析 SQL，观察是否出现新请求；
2. Application → Local / Session Storage / IndexedDB：确认没有 SQL；
3. 断网后刷新（已缓存时），功能应当正常；
4. 审查源码，或自行构建后与 Release 的 SHA-256 对比。

### 我们防不住的（诚实说明）

- 浏览器扩展读取页面内容；
- 本机恶意软件、录屏软件、内存取证；
- 粘贴之前，剪贴板已被其他程序读取；
- 浏览器崩溃转储；
- 托管平台（GitHub Pages）记录访问 IP 与时间——这是正常 Web 日志，与 SQL 内容无关。

我们承诺的是**架构上不主动外发、不落盘**，不是「任何手段都无法获取」。

## 7. 设计

### 7.1 数据流

```text
粘贴
  → MyBatis 预处理（仅检测到 XML 标签时）
  → Scanner        词法：字符串 / 注释 / 引号 / 参数 / 括号深度
  → Splitter       语句 + 子句 + 精确行号
  → ParserAdapter  按方言路由，尽力而为，允许失败
  → IR Builder     统一中间表示，所有节点带 Span
  → Analyzer       作用域 / 血缘 / 图 / 指标 / 风险
  → Explainer      模板生成人话
  → 渲染 + 双向定位
```

M2 起整条流水线放进 Web Worker，主线程不阻塞。

### 7.2 为什么是分层解析，而不是一个解析器

| 层 | 输入 | 输出 | 失败时 |
| --- | --- | --- | --- |
| L0 Scanner | 原始文本 | Token（offset / 行号 / 括号深度） | 几乎不失败 |
| L1 Splitter | Token | 语句树 + 子句段 | 不失败 |
| L2 Parser | 文本 + 方言 | 第三方 AST | **允许失败** |
| L3 IR | Token + 子句 + AST | `AnalysisResult` | 无 AST 时构建结构版 IR |

这四层是**能力叠加**，不是流水线依赖：L0 / L1 永远可用，L2 / L3 尽力而为。这是「解析失败也有用」的技术基础，也是行号能精确到字符的前提。

### 7.3 DM8 怎么支持

不追求完整 AST，用**语法画像 + 结构规则**拿到最有用的信息：

| 特性 | 处理 |
| --- | --- |
| `(+)` 外连接 | 在 `WHERE` 中识别可空侧，M3 转成 LEFT / RIGHT 连接边 |
| `ROWNUM` | `ROWNUM <= n` 等价 `LIMIT n`；与同层 `ORDER BY` 共存时提示 RSK-16 |
| 分页嵌套 | 还原「排序 → 编号 → 截取」三步 |
| `CONNECT BY` | 标记层级查询，血缘暂停并标注 |
| `NVL` / `DECODE` | 解释为「为空取默认值」/「多分支取值」 |
| `MINUS` / `DUAL` | 集合运算 / 不生成真实数据源 |

边界：`BEGIN ... END` 的 PL/SQL 块整体视为不透明语句，不解析内部流程。

### 7.4 MyBatis

用户从 XML 复制出来的往往不是纯 SQL，而是带 `<if>`、`<where>`、`<foreach>` 的模板。

**做法：等长替换，保住行号。**

```text
原始:   <if test="status != null"> AND status = #{status} </if>
处理后:                            AND status = #{status}
```

标签被替换成等长空格，`offset` 和行号完全不变，双向定位不需要映射表。

- 识别 8 个常用标签：`<if> / <choose> / <when> / <otherwise> / <where> / <set> / <trim> / <foreach> / <include>`；
- 提供「全保留 / 全去掉」两个变体，只做两个极端，不枚举组合；
- 标注「动态条件」，不把 `<if>` 内容说成必然生效；
- 完整分支展开放 V2。

### 7.5 人话怎么生成

**不用 LLM**：零外发、可复现、不编造。

硬规则：

1. 数字必须来自 IR，不能出现原文没有的行数 / 表数 / 列数；
2. 表名、列名、别名必须回查原文，找不到就写「未识别」；
3. 不确定就标注「未识别」「可能是」，并说明依据；
4. 参数 `?` / `:name` / `#{...}` 一律表述为「外部传入的值」，不编造具体取值；
5. 原文注释保留，挂在对应子句上——老 SQL 的注释常是唯一的口径线索。

### 7.6 风险规则

目标 17 条，当前已接入 ✅ 5 条。

- **结构**：✅ `SELECT *`（RSK-01）、✅ 缺连接条件 / 笛卡尔积（RSK-02）、嵌套过深（RSK-10）、1:N JOIN 放大指标（RSK-14）、重复计算（RSK-15）
- **性能**：函数包字段（RSK-03）、同一大表重复扫描（RSK-05）、子查询 `ORDER BY` 无 `LIMIT`（RSK-06）、`UNION` 可改 `UNION ALL`（RSK-08）、`SELECT` 里的关联子查询（RSK-12）
- **语义**：隐式类型转换（RSK-04）、`DISTINCT` 掩盖放大（RSK-07）、硬编码日期 / 魔法值（RSK-09）、✅ `NOT IN` 遇 NULL（RSK-11）、✅ `LIMIT` 无 `ORDER BY`（RSK-13）
- **DM8**：✅ `ROWNUM` 与 `ORDER BY` 同层（RSK-16）、`(+)` 放错侧（RSK-17）

所有提示都注明：**静态代码检查，不是执行计划，也不代表一定会慢。**

### 7.7 IR 与稳定 ID

所有视图只读同一份 IR，不直接读 AST，避免「流程图和血缘各说各话」。

节点 ID 用稳定哈希：

```text
id = hash(kind + ':' + startLine + ':' + startCol + ':' + normalize(text)).slice(0, 12)
```

不用随机数。同一段 SQL 多次分析得到相同 ID，V2 的「两版对比」才能对齐节点。

### 7.8 界面

- 左：CodeMirror 6 编辑器，子句左侧彩色竖条（取数蓝 / 过滤橙 / 聚合紫 / 计算绿 / 排序灰 / 风险红）。
- 右：一句话总结 → 指标 → 风险 → 执行流程 → 结构 → 逐句解释。
- 点解释跳到行，点行高亮解释。
- 不加载 Web Font、不引 UI 组件库，首屏 gzip 约 200 KB。

### 7.9 设计规范（实现依据）

**页面**：单页。桌面左右分栏（编辑 42% / 结果 58%）；≤1080px 上下堆叠。结果区自上而下：总结 → 指标 → 风险 → 执行流程 → 结构 → 逐句解释。

**配色**：

| 用途 | 色值 |
| --- | --- |
| 背景 / 面板 | `#F5F7FA` / `#FFFFFF` |
| 正文 / 次要文字 | `#0F172A` / `#64748B` |
| 边框 | `#E2E8F0` |
| 主色 | `#2563EB` |
| 风险 | `#DC2626` |

子句语义色：取数 `#2563EB`、过滤 `#EA580C`、聚合 `#7C3AED`、计算 `#059669`、排序 `#475569`、风险 `#DC2626`、未知 `#6B7280`。

**字体**：正文 `system-ui, "PingFang SC", "Microsoft YaHei"`；代码 `ui-monospace, Consolas`。不加载 Web Font。

**间距**：4px 基准；卡片圆角 10px、按钮 7–9px；页面内边距 14–20px。

**组件**：Topbar、EditorPane、SummaryCard、Metrics、IssueCard、FlowTrack、StructureTree、ClauseList、StatusBar。

**结构树**：位于执行流程下方、逐句解释上方；默认展开，可折叠；每层缩进 16px；节点 = 类型徽章 + 名称 + 行号；点击节点跳转原文；顶部搜索框 + 「只看含表」开关；当前光标所在节点高亮。

## 8. 路线图

| 阶段 | 主题 | 内容 | 状态 |
| --- | --- | --- | --- |
| M0 | 设计 | 需求、技术方案、交互、路线图 | ✅ |
| M1 | 最小闭环 | 分句、上色、逐句解释、双向定位 | ✅ v0.1.0 |
| M2 | 看懂 | 语义 AST、总结、结构树、MyBatis 容错、Worker | 进行中（执行流程、结构树已上线） |
| M3 | 看透 | 表关系、血缘、17 条规则、指标、导出、DM8 `(+)` | 计划 |
| M4 | 可用 | 性能、PWA、单文件离线、暗色模式、发布 | 计划 |
| V2 | 增强 | 两版对比、完整 MyBatis、DDL、AI（BYOK） | 想法池 |

剩余估算约 **40–50 人日**。M2 先做最不确定的两件事：语义解析覆盖率、MyBatis 真实语料。

## 9. 决策记录

| 决策 | 结论 | 说明 |
| --- | --- | --- |
| 首批方言 | MySQL、SQL Server、PostgreSQL、DM8 | DM8 用 Oracle 兼容语法，单独做画像 |
| MyBatis | M2 做容错，不做完整展开 | 覆盖 80% 场景；组合爆炸留给 V2 |
| WASM | M2 末 1–2 天 PoC，只给 DM8 | 门槛：20 段语料成功率 ≥ 70%、≤ 800 KB、500 行 ≤ 300 ms；不达标不上 |
| 两版对比 | V2 第一个功能 | IR 节点 ID 已按稳定哈希设计 |
| 开源 | MIT | 可审计、可自建 |
| 发布 | GitHub Pages | CI 自动部署；内网可托管 `dist/` |
| 英文 | V1 仅中文 | 文案抽离，后续加不返工 |

## 10. 目录结构

```text
sql-xray/
├─ README.md                 # 本文档
├─ LICENSE                   # MIT
├─ assets/preview.png        # 界面截图
├─ .github/workflows/        # CI + Pages 部署
├─ app/
│  ├─ src/
│  │  ├─ core/               # scanner / splitter / 方言 / 类型
│  │  ├─ parsers/            # 语义解析适配器（M2）
│  │  ├─ preprocess/         # MyBatis 预处理（M2）
│  │  ├─ analyze/            # 血缘 / 图 / 指标 / 规则（M3）
│  │  ├─ explain/            # 人话模板（M2 拆分）
│  │  └─ ui/                 # 编辑器 / 解释列表 / 主页面
│  ├─ tests/                 # 单元测试
│  └─ scripts/               # 构建产物隐私检查
└─ dist/                     # 构建产物（不提交）
```

## 11. 部署

**GitHub Pages（推荐）**

推送到 `main` 后，`.github/workflows/deploy.yml` 自动构建并发布。

首次使用：仓库 → Settings → Pages → Source 选择 **GitHub Actions**。

**任意静态服务器**

```bash
cd app
pnpm build
# 把 app/dist/ 整个目录丢给 Nginx / 对象存储 / 内网服务器即可
```

构建使用相对路径（`base: './'`），放在子目录也能正常加载。

## 12. 安全

- 发现安全问题请**不要**开公开 Issue，使用 GitHub 的 [Private vulnerability reporting](https://github.com/Yogurt5122/sql-xray/security/advisories/new)。
- 关注范围：SQL 被外发、XSS、依赖链投毒、构建产物与源码不一致、解析器崩溃。
- 已知边界见 [隐私](#6-隐私)：浏览器扩展、恶意软件、托管平台访问日志不属于本项目能防护的范围。
- Release 会附构建产物 SHA-256，支持自行构建比对（M4）。

## 13. License

[MIT](LICENSE) © 2026 sql-xray contributors
