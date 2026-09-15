# 智能巡检平台重构方案 — 信息架构 / WVP 对接 / 新增后端设计

> 目标：用 React 18 + Semi Design 全新前端，**完美替换**「南水机器狗巡检平台」，前端接入现有 WVP-GB28181-pro（Docker 部署），并在 WVP Java 后端中新增「巡检 / 机器人 / 无人机 / AI」模块；Python `yolo_service.py` 保留为纯推理微服务。
>
> 参考素材：`doc/智能巡检重构/截图/`（30 张截图）
> WVP 源码（也是本项目工作根目录）：`D:\Docker Project\wvp-GB28181-pro`（v2.7.4，Java 21 / Spring Boot 3.4.4，Vue2 + ElementUI）
> 新前端：`D:\Docker Project\wvp-GB28181-pro\web-react\`（新建，构建产物 `../src/main/resources/static`）
> 已确定决策：① 新前端放 wvp 仓库内 `web-react/`；② 新后端并入 WVP Java 工程，Python 只做推理；③ 机器狗协议无现成文档，做「多协议可选 + 厂商预设 + 通用模板」；④ 声纹监测 / 环境在线监测 / 系统自检状态 **直接砍掉不做**。

---

## 一、旧平台信息架构盘点（来自 30 张截图）

### 顶部栏
- 左：Logo + 「机器狗巡检系统」
- 中：`信息总览` | `实时监控` | `巡视管理`
- 右：语言切换、深色模式、通知铃铛、用户 `GaoZhenMing`（下拉）

### 路由 / 页面清单（旧平台实际 URL）
| 顶部 | 左侧子菜单 | 页面 | 旧 URL |
|---|---|---|---|
| 信息总览 | — | 综合看板 | `/dashboard/overview` |
| 实时监控 | 机器人监控 | 机器人实时画面与控制 | `/robot-monitor/index` |
| 实时监控 | 视频监控 | 视频九宫格 + 云台 + 预置位 | `/camera/monitor` |
| 实时监控 | 无人机监控 | 无人机监控 | `/drone/...`（截图未展开） |
| 实时监控 | 录像回放 | 回放 + 时间轴 + 下载 | `/video-replay/index` |
| 实时监控 | 声纹监测 | 占位空页 | `/voice-monitor/index` |
| 实时监控 | 环境在线监测 | 微气象/在线监测/环境 | `/environment/index` |
| 实时监控 | 系统自检状态 | 网络拓扑/主机/边缘节点/系统告警/站端装置自检 | `/system/index` |
| 巡视管理 | 任务管理→巡视任务 | 巡视任务展示（日历） | `/task/patrol/calendar` |
| 巡视管理 | 任务管理→巡视任务 | 巡视任务设置（列表） | `/task/patrol/project` |
| 巡视管理 | 任务管理→巡视任务 | 新建任务（基本信息 + 巡视内容点位） | `/task/patrol/project/creation` |
| 巡视管理 | 任务管理 | 静默任务 | `/task/silence` |
| 巡视管理 | 任务管理 | 检修区域设置 | `/task/overhaul` |
| 巡视管理 | 任务管理→联动任务 | 联动点位 | `/task/linkage/device` |
| 巡视管理 | 任务管理→联动任务 | 联动任务结果 | `/task/linkage/result` |
| 巡视管理 | 巡视结果 | 结果浏览与归档 | `/result/list` |
| 巡视管理 | 巡视结果 | 识别异常点位 | `/result/abnormal` |
| 巡视管理 | 巡视结果 | 任务执行 | `/result/executing` |
| 巡视管理 | 巡视结果 | 结果查询（含历史图像） | `/result/result/query` |
| 巡视管理 | 巡视结果 | 任务报告 | `/result/report` |
| 巡视管理 | 告警管理 | 巡视结果告警确认 | `/alarm/result` |
| 巡视管理 | 告警管理 | 静默监视告警确认 | `/alarm/monitor` |
| 巡视管理 | 告警管理 | 对比分析告警确认 | `/alarm/analysis` |
| 巡视管理 | 告警管理 | 巡视设备告警确认 | `/alarm/device` |
| 巡视管理 | 查询统计 | 可靠性分析统计 | `/statistics/reliability` |
| 巡视管理 | 查询统计 | 任务执行情况统计 | `/statistics/execution` |
| 巡视管理 | 查询统计→数据分析 | 历史曲线查询 | `/statistics/analysis/history` |
| 巡视管理 | 查询统计→数据分析 | 常规曲线分析 | `/statistics/analysis/convention` |
| 巡视管理 | 查询统计→数据分析 | 自定义曲线分析 | `/statistics/analysis/definition` |

### 关键业务细节（从截图提取，重构时必须保留）
- **新建任务**：基本信息（任务名称 0/50、任务类型：例行巡视、任务优先级：1级、编制人）+ 任务时间（+增加时间方案）+ 巡视内容（左侧点位树：1级(默认)/主厂房B2/副厂房B1层/副厂房3层/5#货梯/…；右侧点位表格列：编号、区域、间隔、设备、部件、名称、采集设备、操作；提示「请在左侧选择电力点位增加」）。
- **任务列表**列：编号、任务名称、巡视类型、编制人、优先级、创建时间、状态（已启用/未启用）、操作（立即执行/立即启用、详情、更多）。
- **最新巡视结果**列：点位名称、巡视结果（分析中…）、识别类型（指示灯/闪烁灯、空开状态）、异常原因、流程记录（等待摄像机上报结果）、误识别原因。
- **识别异常点位**列：点位名称、巡视结果、审核结果、识别类型、识别子类、点位状态（待人工确认/正常/异常）、操作（详情）。
- **告警确认**列：点位名称、告警时间、告警描述（联合告警/算法识别异常/…）、告警等级（严重）、操作（监控画面、复归、详情、告警免打扰）；顶部有「批量复归」、告警信息数量。
- **巡视设备告警**：告警内容（机器人开始执行巡检任务 / 上桩成功 / 本次巡检任务已完成 / 未重定位）、告警时间。
- **任务报告**列：报告名称、任务完成时间、巡视类型、点位总数、异常点位总数、审核人、审核时间、操作（详情）；查询条件含 设备区域/设备间隔/设备类型；右上「导出报告」。
- **可靠性分析统计**卡：正常巡检天数、累计连续正常运行天数、录像完整率、累计离线次数总和、累计在线时长总和、投运期间累计自检结果正常天数、出勤率；下方「巡视结果统计查询」5 个环形指标：巡视点位漏检率、巡视告警人工审核完成率、巡视告警准确率、巡视结果人工审核完成率、任务执行闭环率。
- **机器人监控**：三画面（可见光 / 红外 / 点云地图）+ 控制权开关 + 状态栏（巡视状态/模式/云台通信/导航通信/底盘通信/底盘在桩状态）+ 机器人车体方向控制（当前步态：行走、感知楼梯、强化学习）+ 机器人云台 + 可见光摄像机（倍率/聚焦）+ 一键操作（定点导航/取消导航/地图同步/一键返航）+ 运行数据（步态、行驶里程、电池电量、水平速度、充电电流）。
- **信息总览**：变电站概况（摄像机/无人机/机器人/声纹 数量 + 温度/湿度/气压/风速）、地图（2D电气图 + 图层 可见光/+2）、设备工况（摄像机/机器人/无人机/声纹 tabs；总数 + 枪机/球机/云台/深度/工业 + 可见光/红外光/双光/离线/在线环形）、巡视统计（状态统计/类型统计、本周、今日巡视 0/3 已完成/总任务、按天柱状 进行中/已完成/暂停中/已停止/未完成/有异常）、告警统计（近3/6/12个月；一般告警/严重告警/危险告警）、告警记录、缺陷统计（点位/结果/采集时间/转缺陷时间）。

---

## 二、新信息架构（顶部栏 + 设置承载低频配置）

### 顶部栏
```
[智能巡检]  ← 点击进入 信息总览        实时监控 | 巡视管理        通知🔔  用户▾  设置⚙
   左：品牌/入口                          中：主功能（2 个，可扩展）        右：通知 / 用户 / 设置
```
- **左**：`智能巡检` 文字 Logo，点击 → `/overview`（信息总览）。
- **中**：`实时监控` `/monitor`、`巡视管理` `/patrol`。**现阶段就放这两个**（对齐旧平台）。
- **右**：`通知`（铃铛 + 未读角标，点开抽屉/面板）、`用户信息`（头像下拉：个人信息、修改密码、退出登录）、`设置`（齿轮 → `/settings`，进入后顶部栏右侧高亮「设置」，页面切换为设置控制台）。

### 关于「顶部栏中间要不要新增模块」——结论：**现阶段不需要新增**
新增的机器狗 / 无人机 / AI 能力全部有归属，不必占用顶部栏：
- 机器人监控、无人机监控 → 归入 **实时监控**（与视频监控、录像回放同级）。
- 巡检任务、结果、告警、统计 → 归入 **巡视管理**。
- 算法管理 / 模型管理 / 提示词 / 知识库 / 协议管理 / 机器人设备管理 → 全部归入 **设置**（低频配置）。

**预留升级规则**（写进代码注释即可，不实现）：当出现以下任一情况，再把对应能力提升为顶部栏第三项：
1. 告警量大、需要独立的 `告警中心`（跨巡视/设备/机器人告警统一处置）；
2. 需要独立的 `AI 分析中心`（模型/算法/推理监控与调优）；
3. 机器人/无人机设备规模大，需要独立的 `装备管理`。

### 页面树（新）
```
/overview                          信息总览（看板，无左侧栏）
/monitor                           实时监控（左侧栏）
  /monitor/robot                   机器人监控   ← 新增（协议适配 + 视频）
  /monitor/drone                   无人机监控   ← 新增（协议适配 + 视频）
  /monitor/video                   视频监控     ← WVP 直连
  /monitor/playback                录像回放     ← WVP 直连
/patrol                            巡视管理（左侧栏）
  /patrol/task                     巡检任务（列表 + 新建/编辑 + 一键执行）
  /patrol/execution                任务执行（实时进度）
  /patrol/result                   巡检结果（浏览归档 / 异常点位 / 结果查询）
  /patrol/report                   任务报告（导出）
  /patrol/alarm                    告警管理（巡视告警 / 设备告警）
  /patrol/stats                    查询统计（可靠性 / 任务执行情况 / 曲线分析）
/settings                          设置（左侧栏，合并为 8 个分组，组内用 Tab）
  # 1. 账号与安全（合并 用户+角色权限+审计+APIKey）
  /settings/security               账号与安全  [用户管理 | 角色与权限 | 操作审计 | API Key]
  # 2. 设备接入（合并 国标+部标+通道+推流+拉流）
  /settings/access                 设备接入    [国标设备 | 部标设备 | 通道管理 | 推流列表 | 拉流代理]
  # 3. 媒体与级联（合并 媒体节点+级联+录制计划）
  /settings/media                  媒体与级联  [媒体节点 | 国标级联 | 录制计划]
  # 4. 组织与地图（合并 区划+分组+地图）
  /settings/org                    组织与地图  [行政区划 | 业务分组 | 电子地图]
  # 5. 机器人与装备（合并 装备+协议+点位航线）
  /settings/asset                  机器人与装备 [装备台账 | 协议管理 | 点位与航线]
  # 6. 智能算法（合并 算法+模型+提示词+知识库+识别方案）
  /settings/ai                     智能算法    [算法 | 模型 | 提示词 | 知识库 | 识别方案]
  # 7. 巡视配置（合并 检修区域+字典+告警规则+通知）
  /settings/patrol                 巡视配置    [检修区域 | 字典 | 告警规则与免打扰 | 通知设置]
  # 8. 系统（合并 平台信息+日志）
  /settings/system                 系统        [平台信息 | 运行日志]
/login                            登录
```

### 巡检「一键配置多个点位」的核心设计
把 **算法(YOLO) + VLM 模型 + 提示词 + 知识库** 打包成一个可复用实体 **「识别方案」(`patrol_identify_scheme`)**：
- 在 `设置 → 识别方案模板` 里创建/维护方案（例如「指针电表识别方案」「指示灯状态识别方案」「空开状态识别方案」）。
- 新建巡检任务时，选中一批点位 → `批量套用识别方案` → 所有点位一键写入同一方案；个别点位可单独覆盖（点位级 `scheme_id` 优先于任务级）。
- 点位识别配置项：`采集方式(拍照/录像)` + `识别方案` + `ROI 区域` + `置信度阈值` + `风险等级`。
- 执行时按「点位级覆盖 > 任务级默认」解析，满足「一般都差不多，一键配置多个，个别特殊单独改」。

---

## 三、WVP 现有能力对接矩阵

> 鉴权：JWT，请求头 **`access-token`**；登录 `POST /api/user/login`（`username` + **32 位 MD5 密码**）。
> 部署：nginx 8080（宿主 `9080`）反代 `/api/`、`/record_proxy/`、`/live/`、`/rtp/`、`/mp4_record/`、`/zlm_snap`；WVP 应用端口 `18978`；ZLMediaKit HTTP/WS `8081`。
> 前端 `vite` 生产 `baseURL=''`（同源）。

### A. 可直接对接（WVP 已有接口，只做前端）

| 新页面 | 能力 | WVP 接口 |
|---|---|---|
| 视频监控 | 通道树（区划/分组） | `GET /api/region/tree/list`、`/api/group/tree/list`、`GET /api/common/channel/list`、`GET /api/common/channel/one` |
| 视频监控 | 开始/停止直播 | `GET /api/play/start/{deviceId}/{channelId}`、`GET /api/play/stop/{deviceId}/{channelId}` |
| 视频监控 | 播放地址（flv/ws-flv/hls/rtc） | `GET /api/media/getPlayUrl`、`GET /api/media/stream_info_by_app_and_stream` |
| 视频监控 | 云台控制 | `GET /api/front-end/ptz/{deviceId}/{channelId}`、`/api/common/channel/front-end/ptz`、`/fi/iris`、`/fi/focus` |
| 视频监控 | 预置位 | `/api/front-end/preset/query|add|call|delete` |
| 视频监控 | 巡航/扫描/雨刷/辅助 | `/api/front-end/cruise/*`、`/scan/*`、`/wiper`、`/auxiliary` |
| 视频监控 | 截图 | `GET /api/play/snap`、`GET /api/device/query/snap/{deviceId}/{channelId}` |
| 录像回放 | 设备录像查询/下载 | `GET /api/gb_record/query/{deviceId}/{channelId}`、`/download/start|stop|progress` |
| 录像回放 | 回放控制 | `/api/playback/start|stop|pause|resume|seek|speed` |
| 录像回放 | 云端录像 | `GET /api/cloud/record/list|date/list`、`/play/path`、`/download/zip` |
| 录像回放 | 录制计划 | `/api/record/plan/*` |
| 设置-国标设备 | 设备 CRUD/同步/状态 | `/api/device/query/devices`、`/device/add`、`/device/update`、`/devices/{id}/delete`、`/sync`、`/status`、`/info` |
| 设置-通道 | 通道 CRUD/重置/批量 | `/api/common/channel/add|update|reset|list`、`/region/*`、`/group/*` |
| 设置-推拉流 | 推流 / 拉流代理 | `/api/push/*`、`/api/proxy/*` |
| 设置-媒体节点 | 节点 CRUD/在线/检测 | `/api/server/media_server/*`、`/api/server/system/info`、`/version`、`/resource/info` |
| 设置-国标级联 | 级联平台 CRUD/共享通道 | `/api/platform/*` |
| 设置-组织结构 | 行政区划 / 业务分组 | `/api/region/*`、`/api/group/*` |
| 设置-用户权限 | 用户 / 角色 / API Key | `/api/user/*`、`/api/role/*`、`/api/userApiKey/*` |
| 设置-日志 | 历史 / 实时日志 | `GET /api/log/list`、`GET /api/log/file/{fileName}`、WS `/channel/log` |
| 设置-地图 | 电子地图配置 / 矢量瓦片 | `/api/server/map/config`、`/api/common/channel/map/*` |
| 设置-部标设备 | JT1078 终端/通道/参数 | `/api/jt1078/*`、`/api/jt1078/terminal/*` |
| 告警（设备侧） | 设备告警列表/删除/截图 | `GET /api/alarm/list`、`DELETE /api/alarm/delete`、`GET /api/alarm/snap/{id}` |
| 位置 | 移动位置/轨迹 | `GET /api/position/history/{deviceId}`、`/latest`、`/realtime/{deviceId}` |
| 平台信息 | 系统信息/资源 | `/api/server/system/info`、`/resource/info`、`/info`、`/version` |

### B. 需适配（WVP 有底层能力，但要包装/新增聚合接口）

| 需求 | 说明 |
|---|---|
| 信息总览看板 | WVP 无聚合接口。新增 `GET /api/patrol/overview`，聚合 WVP 设备/通道/告警统计 + 巡检结果统计。 |
| 视频监控「采集设备/业务设备」双 Tab、类型/光谱/区域筛选 | 通道信息里有 `channel_type`、`data_type` 等字段，WVP 无现成聚合筛选接口，前端按 `/api/common/channel/list` 拉全量后本地筛选，或新增 `/api/patrol/channel/filter` 聚合。 |
| 通知中心 | WVP 无站内通知。新增 `patrol_notification` 表 + 接口 + 未读数。 |
| 电子地图 2D 电气图 | WVP 地图基于 OpenLayers + 矢量瓦片，React 侧用 `ol` 复用瓦片接口 `/api/common/channel/map/tile/{z}/{x}/{y}`。 |
| 任务级联落库 | 巡检任务/结果/告警全部新增表，WVP 侧只借用设备/通道/媒体/告警能力。 |

### C. 完全新增（WVP 没有，必须新做前后端）

| 模块 | 说明 |
|---|---|
| 机器人 / 无人机设备管理 | 注册、在线状态、厂商型号、绑定协议模板、能力集 |
| 协议管理 | 多协议模板 + 厂商预设 + 通用模板（见第四节） |
| 点位 / 航线预设 | 定点拍照点位、地图坐标、绑定采集通道 |
| 算法管理 | YOLO 模型上传/新建/版本/标签（对接 `yolo_service.py`） |
| 模型管理 | VLM 接入（provider/base_url/api_key/model/protocol/参数） |
| 提示词管理 | 场景化提示词模板 + 变量 + 版本 |
| 知识库管理 | 文档/标准值，供 VLM 检索纠偏 |
| 识别方案模板 | 算法+模型+提示词+知识库 组合，一键复用 |
| 巡检任务 | 任务编排、时间方案、优先级、立即执行、启停 |
| 任务下发与执行编排 | 调协议适配器下发任务；接收回传媒体；编排 YOLO→VLM→判定→告警 |
| 巡检结果 / 报告 | 点位结果、异常点位、结果查询、报告导出 |
| 巡检告警 | 巡视告警确认/复归/免打扰、设备告警（机器人事件） |
| 查询统计 | 可靠性、任务执行情况、曲线分析 |
| 检修区域 | 抑制检修期告警 |
| 通知 | 站内通知 + 未读 |

---

## 四、协议管理设计（多协议可选 + 厂商预设 + 通用模板）

### 4.1 分层
```
巡检任务编排 / 指令总线 CommandBus
        │  统一指令信封 + 事件
ProtocolAdapterRegistry  ── Device → ProtocolTemplate → Adapter
        │
HttpAdapter | MqttAdapter | DdsAdapter | GrpcAdapter | TcpAdapter
        └─ MediaChannel: RtspOnvif | Gb28181 | HttpFile | S3
```
**核心抽象：一个设备 = 一组通道(Channel)，每个通道可用不同协议。**
- 大疆机场 = MQTT(指令/遥测) + GB28181/RTMP(视频) + HTTPS/S3(媒体) + HTTP(WPML 航线)。
- 云深处 X30 = HTTP(指令) + RocketMQ(事件) + RTSP(相机)。
- 宇树 Go2 = DDS(控制/抓拍) + WebRTC(直播，非官方)。

### 4.2 统一指令集（能力导向，与厂商无关）
`register/heartbeat`、`status`、`startTask`、`pauseTask`、`resumeTask`、`stopTask`、`gotoWaypoint`、`capturePhoto`、`startVideo`、`stopVideo`、`setPtz`、`returnHome`、`getMediaList`、`subscribeEvents`。

**能力协商**：适配器声明 `capabilities()`，编排器下发前校验；不支持的能力（如 Go2 的 `gotoWaypoint`）直接禁用/提示，而不是报错。

### 4.3 厂商预设（建议首发 4 个）
| 预设 | 协议 | 鉴权 | 能力 | 难度 |
|---|---|---|---|---|
| **大疆 DJI 上云 API（Dock 2）** | MQTT 5.0 + HTTPS + WS + S3 | MQTT 账号密码 / HTTPS `X-Auth-Token` | 航线任务 prepare/execute/pause/recovery/stop、`live_start_push`(url_type 0 Agora/1 RTMP/3 GB28181/4 WebRTC)、媒体经 S3 回传、`return_home` | 中高 |
| **云深处 DEEP Robotics Station OpenAPI（X30/X20）** | HTTP/JSON + RocketMQ | `X-Access-Token` 或 `appKey+timestamp+nonce+sign` | `/remoteApi/issue` 下发、`/taskCtrl`(2暂停/3恢复/4停止)、`/setPosToDog` 定点、`/cameraCtrl`/`/ptzReset`、`/chargeCtrl` 回充、`/taskPointResultPage` 结果 | 低（需厂商凭据） |
| **宇树 Unitree（Go2/B2）** | DDS(CycloneDDS) | 无 | `sport.Move`(1008)/`StopMove`(1003)/`BalanceStand`(1002)、B2 `MoveToPos`(1036)/`TrajectoryFollow`(1018)、`videohub.GetImageSample` 抓拍 JPEG | 中高（需局域网 DDS 桥） |
| **波士顿动力 Spot** | gRPC/HTTP2 + TLS:443 | 用户密码换取 token + lease/E-Stop | GraphNav 导航、Autowalk、ImageService 抓图、自动回充 | 中 |
| 通用模板（随首发一起交付） | HTTP_REST / MQTT / TCP / RTSP-ONVIF / GB28181 / Modbus | 可配 | 长尾厂商（申昊/亿嘉和/国自/朗驰欣创/中信重工开诚、复亚/星逻/中科云图）**无需写代码，仅配置** | — |

> 注：申昊、亿嘉和、国自、朗驰欣创、中信重工开诚、复亚、星逻、中科云图、蔚蓝、优必选均**未发现公开 API**，属关系/NDA 门槛，用「通用模板 + 自定义二进制编解码插件」接入。
> 已核实的具体接口/主题/字段/端口见调研记录，实现时以厂商最新文档为准。

### 4.4 协议模板配置（存 `patrol_protocol_template.config_json`）
```yaml
protocolTemplate:
  id: deep-station-x30
  name: 云深处 X30 巡检
  protocolType: HTTP_REST
  capabilities: [status, startTask, pauseTask, resumeTask, stopTask,
                 gotoWaypoint, capturePhoto, setPtz, returnHome, getMediaList]
  connection: { baseUrl: "http://station.local", timeoutMs: 15000 }
  auth: { mode: APPKEY_SIGNATURE, appKeyRef: secret://deep/appKey,
          secretKeyRef: secret://deep/secretKey, signPlacement: BODY }
  endpoints:
    status:       { method: POST, path: /remoteApi/getDogStateData, readOnly: true }
    startTask:    { method: POST, path: /remoteApi/issue, idempotent: false }
    pauseTask:    { method: POST, path: /remoteApi/taskCtrl, payload: '{"command":"2"}' }
    resumeTask:   { method: POST, path: /remoteApi/taskCtrl, payload: '{"command":"3"}' }
    stopTask:     { method: POST, path: /remoteApi/taskCtrl, payload: '{"command":"4"}' }
    gotoWaypoint: { method: POST, path: /remoteApi/setPosToDog,
                    payload: '{"dogCode":"${deviceId}","edgeCode":"${p.edgeCode}","x":"${p.x}","y":"${p.y}","z":"${p.z}"}' }
    returnHome:   { method: POST, path: /remoteApi/chargeCtrl }
    setPtz:       { method: POST, path: /remoteApi/cameraCtrl }
  events:
    transport: ROCKETMQ
    topic: httpRemote
    tags: { uploadHttpRemoteTaskStatus: TASK_PROGRESS,
            uploadHttpRemoteResult: MEDIA_READY,
            uploadHttpRemoteAlarm: DEVICE_ALARM,
            uploadHttpRemoteRoute: ROUTE_UPDATE }
  media: { video: { protocol: RTSP }, files: { protocol: PULL } }
```
要点：
- **密钥用 `secret://` 引用，不落明文**；模板带版本号，设备锁定版本。
- **非幂等指令默认不重试**；超时返回 `resultUnknown`，必须回查状态（借鉴云深处语义）。
- 支持 **HTTP 模板 / MQTT 模板 / TCP 模板** 三种「零代码」适配器覆盖长尾厂商。

### 4.5 机器人/无人机对接的媒体回传（三选一，做成可配）
1. **推模式**：设备把照片 POST 到平台 `POST /api/patrol/ingest/media`（multipart/JSON base64）；
2. **拉模式**：平台按 `getMediaList` 从设备/对象存储拉取；
3. **共享存储**：媒体落到 S3/MinIO/FTP，平台按 `file_upload_callback`/清单读取。

---

## 五、新增后端设计（并入 WVP Java 工程）

### 5.1 包结构（新增，不动 WVP 原有代码）
```
com.genersoft.iot.vmp.patrol
├── controller    PatrolTaskController / PatrolResultController / PatrolAlarmController
│                 RobotDeviceController / ProtocolTemplateController / WaypointController
│                 AlgorithmController / VlmModelController / PromptController
│                 KnowledgeController / IdentifySchemeController / PatrolStatsController
│                 PatrolOverviewController / NotificationController / MediaIngestController
├── service       (接口 + impl)
├── adapter       协议适配器：ProtocolAdapter SPI、Registry、Http/Mqtt/Tcp 通用适配器
│                 presets: DjiCloudAdapter / DeepRoboticsAdapter / UnitreeAdapter / SpotAdapter
├── orchestrator  任务编排（下发→采集→YOLO→VLM→判定→告警）
├── inference     YoloClient（调 yolo_service.py）、VlmClient（多厂商）、KbRetriever（知识库检索）
├── dao / mapper  MyBatis Mapper
└── bean / dto / enums
```

### 5.2 新增数据库表（MySQL，前缀 `patrol_`）
| 表 | 关键字段 | 用途 |
|---|---|---|
| `patrol_protocol_template` | id, name, protocol_type, vendor, config_json, capabilities_json, version, enabled | 协议模板 |
| `patrol_robot_device` | id, name, type(DOG/DRONE), vendor, model, template_id, connection_json, status, last_heartbeat, capabilities_json | 机器人/无人机 |
| `patrol_waypoint` | id, name, area, type, map_x/y/z, edge_code, capture_channel_id, maintenance_area_id, sort | 点位 |
| `patrol_algo` | id, name, engine(YOLO), file_path, labels_json, version, status | 算法(YOLO) |
| `patrol_vlm_model` | id, name, provider, base_url, api_key_enc, model, protocol, params_json, status | VLM 模型 |
| `patrol_prompt` | id, name, scene, content, variables_json, version | 提示词 |
| `patrol_knowledge_base` | id, name, description | 知识库 |
| `patrol_knowledge_doc` | id, kb_id, title, content, embedding_ref | 知识库文档 |
| `patrol_identify_scheme` | id, name, algo_id, vlm_model_id, prompt_id, kb_ids_json, threshold, roi_json, risk_level | **识别方案（一键复用）** |
| `patrol_task` | id, name, type(ROUTINE/SILENT/LINKAGE), robot_device_id, priority, time_plans_json, default_scheme_id, status, created_by | 任务 |
| `patrol_task_point` | id, task_id, waypoint_id, seq, capture_mode, scheme_id, params_json | 任务点位（可覆盖方案） |
| `patrol_task_execution` | id, task_id, device_id, status, progress, started_at, finished_at, trigger_type, total_points, abnormal_points | 执行实例 |
| `patrol_point_result` | id, execution_id, task_point_id, waypoint_id, media_id, yolo_json, vlm_json, result(NORMAL/ABNORMAL/ANALYZING), identify_type, identify_sub_type, defect_type, confidence, anomaly_reason, review_status, reviewed_by | 点位结果 |
| `patrol_media` | id, execution_id, point_result_id, type(PHOTO/VIDEO), path, url, size, captured_at | 媒体 |
| `patrol_alarm` | id, point_result_id, source(INSPECT/DEVICE/COMPARE), level(GENERAL/SERIOUS/DANGER), description, status, confirmed, recovered_at, dispatch_json, silenced, alarm_time | 巡检告警 |
| `patrol_maintenance_area` | id, name, area_json, start_at, end_at, status | 检修区域 |
| `patrol_notification` | id, user_id, title, content, type, biz_id, is_read, created_at | 通知 |
| `patrol_dict` | id, type, code, label, sort, enabled | 字典（识别类型/点位类型/告警等级） |
| `patrol_device_profile` | id, vendor, model, asset_type, capabilities_json, default_template_id, default_capture_json, enabled | 装备档案（型号未定先占位，见 9.1） |
| `patrol_analyzer` | id, name, modality, engine, endpoint, params_json, enabled | 分析器注册（多模态可插，见 9.1） |
| `patrol_point_reading` | id, point_result_id, reading_key, value_num, value_text, unit, confidence | 结构化读数（曲线分析数据源，见 9.1） |
| `patrol_role_permission` | id, role_id, module, actions_json | 模块+操作权限（见 11.3） |
| `patrol_role_data_scope` | id, role_id, scope_type(ALL/REGION/GROUP/CHANNEL), scope_json | 数据权限（见 11.3） |
| `patrol_role_channel_permission` | id, role_id, channel_id, channel_group_id, funcs_json | 摄像头功能级权限（view/ptz/playback/download/snapshot/talk/record） |
| `patrol_uri_permission` | id, uri_pattern, http_method, module, action, channel_param | WVP 接口 URI→权限映射（保护 WVP 接口，见 11.3） |
| `patrol_audit_log` | id, user_id, username, module, action, target_type, target_id, target_name, http_method, uri, params_json, ip, user_agent, result, error_msg, duration_ms, created_at | 操作审计（见 11.4） |

### 5.3 新增接口（统一前缀 `/api/patrol`）
- 任务：`GET /task/list`、`POST /task/save`、`POST /task/delete`、`POST /task/{id}/enable|disable`、`POST /task/{id}/execute`、`POST /task/{id}/pause|resume|stop`、`GET /task/{id}`、`GET /task/executing/list`、`GET /task/execution/{execId}/progress`
- 结果：`GET /result/list`、`GET /result/abnormal`、`GET /result/query`、`GET /result/{id}`、`GET /result/{id}/images`、`POST /result/{id}/review`
- 报告：`GET /report/list`、`GET /report/{id}`、`POST /report/export`
- 告警：`GET /alarm/list`、`POST /alarm/confirm`、`POST /alarm/recover`（批量复归）、`POST /alarm/silence`、`GET /alarm/device/list`
- 统计：`GET /stats/reliability`、`GET /stats/execution`、`GET /stats/curve/history|convention|definition`、`GET /overview`
- 机器人/协议/点位：`/robot/*`、`/protocol/*`、`/waypoint/*`
- AI：`/algorithm/*`（含模型上传）、`/model/*`、`/prompt/*`、`/knowledge/*`、`/scheme/*`
- 媒体回传：`POST /ingest/media`、`GET /media/{id}`
- 通知：`GET /notification/list`、`POST /notification/read`、`GET /notification/unread/count`
- 实时推送：WebSocket `/api/patrol/ws`（任务进度、点位结果、告警）

### 5.4 推理编排流程（核心）
```
创建/启动任务
  → 协议适配器 startTask 下发机器狗（含点位/动作）
  → 机器狗执行、定点拍照、回传媒体（推/拉/共享存储）
  → MediaIngestService 存图 → 建 patrol_point_result(status=分析中)
  → YoloClient 调 http://yolo_service:8999/v1/detect|ocr_detect  → yolo_json
  → 判定：命中/置信度≥阈值/VLM复核开关 → KbRetriever 检索知识库上下文
  → VlmClient 调 VLM(chat_completions/responses/anthropic)（提示词 + 知识上下文 + 图片）→ vlm_json
  → 融合判定 result（正常/异常）+ 识别类型/子类/缺陷类型/异常原因
  → 异常 → 建 patrol_alarm + patrol_notification + WS 推送
  → 任务收尾 → 汇总点位结果、生成报告数据
```
- `yolo_service.py` 已是 FastAPI，接口 `GET /health`、`POST /v1/detect`、`POST /v1/ocr_detect`；**容器化后由 Java 以配置项 `patrol.inference.yolo-url` 调用**（不要写死 `127.0.0.1`）。
- VLM 走 nginx 已加的厂商代理（`/sensenova_proxy` 等）或 Java 直连。

### 5.5 WVP 侧需要改动的文件（最小改动）
1. `docker/nginx/Dockerfile`：构建目录 `./web` → `./web-react`（输出仍 `../src/main/resources/static` → `/opt/dist`）。
2. `docker/nginx/templates/nginx.conf.template`：新增 `location /api/patrol/ws`（WS 升级）；其余 `/api/`、`/live/`、`/zlm_snap` 已具备。
3. `docker/docker-compose.yml`：新增 `yolo-service` 容器（Python）；如需 MQTT/对象存储再加 `emqx`、`minio`（按协议预设启用）。
4. `docker/wvp/wvp/application-docker.yml`：新增 `patrol.*` 配置（yolo-url、vlm 超时、媒体存储路径、协议凭据引用）。
5. `数据库/`：新增 `patrol_*.sql` 初始化 + 升级脚本。

---

## 六、新前端工程（web-react）技术方案

```
web-react/
├── package.json        react18 + typescript + vite5 + @douyinfe/semi-ui + semi-icons
│                       react-router-dom6 + axios + zustand + @tanstack/react-query
│                       echarts + echarts-for-react + mpegts.js + dayjs
├── vite.config.ts      base '/', server.proxy(/api→18978, /live|/zlm_snap→8081 ws)
│                       build.outDir '../src/main/resources/static'
├── index.html
└── src/
    ├── main.tsx / App.tsx / router.tsx
    ├── api/            http.ts(access-token 拦截) + 各业务模块
    ├── layout/         AppLayout(顶部栏) / SideNav / SettingsLayout / NotificationPanel
    ├── pages/
    │   ├── overview/           信息总览看板
    │   ├── monitor/            robot / drone / video / playback
    │   ├── patrol/             task / task-edit / execution / result / report / alarm / stats
    │   ├── settings/           按第二节页面树
    │   └── login/
    ├── components/     VideoPlayer(mpegts/Jessibuca) / ChannelTree / PtzPanel
    │                   SchemeForm / ProtocolForm / ModelForm / PromptEditor
    │                   KnowledgeEditor / AlgorithmUpload / ResultTable / AlarmTable / StatCard
    ├── store/          auth(用户/token) / ui(主题/侧栏) / notify
    └── types/          与后端 DTO 对齐
```
要点：
- **UI 全部用 Semi Design**，统一 `ConfigProvider` + 深色/浅色主题（对齐旧平台深色风格，默认深色）。
- 播放器：WVP 返回 `ws_flv`，推荐 `mpegts.js`（flv.js 维护版，支持 WS-FLV）；H.265 通道回退 `Jessibuca`（WASM，包一层 React 组件）；`rtc` 字段可走 WebRTC。
- 登录：`POST /api/user/login`（密码 MD5），token 存 `localStorage`，请求头 `access-token`；401 统一跳登录。
- Token 失效、无权限、空数据统一用 Semi `Empty/Toast/Modal`。
- 组件复用：`ChannelTree`（区划/分组切换）、`VideoPlayer`、`PtzPanel`、`StatCard`、`ResultTable`、`SchemeForm` 是高频复用件，先做。

---

## 七、实施阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 骨架 | `web-react` 工程 + Semi 主题 + 顶部栏/侧栏/路由 + 登录鉴权 + 请求层 | 能登录，顶部栏三项切换正常，设置页可达 |
| P1 WVP 直连 | 视频监控、录像回放、设置下全部 WVP 直连页（设备接入/媒体与级联/组织与地图/系统） | 直播能播（ws-flv）、云台/预置位可用、回放可查可下、设备/通道 CRUD 可用 |
| **P1.5 安全底座（必做，不可后置）** | ① 修复 token 续签（第十节）② 自建 RBAC（模块/操作/数据/摄像头功能级，第十一节）③ 操作审计 ④ 前端路由守卫 + 按钮级权限 | `login-timeout=5` 分钟持续操作不掉线；不同角色看到的菜单/按钮/通道不同；越权调接口返回 403；审计可查到云台/下载/改配置等操作 |
| P2 新增后端骨架 | `patrol` 包 + 全部表 + CRUD 接口 + 鉴权接入 + WS | 表建好，接口可从 Knife4j 调通，权限与审计生效 |
| P3 AI 配置 | 算法管理(上传/版本/标签) + 模型管理(连通性测试) + 提示词 + 知识库 + 识别方案 | 能上传 YOLO 模型、能配 VLM 并联通、能建方案 |
| P4 机器人与协议 | 装备档案 + 机器人/无人机设备管理 + 协议管理 + 4 预设 + 3 通用模板 + 点位/航线 | 能注册设备（含型号未定占位）、配协议、测连通、下发一条指令 |
| P5 任务闭环 | 任务编排(一键套用方案) + 下发 + 媒体回传 + YOLO→VLM 判定 + 结果/告警 + 进度推送 | 端到端：下发任务→回传照片→出识别结果→异常产生告警 |
| P6 统计与看板 | 信息总览聚合 + 可靠性/任务执行统计 + 读数与曲线 + 报告导出 + 通知中心 | 看板数据正确，报告可导出，读数可入曲线 |
| P7 切换上线 | nginx/Dockerfile 切到 web-react，部署验证，旧 Vue 目录移除 | 访问 9080 完全由新 UI 承载，旧平台功能全覆盖（砍掉与后置项除外） |

> 说明：P1.5 之所以不可后置，是因为权限与审计会渗透到所有业务接口和页面；等 P5 做完再补，等于全部返工。先建「认证→鉴权→审计」的横切骨架，后续每个新接口自动受控。

**全量替换判定清单**（逐条对照 30 张截图）：视频监控 / 录像回放 / 机器人监控 / 无人机监控 / 信息总览 / 巡检任务(展示+设置+新建) / 静默任务 / 检修区域 / 联动任务 / 结果浏览归档 / 识别异常点位 / 任务执行 / 结果查询 / 任务报告 / 巡视结果告警 / 静默监视告警 / 对比分析告警 / 巡视设备告警 / 可靠性统计 / 任务执行情况统计 / 曲线分析（历史/常规/自定义）。
**明确不做**：声纹监测、环境在线监测、系统自检状态。

---

## 八、风险与注意
1. **协议适配无厂商文档**：申昊/亿嘉和等未公开 API，必须用通用模板 + 自定义编解码插件，且需要客户提供凭据/网关。先做「可配置、可 Mock」。
2. **宇树 Go2 无官方航点导航与直播**：`gotoWaypoint` 需能力协商禁用；直播需局域网 WebRTC 桥（非官方）。
3. **非幂等指令**：任务下发/停止等严禁自动重试，超时要回查状态。
4. **大疆上云**需要 MQTT Broker + 对象存储 + WPML/KMZ 航线生成 + RTMP/GB28181 媒体服务，工作量集中在航线与媒体链路。
5. **WVP 登录密码 MD5**：新前端必须复刻 MD5 逻辑，否则登录失败。
6. **同源与 CORS**：生产走 nginx 同源；开发用 vite proxy，不要直连跨域。
7. **不要动 WVP 原有接口语义**，新增一律 `/api/patrol/**`，避免影响旧功能回滚。
8. 构建产物输出到 `src/main/resources/static` 会与旧 Vue 产物同名冲突，切换期建议先输出到独立目录由 nginx 指向，验证完成后再合并/删除旧产物。

---

## 九、多模态 / 面向对象的可扩展底座（型号未定 → 先设计好，后续增删不改核心）

> 用户诉求：型号和对接方式后面才明确，**底座要设计好，将来能删除/新增而不动核心**。
> 原则：**能力(接口)与实现(适配器)分离、数据(配置)与代码分离、模态与分析器可插拔**。

### 9.1 四层抽象（面向对象）

**① 装备抽象 `PatrolAsset`（面向对象）**
```
PatrolAsset (抽象)
├── RobotDogAsset   机器狗
├── DroneAsset      无人机
├── CameraAsset     固定摄像机（复用 WVP 通道）
├── SensorAsset     传感器（可扩展：声纹/环境，当前不做但留位）
└── GateAsset       机库/机巢
  属性：id, type, vendor, model, capabilities, protocolBindings[], mediaBindings[], status
```
- 新增型号 = 注册一个 **装备档案 `patrol_device_profile`**（JSON：厂商/型号/能力集/默认协议模板/默认点位动作），**不写代码**。
- 删除型号 = 停用档案，不影响已有数据（历史结果仍可查）。

**② 协议抽象 `ProtocolAdapter` SPI**
- 能力导向指令集（见 4.2），适配器声明 `capabilities()`。
- 已有：HTTP/MQTT/TCP 通用模板适配器 + 大疆/云深处/宇树/Spot 预设。
- 新增厂商 = 加一个协议模板（配置）或一个预设类（代码），注册进 `ProtocolAdapterRegistry` 即可。

**③ 模态抽象 `Modality` + 分析器 `Analyzer` SPI**
```
Modality: IMAGE | VIDEO | AUDIO | TEXT | POINTCLOUD | MULTI
Analyzer (接口): analyze(MediaRef media, AnalyzeConfig cfg) -> AnalysisResult
├── YoloAnalyzer      目标检测/OCR（调 yolo_service.py）
├── VlmAnalyzer       视觉语言理解（多厂商）
├── OcrAnalyzer       OCR 专用
├── AudioAnalyzer     声纹/异常音（当前不做，留接口）
├── VideoAnalyzer     时序/多帧（当前不做，留接口）
├── PointCloudAnalyzer 点云（当前不做，留接口）
└── CompositeAnalyzer 组合编排（YOLO→VLM→融合），即当前主线
```
- 一个「识别方案」= `Analyzer 链 + 参数`，不绑定具体厂商。将来加声纹/点云只是加 Analyzer 实现 + 方案里配一条链。
- `AnalysisResult` 统一结构：`{labels[], boxes[], texts[], readings[], scores[], reasoning, raw, engine, costTokens, elapsedMs}`。
- **`PointReading`（读数）**：把 VLM 读到的表计数值结构化（数值/单位/置信度），这是将来「曲线分析」的数据源——现在就把表建好，曲线页可后置。

**④ 采集抽象 `CaptureAction`**
- 点位动作 = `{mode: PHOTO|VIDEO|AUDIO|POINTCLOUD, source: ONBOARD_CAMERA|FIXED_CHANNEL|PAYLOAD, params}`。
- 所以「定点拍照」不是写死的：点位可绑机器人自带相机，也可绑固定摄像机通道，未来可加录音/点云。

### 9.2 必须有的「注册表」表（保证可增删）
| 表 | 作用 |
|---|---|
| `patrol_device_profile` | 装备档案（厂商/型号/能力/默认协议/默认动作），型号未定也能先留空占位 |
| `patrol_analyzer` | 分析器注册（type、engine、endpoint、params、enabled），多模态可插 |
| `patrol_point_reading` | 读数（结构化数值），曲线分析的数据源（表先建，页面可后置） |

### 9.3 落地要求（写进提示词）
- 所有「厂商/型号/算法引擎/模态」都通过**注册表 + 配置**表达，核心流程只依赖接口，不 `if (vendor == "unitree")`。
- 未确定的型号：先建**占位档案 + 占位协议模板（通用 HTTP 模板）**，界面可用，后续替换配置即可。
- 每个新增模块都要能「停用/删除配置而不报错」，历史数据保留。

---

## 十、WVP Token 续签缺失（已核实为真实 Bug，必须补）

### 10.1 现状（源码证据）
- `JwtUtils.EXPIRATION_TIME = 30`（分钟）常量存在，但登录实际用的是 `userSetting.getLoginTimeout()`：`UserController.login` L69 调 `JwtUtils.createToken(username)` → `createToken(username, userSetting.getLoginTimeout())` → `claims.setExpirationTimeMinutesInTheFuture(loginTimeout)`，**单位是分钟**。当前 Docker 配置 `login-timeout: 43200` = 30 天。
- `JwtUtils.verifyToken` 会算出 `EXPIRING_SOON`（剩余 < 5 分钟）状态。
- 但 `JwtAuthenticationFilter` L101-104：`case EXPIRING_SOON: // return;` 被注释掉后直接落到 `default:`，**既不续签、也不下发新 token**。
- 旧 Vue 前端 `web/src/utils/request.js` 也没有读取响应头刷新 token 的逻辑。
- **结论：token 到期即掉线，无法续签。** 目前只是把有效期拉到 30 天在掩盖问题；一旦改回默认（30 分钟）就会频繁掉线。

### 10.2 修复方案（滑动续签 + 显式刷新）
1. **后端**：`JwtAuthenticationFilter` 在 `EXPIRING_SOON` 时生成新 token，写入响应头 `access-token`（CORS 已 `exposedHeaders(access-token)`，前端可读）。为避免每请求都签发，设定续签阈值（如剩余 < 有效期 50% 或 < 30 分钟才续）。
2. **新增显式刷新接口**：`POST /api/user/refresh`（凭当前有效 token 换新 token），供前端定时/活动时调用。
3. **前端**：axios 响应拦截器读取 `access-token` 响应头，有值就更新本地 token；401 才跳登录。
4. **配置**：`login-timeout` 明确文档为「分钟」，并支持「滑动过期」开关（`user-settings.sliding-expiration: true`）。
5. **验收**：把 `login-timeout` 设为 5 分钟，持续操作 30 分钟不掉线；停止操作超过有效期后正常跳登录。

---

## 十一、权限与审计（WVP 基本没有，必须自建）

### 11.1 WVP 现状（已核实，结论：只有认证，没有授权/审计）
| 项 | 现状 | 证据 |
|---|---|---|
| 认证 | ✅ JWT（`access-token`） | `JwtAuthenticationFilter` |
| 角色 | ⚠️ 有 `wvp_user_role.authority` 字段，但**从未使用** | `RoleController` 注释原文：「权限（自行定义内容，目前未使用）」 |
| 接口鉴权 | ❌ 无。`LoginUser.getAuthorities()` 返回 `null`；过滤器塞的是 `new ArrayList<>()`；全项目 **0 个** `@PreAuthorize/@Secured` | grep 结果 |
| 数据权限 | ❌ 无（任何登录用户能看到全部区划/通道） | — |
| 视图/编辑区分 | ❌ 无（登录即可调用任意增删改、云台、回放、下载） | — |
| 前端路由/按钮权限 | ❌ 无（`permission.js` 不按角色过滤，`roles` 仅注释残留） | `web/src/permission.js` |
| 操作审计 | ❌ 无审计表。`/api/log` 只是 logback 日志文件列表，不是操作审计 | `LogController` + `数据库/` 无审计表 |
| 登录日志/在线用户 | ❌ 无 | — |

**所以：旧平台里那种「账号能看哪些模块、摄像头是编辑还是只查看」的权限，WVP 完全没有，必须自建。**

### 11.2 自建权限模型（三级 + 摄像头功能级）
```
① 模块权限（菜单可见性）     role → [信息总览, 实时监控, 巡视管理, 设置.账号与安全, ...]
② 操作权限（模块内动作）     role + module → [view, create, edit, delete, execute, export, review, confirm]
③ 数据权限（可见范围）       role → scope: ALL | 指定区划树 | 指定分组 | 指定通道列表
④ 摄像头功能级权限（重点）    role + 通道(或通道组) → [view, ptz, preset, playback, download, snapshot, talk, record]
```
- 摄像头功能级权限映射到 WVP 能力：`view`→播放、`ptz`→`/api/front-end/ptz|preset`、`playback`→`/api/playback/*`、`download`→`/api/gb_record/download/*`、`snapshot`→`/api/play/snap`、`talk`→`/talk/*`。
- 数据权限在返回通道/设备列表时按 scope 过滤（后端强制，不只前端隐藏）。

### 11.3 实现方式（不动 WVP 原有控制器）
1. **新增表**：`patrol_role_permission`（role_id, module, actions_json）、`patrol_role_data_scope`（role_id, scope_type, scope_json）、`patrol_role_channel_permission`（role_id, channel_id/channel_group_id, funcs_json）、`patrol_audit_log`。
2. **新增注解 + 拦截器**：`@RequirePermission(module="monitor.video", action="ptz", channelParam="channelId")`，对新增 `patrol` 接口生效。
3. **WVP 接口保护用「URI→权限映射表」**：`patrol_uri_permission`（uri_pattern, module, action, channelParam），用一个 `HandlerInterceptor`/Filter 统一校验，**无需给 WVP 每个 controller 加注解**，也便于回滚。
4. **登录后下发权限**：`GET /api/patrol/auth/me` 返回 `{user, roles, modules[], actions{}, dataScope, channelPermissions}`；前端据此生成菜单和按钮级 `hasPermission(code)`。
5. **前端**：路由守卫按模块权限过滤；按钮/操作按 action 权限禁用或隐藏；通道树节点按数据权限过滤。
6. **超级管理员**：保留 `admin` 全权限兜底，避免锁死。

### 11.4 审计设计
- `patrol_audit_log`：`id, user_id, username, module, action, target_type, target_id, target_name, http_method, uri, params_json(脱敏), ip, user_agent, result, error_msg, duration_ms, created_at`。
- 采集方式：AOP 注解 `@Audit(module, action)` 用于新增接口；对 WVP 关键接口（设备/通道增删改、云台、回放下载、用户与权限变更、登录登出）用拦截器按 `patrol_uri_permission` 白名单记录。
- 审计页放 `设置 → 账号与安全 → 操作审计`，支持按用户/模块/时间/结果查询与导出；登录失败、越权访问（403）也要记录。
- 保留期与脱敏：密码、token、api_key 一律不入库；可按配置清理 N 天前日志。

### 11.5 用 Spring 原生组件实现（不要自己造轮子）

WVP 是 **Spring Boot 3.4.4 + Spring Security 6**，Spring 生态的权限/审计/日志组件**都已引入但基本闲置**。实现时必须**复用 Spring 的扩展点**，而不是自造一套：

| 需求 | Spring 现成能力 | WVP 现状 | 我们怎么做 |
|---|---|---|---|
| 认证 | `AuthenticationManager` / `AuthenticationProvider` / `UserDetailsService` | ✅ 已在用（`SecurityUtils.login`） | 沿用 |
| 角色/权限载体 | `GrantedAuthority` / `UserDetails.getAuthorities()` | ❌ `LoginUser.getAuthorities()` 返回 `null`，过滤器塞空 `ArrayList` | **改造成真实加载**：把 `wvp_user_role.authority` + `patrol_role_permission` 聚合成 `GrantedAuthority`（`ROLE_xxx` / `PERM_module:action`）写入 SecurityContext |
| 方法级鉴权 | `@EnableGlobalMethodSecurity(prePostEnabled=true)` 已开；`@PreAuthorize` / `@PostAuthorize` | ⚠️ 开关开着，但**全项目 0 个注解** | 新增 `patrol` 接口用 `@PreAuthorize("hasPermission(#channelId, 'monitor.video', 'ptz')")`，配自定义 `PermissionEvaluator`（可注入数据权限判断） |
| 精细授权 | `AuthorizationManager`（Spring Security 6 推荐） | ❌ 无 | WVP 老接口用 `AuthorizationManager` + 「URI→权限映射表」统一鉴权，避免改几十个 controller |
| 审计 | `spring-boot-starter-aop`（**已在 pom，但项目里 0 个 `@Aspect`**） | ⚠️ 依赖在、没用 | 写 `@Aspect` + 自定义 `@Audit(module, action)` 注解切面，落 `patrol_audit_log`；WVP 关键接口用拦截器 |
| 日志 | Logback（`logback-spring.xml` 已在）+ `MDC` | ⚠️ 有配置文件，但**无 MDC/traceId** | 加 `MDC.put("traceId"/"userId")` + logback pattern 输出，审计与日志用同一 traceId 关联 |
| 异步/长任务 | `@Async`（项目里已在多处使用）+ `@EnableScheduling`（`VManageBootstrap`）+ Java 21 虚拟线程 | ✅ 基础设施在 | 推理编排（YOLO→VLM）用 `@Async` + 专用 `ThreadPoolTaskExecutor`（或虚拟线程），进度用 Spring `ApplicationEventPublisher` 事件 + WebSocket 推送 |
| 缓存 | `spring-boot-starter-cache` + `spring-boot-starter-data-redis` | ✅ 已引入 | 缓存用户权限、协议模板、识别方案；token 续签窗口状态 |
| 事务 | MyBatis + `@Transactional` | ✅ | 结果落库、告警生成、审计写入用事务 |
| 参数校验 | `spring-boot-starter-validation`（**pom 中缺失，需新增**） | ❌ 未引入 | 加依赖，DTO 用 `@Valid` + `@NotNull/@Size`，协议模板/方案配置强校验 |
| i18n/消息 | `MessageSource` | 可选 | 错误码统一走 `ErrorCode`（WVP 已有） |

**设计原则**：权限走 Spring Security 的 `GrantedAuthority` + `PermissionEvaluator`/`AuthorizationManager`；审计走 Spring AOP；异步走 Spring `@Async` + 事件；不要在 Filter 里手写一堆 if-else 权限判断，也不要自己写线程池和日志框架。

---

## 十二、诚实评估：30 张图的旧平台「能完美替代吗」/ 架构好了吗 / WVP 能完美兼容吗

### 12.1 功能能替代吗？——**功能面能覆盖，但称不上「完美」，有 3 处必须承认的差距**
| 差距 | 说明 | 处理建议 |
|---|---|---|
| **电子地图（2D 电气图 / 点云地图）** | 旧平台用的是自有电气接线图 + 机器人点云图，属它自己的数据源；WVP 地图是 OpenLayers 矢量瓦片制图，形态与数据都不同 | 若旧电气图数据可导出 → 作为底图/瓦片接入；否则需重新制图。**点云依赖机器人本体回传，属新增能力，先留接口占位** |
| **曲线分析（历史/常规/自定义）** | 依赖模拟量测点（表计读数）长期存储 | 用 `patrol_point_reading` 结构化 VLM 读数，**先把采集与存储打通，曲线页面后置**（P6 之后） |
| **静默任务 / 联动任务 / 检修区域** | 旧平台特有业务 | 静默任务、检修区域实现；联动任务（点位↔设备联动）建议后置，先确认业务是否还需要 |

其余页面（视频监控、录像回放、机器人/无人机监控、信息总览、巡检任务与新建、结果浏览归档、识别异常点位、任务执行、结果查询、任务报告、四类告警确认、可靠性统计、任务执行情况统计）**均可覆盖**。

### 12.2 巡检架构实际好了吗？——**方向成立，但有 4 个必须先定/先兜住的点**
1. **协议闭环依赖厂商**：无文档 → 先做通用模板 + Mock 设备，闭环可自测，真实联调等型号确认。
2. **推理链路是异步且长耗时**：Java 编排 YOLO→VLM 必须做成异步任务 + 超时 + 重试策略（VLM 长文耗时长），进度走 WS 推送；不能同步阻塞。
3. **采集源要明确**：点位拍照到底是「机器人自带相机」还是「固定摄像机」，两者通道绑定与取流方式不同 → 已用 `CaptureAction.source` 抽象。
4. **点位与通道的对应关系**：一个点位可能对应多个采集设备（可见光/红外），结果表按「点位 × 采集设备」存。

补齐这 4 点，架构就是好的。

### 12.3 WVP 能完美兼容吗？——**视频/设备域兼容良好，但「完美」不成立，两个硬缺口 + 一个 Bug**
- ✅ **兼容良好**：设备接入、通道、直播、云台/预置位/巡航、录像回放/下载、云端录像、媒体节点、级联、录制计划、组织结构、用户登录/JWT —— 都有现成接口，新前端直接接。
- ❌ **硬缺口 1：权限**。WVP 只有认证没有授权（无接口鉴权、无数据权限、无视图/编辑区分）。旧平台的账号-模块-摄像头功能权限必须**自建**（第十一节）。
- ❌ **硬缺口 2：审计**。WVP 无操作审计表，`/api/log` 只是日志文件。必须**自建**。
- 🐞 **Bug：Token 无续签**。`EXPIRING_SOON` 只检测不续签，到期掉线，必须**修复**（第十节）。
- ⚠️ **需改造**：看板聚合、通道多维筛选、站内通知 WVP 没有，需新增（第三节 B 类）。
- ⚠️ **部署**：新增 `patrol` 模块与独立表，全部新增接口走 `/api/patrol/**`，**不改 WVP 原接口语义**，保证可回滚。

**一句话结论**：视频与设备能力可以直接吃 WVP；但「权限、审计、token 续签」这三件事 WVP 帮不了，是这个项目的必做项，已纳入方案。

---

## 十三、Docker 内存预算（防 OOM）与测试联调方式

### 13.1 现状实测（本机）
| 容器 | 当前占用 | 说明 |
|---|---|---|
| docker-polaris-wvp-1 | 797 MB | JVM 参数 `-Xms512m -Xmx1024m`，已带 `HeapDumpOnOutOfMemoryError` |
| docker-polaris-mysql-1 | 454 MB | |
| docker-polaris-media-1 (ZLM) | 14 MB | 推拉流增多会上升 |
| docker-polaris-redis-1 | 8 MB | |
| docker-polaris-nginx-1 | 14 MB | |
| **合计** | **约 1.29 GB** | Docker 可用总内存 **7.75 GB**，当前余量约 6.4 GB |

**风险点**：新增 `yolo-service`（PyTorch）、前端构建期 node、以及「误在本机跑本地多模态大模型」——最后一项是唯一会稳定打爆 8GB 的操作。

### 13.2 内存预算与限制建议（写进 `docker-compose.yml`）
| 容器 | 建议 `mem_limit` | 配套措施 |
|---|---|---|
| polaris-wvp | `1536m` | 保持 `-Xmx1024m`；不要调大 |
| polaris-mysql | `1024m` | 数据量小，够用 |
| polaris-media | `512m` | |
| polaris-redis | `256m` | |
| polaris-nginx | `256m` | |
| yolo-service（新增） | `1536m` | 见下 |
| **上限合计** | **约 5.1 GB** | 给 WSL/构建留约 2.5 GB |

**yolo-service 必须做**：
- 强制 CPU 推理，只用 `yolov8n`（**不要**换 yolov8x/yolo11x 等大模型）；
- `OMP_NUM_THREADS=2` + `torch.set_num_threads(2)` + `MALLOC_ARENA_MAX=2`，避免线程/内存爆炸；
- 单 worker（`--workers 1`）；
- 入参图片限制最长边（如 1920px）与单请求体积上限，超过先缩放；
- 容器 `restart: unless-stopped`。

**前端构建防 OOM**：
- 优先在本机 `npm run build` 再把产物 copy 进镜像，或在 Dockerfile 里设 `NODE_OPTIONS=--max-old-space-size=2048`；
- `docker compose build` **串行执行**，不要与其他重任务（大模型下载、并发构建）同时跑。

**绝对禁止**：在本机 Docker 里跑本地多模态大模型（Qwen-VL / LLaVA / InternVL 等，加载动辄 4–8 GB，必 OOM）。**VLM 一律走云端 API**（见 `测试环境-密钥与模型配置.md`）。

**排查命令**：
```bash
docker stats --no-stream                                  # 实时占用
docker inspect <容器名> --format '{{.State.OOMKilled}}'    # 是否被 OOM 杀
```
若 WSL2 在 `%UserProfile%\.wslconfig` 里限制过 memory，需要同步上调。

### 13.3 新前端位置与测试方式（`web-react/`）
新前端就在 **`D:\Docker Project\wvp-GB28181-pro\web-react\`**，可以直接测试。两种方式：

**方式一：开发态（改代码即时热更，日常开发用）**
```bash
cd "D:\Docker Project\wvp-GB28181-pro\web-react"
npm install
npm run dev
```
- vite 代理：`/api` → `http://127.0.0.1:18978`（WVP），`/live`、`/zlm_snap` → `http://127.0.0.1:8081`（ZLM，需 `ws:true`）。
- 前提：WVP 等容器在运行（`docker compose up -d`）；AI 页面还需 `yolo-service` 在跑并配好 VLM key。

**方式二：类生产（验证真实部署链路）**
```bash
cd "D:\Docker Project\wvp-GB28181-pro"
docker compose build polaris-nginx     # 内含 npm run build
docker compose up -d
# 访问 http://<宿主机IP>:9080
```

**AI 端到端测试前提**：
1. 在 `doc/智能巡检重构/测试环境-密钥与模型配置.md` 里填好 SenseNova API Key；
2. 本机启动 `yolo_service.py`（:8999）；
3. 先跑通该文档第三节的 5 条 `curl` 连通性自测，再让 agent 做任务闭环测试。

### 13.4 联调资料索引
| 资料 | 位置 |
|---|---|
| 方案主文档 | `doc/智能巡检重构/重构方案-信息架构与WVP对接.md` |
| 执行提示词 | `doc/智能巡检重构/PROMPT-全量执行.md` |
| 测试密钥与模型配置（含 API Key，**已 gitignore**） | `doc/智能巡检重构/测试环境-密钥与模型配置.md` |
| 旧平台参考截图（30 张，**已 gitignore**） | `doc/智能巡检重构/截图/` |
