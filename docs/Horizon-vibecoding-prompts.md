# Horizon Vibecoding 分步提示词

> 基于 `Horizon-PRD.md` 和 Cent 现有代码架构生成。每一步可独立复制到 vibecoding 会话中使用。
> 建议按顺序执行，每步跑通验证后再进入下一步——每一步完成后都有一个可运行、可感受的产物。

---

## 起手式：从 Cent 继承什么，新做什么

### 原地复用（不改架构，只换业务）

| 层 | 能直接用 | 注意 |
|---|---------|------|
| 构建链 | Vite 8 + React 19 + TypeScript + Tailwind v4 + Biome | 完全不用动 |
| UI 组件 | shadcn/ui 全套（button, dialog, progress, tabs, tooltip, sonner…） | Horizon 的卡片、弹窗、进度条都在里面 |
| 状态管理 | Zustand + Immer 模式 | 新建 store 文件，写法照抄现有 |
| 本地存储 | IndexedDB（database/storage.ts + idb） | 简化使用——Horizon 不需要账单的 stash/patch 机制 |
| 云端同步 | Tidal 引擎（tidal/）+ GitHub/Gitee/S3/WebDAV 端点 | 整个目录原样复用 |
| 国际化 | react-intl + src/locale/ | 改语言包内容即可 |
| PWA | vite-plugin-pwa + sw.ts | manifest 名字改成 Horizon |
| 动画 | motion（Framer Motion 替代） | 进度点亮、庆祝粒子全靠它 |
| 路由 | react-router v7 + MemoryRouter | 改 route.tsx 里的页面映射 |
| 通用工具 | src/utils/（lazy, fetch-proxy 等） | 直接复用 |

### 需要拆掉/替换的

| 层 | 做法 |
|---|------|
| src/pages/ | 三个页面（home/search/stat）全部替换为 Horizon 页面 |
| src/store/ledger.ts | 账单 store → 替换为目标/资金池 store |
| src/ledger/ | 账单领域模型全部删除，新建 src/horizon/ 领域模型 |
| src/components/ | 保留 ui/，删除账单相关组件（bill-editor 等），新建 Horizon 组件 |
| src/database/ | 保留 IndexedDB 基础设施，删除账单特定的 stash/patch |
| src/api/predict/ | 分类预测 → 替换为花销预估引擎（PRD 模块 6） |
| src/assistant/ | 可选保留或删除（PRD 没说 AI 助手） |

---

## 第 1 步：数据模型 + 资金池分配引擎（预计 1-2 天）

```
你要在 Cent 项目（E:\Code\Cent）里开始搭建 Horizon 的核心数据层。

## 背景
Cent 是一个 React 19 + TypeScript + Vite 8 的记账 PWA 应用。我们要在同一个项目里构建 Horizon——一个目标追踪 + 资金池分配 App。PRD 见 docs/Horizon-PRD.md。

## 任务

### 1.1 创建 src/horizon/types.ts

定义以下核心类型（参考 PRD §4 模块 2 和模块 3）：

- FundPool: { id, name, icon, color, rule: 'fixed'|'percent'|'monthly-list'|'residual-factor'|'remainder', priority, balance, subItems: PoolSubItem[], autoFlowTo?: string }
- PoolSubItem: { id, name, icon, budget, tracking: 'per-use'|'monthly-estimate'|'fixed-monthly', unitPrice?, estimatedCount?, spent, stash: number }
- Goal: { id, name, mode: 'multi-image'|'single-image'|'text', targetAmount, currentAmount, images: GoalImage[], milestones: Milestone[], boundPoolId }
- GoalImage: { id, src, label, budget, progress: number }  // progress: 0-1
- Milestone: { id, label, amount, completed }
- Equipment: { id, name, category, price, status: 'want'|'owned'|'maintenance', boundPoolId, image? }
- GrowthEvent: { id, date, type: 'milestone'|'subitem-adjust'|'equipment-harvest'|'note'|'balance-redirect', summary, amount?, linkedGoalId? }
- SalaryDistribution: { poolId, allocated, rule, remaining }

### 1.2 创建 src/horizon/pool.ts

实现分配管道引擎函数：

  distributeSalary(amount: number, pools: FundPool[]): SalaryDistribution[]

逻辑（PRD 模块 2 的管道）：
1. 按 priority 升序排列 pools
2. 依次遍历，根据 rule 计算分配金额：
   - 'fixed': 取固定金额（不超过剩余）
   - 'percent': 取 amount * 百分比
   - 'monthly-list': 汇总该池子的固定月费子项
   - 'residual-factor': 前面分完后，剩余 * 系数
   - 'remainder': 兜底，前面分完剩多少全归它
3. 返回每个池子的分配结果

每个池子分配完后，自动初始化其 subItems 的本月预算。

### 1.3 创建 src/horizon/goal.ts

- createGoal(params) - 创建目标并绑定资金池
- updateProgress(goalId, amount) - 更新目标进度，自动计算图片/里程碑状态
- getImageProgress(goal) - 多图模式：每张图 0-1 的完成度；单图模式：每格 0-1

### 1.4 创建 src/store/horizon.ts

用 Zustand + Immer 创建主 store（参考 src/store/ledger.ts 的写法）：

  useHorizonStore:
    state: { goals, pools, equipments, growthEvents, salaryDay }
    actions:
      - distributeSalary(amount)   // 调用 pool.ts 的分配引擎
      - addPool / removePool / updatePool / reorderPools
      - addSubItem / updateSubItem / removeSubItem
      - addGoal / updateGoal / deleteGoal
      - addEquipment / harvestEquipment
      - adjustEstimate(poolId, newAmount)   // 手动校准
      - resolveMonthEnd()   // 月底结余处理：各池子暂存 → 按规则流转
      - addGrowthEvent
    middleware: persist (IndexedDB)

初始化时自动创建 PRD 中的 6 个模板池子（A-F），作为用户起点。全部可改名/可删。

### 1.5 创建最小可跑页面 src/pages/pools/index.tsx

- 显示所有 FundPool 的卡片列表
- 每张卡片显示：名称、图标、余额、规则类型
- 顶部一个输入框 + 按钮："工资 ¥______ [分配]"
- 点击分配后，卡片上的余额数字用 motion 做递增动画
- 把路由 / 指向这个页面

## 验证标准
- 输入 12000 点击分配，6 个模板池子的余额正确更新
- 刷新页面数据不丢失（IndexedDB 持久化生效）
```

---

## 第 2 步：目标设定向导（预计 1 天）

```
你要在 Horizon 项目里新建目标设定向导页面。当前已有 src/horizon/types.ts、src/horizon/pool.ts、src/horizon/goal.ts 和 src/store/horizon.ts。

## 任务

### 2.1 创建 src/pages/wizard/index.tsx

一个多步骤向导（参考 PRD §4 模块 1），步骤用顶部 Stepper 指示：

**步骤 1：起名字**
- 输入框："给你的目标起个名字"
- 下方展示预设示例（"欧亚环线"、"去日本读研"、"提前退休"、"买第一套房"），点击填入
- [下一步] 按钮

**步骤 2：选呈现方式**
- 三张大卡片供选择：
  - 🖼️ 图片模式·多图 —— 一张图 = 一个阶段，攒够一张亮一张
  - 🧩 图片模式·单图 —— 一张大图切格子，逐格点亮
  - 📋 文字模式 —— 清单 + 进度条
- 选中高亮边框（用 shadcn 的 Card 组件 + ring-primary 高亮）

**步骤 3（图片模式·多图）：**
- 上传 N 张图片（拖拽或点击上传区域）
- 每张图下方可填标签（如"深圳"、"喀什"…）和预算金额
- 底部自动显示总预算汇总
- 预设一个初始状态预览：所有图片灰色/暗色（CSS filter: grayscale(1) brightness(0.3)）

**步骤 3（图片模式·单图）：**
- 上传 1 张图
- 选择切分：2×2 / 3×3 / 4×4 / 5×5 或自定义行列
- 实时预览切割网格覆盖在图片上
- 每格可调预算，底部汇总

**步骤 3（文字模式）：**
- 添加节点列表，每个节点：描述 + 金额
- 可拖拽排序
- 示例模板一键填入（如"财务自由 10 步"的预设清单）

**步骤 4：绑定资金池**
- 选择/新建一个梦想基金池
- 设定每月最低存入金额
- 预览：dashboard 上目标卡片的初始状态
- [完成，开始追踪] 按钮

### 2.2 表单处理
- 用 react-hook-form（Cent 已安装）
- 每步独立表单验证
- 允许跳过步骤，后面再补（数据存到 store 的 draft 状态）

## 验证标准
- 走完 4 步创建一个"欧亚环线·多图·10 站"目标
- 创建后跳到 pools 页面，能看到自动创建的"梦想基金"池子已经绑定
```

---

## 第 3 步：池子详情 + 子项管理（预计 1-2 天）

```
你要在 Horizon 项目里搭建资金池的详情页和子项管理功能。这是 PRD §4 模块 2+3 的核心交互。

## 任务

### 3.1 创建 src/pages/pool-detail/index.tsx

路由: /pool/:id

从 store 拿单个 pool 的数据，展示：

**顶部区域：池子概览**
- 池子名称、图标、余额（大号数字）
- 规则类型标签（固定金额 / 按比例 / …）
- 优先级序号，拖拽手柄（用 dnd-kit，Cent 已安装）
- [发薪日一键分配] 按钮 → 弹出金额输入 → 调用 distributeSalary

**中部区域：子项列表（模块 3 的核心）**
- 每个子项一行卡片：
  - 图标 + 名称
  - 追踪方式标签：按次 / 按月估算 / 固定月费
  - 预算金额 + 已花金额
  - 按次模式：🛞🛞🛞⬜ 式样的倒计数指示器
  - 按月估算模式：进度条 + 百分比
  - 固定月费模式：✓ 已扣标记
- [添加子项] 按钮 → 弹出表单：
  - 名称、预算金额
  - 追踪方式三选一（radio）
  - 按次：补充单次价格 + 预估次数
  - 按月估算：无需额外字段
  - 固定月费：无需额外字段
- 子项可长按拖拽排序
- 点击子项进入编辑模式
- "又做了一次"按钮（按次追踪的子项）：页面内触发，触发后倒计数 -1，用 motion 做轮胎缩小消失动画

**底部区域：暂存区**
- "暂存 ¥XXX" 卡片
- 下拉选择："未花完的钱默认转入 [选择目标池子 ▼]"
- 暂存金额可手动拖到任意子项（"周末想多跑一节赛车"）

### 3.2 子项追踪交互细节

**按次追踪的打卡**：
- 点一下"又做了一次"，轮胎少一格
- 预算花完时，子项自动变灰 + 提示"本月已用完"

**按月估算的自动每日扣减**：
- 计算 dailyRate = 预算 ÷ 当月天数
- 用 setInterval（每 60s 检查一次日期变化）模拟每日自动扣减
- 扣减是预估的，标注"此为估算值，欢迎随时校准"

**暂存规则**：
- 子项本月未花完的部分 → 月底自动归入暂存
- 暂存的处理逻辑：根据池子设置 autoFlowTo 字段，月末自动转入目标池

### 3.3 池子之间的优先级调整
- 在 pools 列表页中，池子卡片可拖拽重排
- 拖拽完成后自动更新所有池子的 priority 字段
- 优先级变化后，顶部显示提示："分配顺序已更新，下次发薪日会按新顺序分配"

## 验证标准
- 打开爱好基金池详情，看到赛车子项 🛞🛞🛞🛞
- 点"又做了一次"，轮胎变成 🛞🛞🛞⬜，已花增加 470
- 把徒步子项预算从 800 拖到 500，差额 300 自动进暂存
- 暂存设置"转入梦想基金"，月底自动触发流转
```

---

## 第 4 步：目标进度可视化（预计 2-3 天）

```
你要在 Horizon 项目里搭建进度可视化页面。这是 PRD §4 模块 4 的内容——Horizon 跟所有其他 App 最不一样的地方。

## 任务

### 4.1 创建 src/pages/progress/index.tsx

路由: /progress/:goalId

根据 goal.mode 渲染不同的可视化。

### 4.2 多图模式（multi-image）

- N 张图片以网格排列（响应式：手机 2 列，平板 3-4 列）
- 每张图片的渲染状态由 progress（0-1）决定：
  - 0 → filter: grayscale(1) brightness(0.3)（全黑）
  - 0.5 → filter: grayscale(0.5) brightness(0.65)（灰色）
  - 1 → filter: grayscale(0) brightness(1)（全彩）
  - 用 CSS transition 在状态之间平滑过渡（1s ease）
- 完成的图片右上角盖一个金色 ✓ 徽章
- 点击任意图片 → 全屏大图 + 备注编辑
- 底部显示："已走完 2/10 站 · 梦想基金 ¥68,000"

### 4.3 单图模式（single-image）

实现思路：CSS Grid + 多个 div。

- 每个格子 div 使用 background-image + background-position + background-size 只显示对应区域
- 每个格子独立 filter 控制亮度
- Grid 线为细金色线（已完成格）或灰色线（未完成格）
- 格子上方叠加小标签："¥25,000 / ¥40,000"
- 全部点亮时触发庆祝动画（motion 粒子效果，从图片中心向外扩散）

### 4.4 文字模式（text）

- 清单列表，每行：序号 + 描述 + 金额 + 状态
- 状态三种视觉：
  - ✅ 完成（绿色 + 达成日期）
  - ⏳ 进行中（shadcn Progress 组件显示当前进度百分比）
  - ⬜ 尚未开始（灰色）
- 底部一句话："如果每月多放 X 元，第 N 步可提前 M 个月"（简单计算）

### 4.5 三种模式可切换

- 顶部 tab 或下拉："多图 / 单图 / 文字"
- 切换时不丢数据（底层 goal 数据统一存储，只是渲染方式不同）
- 从文字切换到单图时，引导上传图片 + 设置切割

## 验证标准
- 多图模式：10 张图，前 2 张全彩、第 3 张 32% 灰 → 平滑过渡
- 单图模式：4×4 格，前 5 格全亮 → 第 6 格 50% 灰
- 文字模式：3 步完成、1 步进行中、6 步未开始
```

---

## 第 5 步：桌面小组件 + 剩余模块（预计 1-2 天）

```
你要在 Horizon 项目里完成桌面小组件、自动预估校准、结余处理、成长记录等收尾模块。

## 任务

### 5.1 桌面小组件配置页

创建 src/pages/widget-config/index.tsx

三种可添加到桌面的小组件预览和开关（参考 PRD §4 模块 10）：

- 🌅 梦想进度：缩略版目标图片 + 已走完路段高亮。数据源：当前活跃目标的 progress
- 🔋 生活费电量：环形进度条（SVG circle stroke-dashoffset 动画）+ "还剩 X 天"。数据源：生活必需池的 balance / 月度总额
- ⏱️ 爱好倒计时：当前活跃子项的追踪状态。按次模式 → 轮胎图标 + 剩几次；按月模式 → 进度条

每个组件下方有 [添加到桌面] 按钮。

PWA 层面：更新 vite.config.ts 中 VitePWA 的 manifest.name 为 "Horizon"，short_name 为 "Horizon"。

### 5.2 自动预估 + 手动校准（PRD §4 模块 6）

创建 src/horizon/estimate.ts 和 src/components/calibration-slider.tsx

**预估引擎**：
- 函数 dailyEstimate(pool: FundPool): number
- 平均模式（默认）：月度预算 ÷ 当月天数
- 周末加权模式（可选）：工作日权重 1.0，周末权重 1.5，按比例重分配
- 每天凌晨更新（用 setInterval 检测日期变化），自动从池子余额中扣减估算值

**手动校准滑块**：
- 一个水平滑块，当前值是系统估算的剩余百分比
- 用户拖动到"他感觉是对的"位置
- 系统计算差额，弹出可选标签（"🍽️ 聚餐" / "🛒 购物" / "算了不填"）
- 系统回一句温和的确认："已调整，还在可控范围"
- 明确标注"此为估算值，欢迎随时校准"（小号灰色文字）

### 5.3 结余处理（PRD §4 模块 5）

- 在 store 中实现 resolveMonthEnd()：
  - 扫描所有池子的子项 → 计算 spent vs budget
  - 未花完的部分归入暂存
  - 暂存按 autoFlowTo 设置自动转入目标池
- 如果用户没设置 autoFlowTo，月底弹出引导界面（PRD §4 模块 5 的结余处理界面）：
  - "你的 XXX 池子省下了 ¥X"
  - 选项：转入梦想基金（推荐）/ 应急储备 / 装备基金 / 犒赏自己
  - [一键确认]（默认选梦想基金）
- 设置里可开启"所有结余默认转入梦想基金"的懒人模式

### 5.4 成长记录时间线（PRD §4 模块 8）

创建 src/pages/growth-record/index.tsx

- 垂直时间线布局：左边日期，右边事件卡片
- 事件类型对应不同图标和颜色：
  - 🚀 阶段完成（金色）
  - ⚔️ 子项调整（蓝色）
  - 🔧 装备收割（绿色）
  - 📝 随手记（灰色）
  - 🪹 结余分配（紫色）
- 按年份分组，年份标题有 sticky 效果
- 年底自动生成年度回顾卡片（可导出 PDF——先用 window.print() 简单实现）

### 5.5 路由整合

更新 src/route.tsx：

  <Routes>
    <Route element={<MainLayout />}>
      <Route index element={<Pools />} />
      <Route path="/pool/:id" element={<PoolDetail />} />
      <Route path="/wizard" element={<Wizard />} />
      <Route path="/progress/:goalId" element={<Progress />} />
      <Route path="/equipment" element={<Equipment />} />
      <Route path="/growth-record" element={<GrowthRecord />} />
      <Route path="/widget-config" element={<WidgetConfig />} />
    </Route>
  </Routes>

更新 MainLayout 中的底部导航栏：
- 池子 | 目标 | 装备 | 记录（四个 tab）
- 中间一个大的 [+] 按钮（发薪日快速分配入口）

## 验证标准
- 桌面电量组件显示环形进度条，百分比与池子数据一致
- 拖动校准滑块，系统弹出"已调整"确认
- 成长记录时间线显示过去的事件，按年份分组
- 底部导航四个 tab 正常切换
```

---

## 第 6 步：接入云端同步（预计 1 天）

```
你要在 Horizon 项目里接入 GitHub/Gitee 云端同步。Cent 已有完整的 Tidal 同步引擎（src/tidal/）和存储端点（src/api/endpoints/），直接复用。

## 任务

### 6.1 定义同步数据结构

创建 src/horizon/sync.ts：

- horizonDataToSyncPayload(store) — 将 Zustand store 中的 goals、pools、equipments、growthEvents 序列化为 JSON
- syncPayloadToHorizonData(payload) — 反序列化回 store 状态
- 数据结构版本号：v1

### 6.2 接入 Tidal 引擎

- 参考 Cent 的 sync 初始化方式（见 src/tidal/index.ts 的 createTidal 调用）
- 创建 src/horizon/sync-engine.ts，封装：
  - pushToRemote(data) — 加密后推送到 GitHub/Gitee
  - pullFromRemote() — 拉取并解密
  - syncLoop() — 比较本地和远程哈希，增量同步
- 在 store 的 persist 中间件中，每次状态变更后触发防抖 sync（用 Cent 已有的 scheduler 工具）

### 6.3 同步设置页面

创建 src/pages/sync-settings/index.tsx：

- 选择存储端点：GitHub / Gitee / S3 / WebDAV / 离线
- 登录 OAuth 按钮（复用 Cent 已有的 OAuth flow）
- 同步状态指示器（上次同步时间、是否出错）
- [立即同步] 按钮
- 数据导出/导入按钮（JSON 文件）

## 验证标准
- 选择 GitHub 端点 → OAuth 登录 → 数据推送到 GitHub 仓库
- 清除本地数据 → 从 GitHub 拉取 → 数据完整恢复
```

---

## 附录：最小可运行切片（不想等的话现在就能跑）

如果不想按部就班走 6 步，先做这个最小切片得到第一个回馈：

1. 创建 `src/horizon/types.ts`，定义三个核心类型：

```ts
type FundPool = { id, name, rule: 'fixed'|'percent'|'monthly-list'|'residual-factor'|'remainder', priority, balance, subItems: PoolSubItem[] }
type Goal = { id, name, mode: 'multi-image'|'single-image'|'text', targetAmount, currentAmount, images, milestones }
type PoolSubItem = { id, name, budget, tracking: 'per-use'|'monthly-estimate'|'fixed-monthly', unitPrice?, estimatedCount?, spent }
```

2. 创建 `src/store/horizon.ts` —— 一个 Zustand store，写 `distributeSalary(amount: number)` 函数，把工资按优先级流过所有池子。

3. 创建 `src/pages/pools/index.tsx` —— 一组卡片，显示每个池子的名字和余额。

4. 在 `route.tsx` 里把 `/` 路由指向它。

跑起来，看到工资被分到各个池子里——这就有了 vibecoding 的第一个回馈。剩下的模块在这个骨架上逐个加。
