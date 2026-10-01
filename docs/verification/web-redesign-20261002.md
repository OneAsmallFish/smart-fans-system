# Web 控制台现代化重构验收记录（2026-10-02）

> 范围：frontend 全量重构（i18n / 设计 token / 风扇交互 / 真实历史）+ backend 小改（曲线回读缓存、/health mqtt、历史环形缓冲）。
> 设计参照：THRM（TIANLI0/BS2PRO-Controller）glacier 主题与曲线交互，静态取证见会话记录。

## 交付内容

| 项 | 说明 |
|---|---|
| i18n | react-i18next，zh-CN（默认）/ en-US 双语，侧栏切换，localStorage 持久化，`<html lang>` 同步；全站零硬编码文案 |
| 设计系统 | Tailwind CSS 4 + CSS 变量双基底（暗默认/亮可切）、玻璃卡片、HUD 取景框、蓝图网格背景、图表专用 token、`prefers-reduced-motion` |
| 应用壳 | 左侧图标导航（窄屏收起）+ 语言/主题/链路状态；全站**单条** WebSocket（替代 5 页各建一条 + 5 份重复常量） |
| Dashboard | Hero 设备卡（在线/固件/IP/运行时长）+ SVG 环形温度仪表 + 容差窗口电压条 + 8 路风扇阵列 + 告警横幅 |
| Fans | 环形仪表卡 + **拖动实时生效**（150ms 防抖）+ 模式乐观更新（3s 防回弹）+ 挡位预设（静音/标准/强劲/全速）+ AUTO 命中解释（温度源读数 → LUT 段 → 目标 duty） |
| 曲线编辑 | 每卡独立抽屉：**自绘 SVG 拖拽点**（严格递增 clamp、线段加点、双击删点、平滑预览）+ 温度源下拉 + PID 字段说明 + **曲线预设**（localStorage，JSON 导入导出）+ 回读回显 |
| Alerts | 接通 `config/alert get` 设备规则回读、severity 过滤、相对时间 |
| Devices | 链路状态卡（后端 + MQTT Broker，`/health` 新增 mqtt 字段）、OTA 进度、重启对话框 |
| History | 后端环形缓冲真数据（2s 采样、24h 上限、≤600 点降采样）：真实时间轴、风扇筛选、双语图例、CSV 导出（7d 选项按计划移除） |
| 拆包 | vite manualChunks：主包 600kB → 139kB（radix/recharts/i18n 独立 chunk） |

## 后端变更（零固件改动）

- `GET /api/devices/:id/curve/:fanIdx` — 曲线回读缓存（设备无回读协议，缓存最近下发命令）
- `GET /api/devices/:id/history` — stub → 环形缓冲真数据（`history.ts`，HISTORY_HOURS 可配，默认 24h）
- `GET /health` 增加 `mqtt` 字段；订阅 `config/#`（alert/curve 回读）；status 捕获 `uptime_seconds`

## 验证证据

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` + `vite build`（frontend） | ✅ 通过 |
| `npm run build`（backend） | ✅ 通过 |
| 冒烟测试 `smoke_test.sh 192.168.3.131 localhost` | ✅ PASS: 25 / FAIL: 0 |
| 模拟器契约自检 `selftest.js` | ✅ PASS: 43 / FAIL: 0 |
| 端到端闭环 | ✅ 拖拽改点 → 下发 → MQTT → 模拟器回执 → F0 卡显示"当前 X°C · BME280 板载 → 目标 Y%"，duty 跟随 |
| 规则回读 | ✅ "读取设备规则" → toast 已读取，规则经 WS 应用 |
| 走查 | ✅ 6 视图 × zh/en × 暗/亮（截图见 redesign-evidence/） |

## 走查中发现并修复的问题

1. 气压单位错误（hPa 被再除以 100 显示 10.1 hPa）→ 修正为原值 hPa
2. `.hud{position:relative}` 定义在 utilities 之后覆盖对话框 `fixed` → 移入 `@layer components`
3. CUA 合成事件只含 mouse 时拖拽失效 → CurveCanvas 增加 mouse 事件兜底

## 走查中确认的环境现象（非缺陷）

- 契约自检首轮 3-5 项失败：演示模拟器与自检实例同用 `esp32-sim0001` 互发状态污染断言；停掉演示实例后 43/0
- IAB 浏览器在超高视口/fullPage 截图下的画面重影为截图合成残影（DOM 数量核验正常）

## 本轮不做（维持规划）

前端 WS 收口（F6：`ws://:3001` → nginx `/ws` + wss）、OTA 本地文件上传、告警持久化、固件侧曲线回读/共振避让/学习型控温。

**截图证据**：`redesign-evidence/`（6 张：暗色中文 Dashboard/Fans/曲线拖拽/Alerts/Devices + 亮色英文 Dashboard）
