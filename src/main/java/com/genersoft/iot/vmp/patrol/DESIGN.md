# Patrol 模块设计（DESIGN.md）

> 新增包：`com.genersoft.iot.vmp.patrol`，全部接口前缀 `/api/patrol/**`。
> 原则：不改 WVP 原有接口语义；核心流程只依赖接口与注册表，禁止 `if (vendor == "xxx")` 硬编码。

## 1. 分层与类图（职责划分）

```
controller        只做参数接收/校验/返回，无业务逻辑
service           编排（事务边界），业务规则下沉 domain
domain            值对象与规则（record / sealed interface）
adapter           协议适配 SPI（Template Method + Registry）
orchestrator      任务执行编排（状态机 + 异步 + 事件）
inference         推理客户端（YoloClient / VlmClient / KbRetriever）
analysis          Analyzer SPI（责任链：Yolo→Vlm→融合判定）
dao               MyBatis Mapper
security          RBAC / 审计横切（@Audit AOP + AuthorizationManager）
```

## 2. 核心抽象

### 2.1 装备 PatrolAsset（面向对象）
- `AssetType`(enum): ROBOT_DOG / DRONE / CAMERA / SENSOR / GATE
- 新增型号 = 注册 `patrol_device_profile`(JSON 档案)，零代码；删除 = 停用，历史保留。
- `PatrolAssetService` 按 profile+template 组装运行时资产视图。

### 2.2 协议 ProtocolAdapter（SPI + Template Method + Registry）
```
ProtocolAdapter (interface)
 └─ AbstractHttpProtocolAdapter (抽象基类: 模板渲染/签名/超时/非幂等不重试)
     ├─ DeepRoboticsAdapter      云深处 Station OpenAPI 预设
     ├─ DjiCloudAdapter          大疆上云 API（MQTT 指令走 HTTP 网关模拟 + 预留）
     ├─ UnitreeAdapter           宇树 DDS（占位: 能力协商禁用 gotoWaypoint）
     └─ SpotAdapter              波士顿动力 gRPC（占位）
通用模板适配器（零代码，配置驱动）:
 ├─ GenericHttpAdapter   (protocol_type=HTTP_REST)
 ├─ GenericMqttAdapter   (protocol_type=MQTT)   —— 当前以 HTTP 通道轮询模拟，MqttBroker 未部署时自动降级
 └─ GenericTcpAdapter    (protocol_type=TCP)   —— 配置占位，标记能力不可用
```
- `capabilities()` 能力协商；不支持的能力在编排器下发前禁用（返回 DISABLED 而非报错）。
- `CommandEnvelope`(record) 统一指令；`CommandResult<T>` 泛型结果；非幂等指令不自动重试，超时返回 `resultUnknown` → 回查 `status()`。

### 2.3 模态 Modality + Analyzer（SPI + Chain of Responsibility）
```
Modality (enum): IMAGE / VIDEO / AUDIO / TEXT / POINTCLOUD / MULTI
Analyzer (interface): analyze(AnalysisContext) -> AnalysisResult
 ├─ AbstractAnalyzer (超时/重试429指数退避/耗时/日志)
 ├─ YoloAnalyzer    → yolo_service.py (/v1/detect /v1/ocr_detect)
 ├─ VlmAnalyzer     → 云端 VLM (chat_completions / responses / anthropic)，多厂商
 ├─ OcrAnalyzer     → yolo ocr_detect（文本数字）
 ├─ CompositeAnalyzer（编排链: Yolo→知识库→Vlm→融合判定，即"识别方案"运行时形态）
 └─ AudioAnalyzer / VideoAnalyzer / PointCloudAnalyzer（占位: 返回 UNSUPPORTED）
```
- `AnalysisResult`(record): labels[], boxes[], texts[], readings[](PointReading), reasoning, raw, engine, costTokens, elapsedMs。
- `PointReading`(record): key, valueNum, valueText, unit, confidence —— 曲线分析数据源，先建表 `patrol_point_reading`。

### 2.4 采集 CaptureAction
`{mode: PHOTO|VIDEO|AUDIO|POINTCLOUD, source: ONBOARD_CAMERA|FIXED_CHANNEL|PAYLOAD, params}`；
点位可绑机器人自带相机或 WVP 固定摄像机通道（FIXED_CHANNEL 走 WVP 截图 `device/query/snap`）。

### 2.5 识别方案 IdentifyScheme = Analyzer 链 + 参数
- `patrol_identify_scheme`: algo_id + vlm_model_id + prompt_id + kb_ids + threshold + roi + risk_level。
- 任务点位批量套用；解析优先级：点位级 scheme > 任务级 default_scheme。

## 3. 任务执行编排（P5 核心）

```
TaskCommandService.execute(taskId)
  → 创建 patrol_task_execution(RUNNING, 虚拟线程异步)
  → ProtocolAdapter.startTask(机器狗) 或 FIXED_CHANNEL 模式直接进入采集
  → 采集: 机器人回传(POST /api/patrol/ingest/media) 或 WVP snap
  → 每点位: 建 point_result(ANALYZING) → CompositeAnalyzer.analyze()
       YoloAnalyzer → KbRetriever(知识库检索) → VlmAnalyzer → FusionStrategy(判定)
  → 异常 → patrol_alarm + patrol_notification + ApplicationEvent → WS 推送
  → 全点位完成 → execution(FINISHED) → 报告数据汇总
进度全部经 WebSocket /api/patrol/ws 推送；HTTP 请求线程只做触发。
```

## 4. Spring 原生组件使用（不自造轮子）

| 能力 | 组件 |
|---|---|
| 权限 | Spring Security `GrantedAuthority`(PERM_module:action) + `AuthorizationManager`(URI映射表保护WVP老接口) + `@PreAuthorize` + 自定义 `PermissionEvaluator`(摄像头功能级) |
| 审计 | `@Aspect` + `@Audit` 注解 → patrol_audit_log；WVP 关键接口经 `patrol_uri_permission` 白名单由拦截器记录 |
| 日志 | Logback + MDC(traceId/userId)，log pattern 已加 %X{traceId} |
| 异步 | `@Async("patrolTaskExecutor")`（虚拟线程, Java 21）+ `ApplicationEventPublisher` |
| 缓存 | spring-boot-starter-cache + Redis：用户权限聚合、协议模板 |
| 事务 | `@Transactional`（结果落库+告警+通知） |
| 校验 | spring-boot-starter-validation + `@Valid`（pom 已补依赖） |

## 5. 表清单（MySQL，前缀 patrol_，共 24 张）
见 `数据库/2.7.4/patrol-初始化.sql`：protocol_template / robot_device / device_profile / waypoint /
algo / vlm_model / prompt / knowledge_base / knowledge_doc / identify_scheme / analyzer /
task / task_point / task_execution / point_result / point_reading / media / alarm /
maintenance_area / notification / dict / role_permission / role_data_scope /
role_channel_permission / uri_permission / audit_log。

## 6. 媒体存储架构（图片/视频文件的归属）

**结论：媒体不走数据库、不走 Tomcat 流式转发，走存储抽象 + nginx 静态服务。**

```
采集(ZLM getSnap / 机器人回传 / 无人机S3清单)
      │  bytes
      ▼
MediaService (门面, 按配置选实现)
      │
      ├─ LocalDiskMediaStorage   local（已实现）→ /opt/wvp/media/patrol/images/yyyyMMdd/uuid.jpg
      │                              对外 URL: /patrol-media/** 由 nginx 直接静态服务（alias 卷，不经 JVM）
      ├─ S3/MinIO                s3（未实现，待接入）
      └─ FTP                     ftp（未实现，待接入）
      ▼
patrol_media(storage_type, object_key, url, size, width, height)
```

为什么这样设计（而不是让 Java 直接读流返回 / 把 base64 塞进库）：
1. **大对象不进 MySQL**：base64 会让 media 行膨胀到几十 KB～MB，拖垮备份与查询；
2. **不经 Tomcat**：nginx 直接吐文件，省 JVM 堆与线程，符合本机 7.75G 内存预算；
3. **可换存储**：方案文档 4.5 要求"推/拉/共享存储三选一"，SPI 让 S3/MinIO/FTP 后续只加实现类；
4. **可加缩略图与保留策略**：列表用缩略图、原图详情用，便于后续做 N 天清理；
5. **权限仍在 API 层**：URL 使用 UUID，列表/详情接口受 RBAC 保护；如需强管控可改为带 token 的签名 URL。
6. 图片访问路径两种都保留：nginx 静态 `/patrol-media/**`（首选）+ 后端 `/api/patrol/media/file/**`（存储无关回退）。

## 7. 未实现清单（显式记录，不伪装、不降级）

| 项 | 状态 | 行为 |
|---|---|---|
| MQTT / TCP / gRPC / DDS 协议适配器 | 未实现 | 注册表返回 DISABLED + 原因，不冒充 HTTP；预设模板可保存但下发被能力协商拦下 |
| S3/MinIO / FTP 媒体存储 | 未实现 | MediaService 明确报错提示改 local；不静默降级 |
| 大疆上云 / 宇树 DDS / Spot gRPC 真实指令 | 未实现 | 模板内置占位，默认 enabled=0，需凭据与网关后接入 |
| 电子地图(2D电气图/点云底图) | 数据源未提供 | 页面显式标注需底图数据，不使用假地图 |
| 录像完整率 / 在线时长 / 连续正常运行天数 / 漏检率 / 告警准确率 | 数据源未采集 | 接口返回 null + notCollected 清单，不返回编造数值 |
| 环境在线监测 / 声纹监测 / 系统自检状态 | 按方案砍掉 | 不建立对应页面与接口（overview 不再返回 weather 占位） |
| GB 通道(非代理)拍照 | 部分实现 | 仅支持拉流代理通道经 ZLM getSnap；GB 通道需 play→snap 两跳，未接入时返回采集失败并记录原因 |
| 无人机/机器人实时视频画面 | 未接入 | 页面标注"待协议适配接入"，无假画面 |

## 8. 实测运行记录（凭据/模型/配额，务必知悉）

- **Sensenova 6.8-flash-lite 是推理模型**：图片请求时正文可能只出现在响应 `message.reasoning` 字段，`content` 为空。
  实现已做回退：`content` 空则取 `reasoning`（也已把 max_tokens 降到 1024 以省额度）。
- **6.7-flash-lite / u1-fast / u1.5-lite 在该 Key 下不可用**（`model route not found` / `model is not found`），
  故 `model_fallback` 置空，不再浪费重试。
- **账户 TPM/RPM 配额较小**：频繁/大请求会返回 429（`inference exceeds tpm/rpm limit`）。
  实现为指数退避（3s/6s/12s/20s，最多 5 次）；若配额耗尽则明确报错，**不会伪装成功**。
  上线前建议提升配额或降低图像分辨率/并发。
- **YOLO**：Docker 镜像必须 `torch` 与 `torchvision` 版本严格匹配（当前 2.4.1+cpu / 0.19.1+cpu），
  否则报 `operator torchvision::nms does not exist`，表现为"YOLO 跑不通"。
- **nginx**：`client_max_body_size 50m`（机器人照片常 >1MB，默认 1m 会 413）。
- **WVP 登录是 GET**（UserController 同时标注 Get/Post，Spring 只注册 GET）；Token 头为 `access-token`。

## 9. 海康威视接入（已实测打通）

现场设备：iDS-MCD20M/32G/GLE（PVR，序列号 FX5719313，192.168.0.125，admin）。
三条接入路线，全部可用/可激活：

| 路线 | 状态 | 用途 |
|---|---|---|
| **RTSP 直连拉流** | ✅ 已通 | 实时播放（ws_flv）+ 巡检抓帧（ZLM 回环）。注意：RTSP URL 里密码含特殊字符时必须存**原始字符**（WVP 会编码一次；存已编码的会二次编码导致认证失败） |
| **海康 ISAPI**（HTTP Digest，80端口） | ✅ 已实现适配器 | status=设备信息 ✅ / getMediaList=**PVR本机录像检索** ✅ / capturePhoto（该 PVR 不支持即时抓图，走RTSP）/ setPtz（固定机位不支持）。模板：`海康威视 ISAPI(相机/NVR/PVR)`，协议类型 `HIKVISION_ISAPI` |
| **GB28181** | 可激活（零代码） | 平台里已有该设备的注册记录（序列号一致）。在相机 Web 页把 GB28181 的 SIP 服务器指向本平台（IP/5060/设备编号/密码）即可上线，播放/云台/**录像回放**全部由 WVP 原生支持 |

录像存储结论（回答"录像存哪里"）：
1. **设备本机**：这台 PVR 自带硬盘录像（ISAPI 已检索到录像段），可通过 ISAPI 检索 + GB28181 回放取流；
2. **平台侧**：WVP/ZLM 录制计划（mp4_record），适合对重点通道常录；
3. **对象存储**：MinIO（接口已预留 storage_type=s3，未部署）。

ISAPI 适配器使用：装备台账注册 CAMERA 装备 → 绑定"海康威视 ISAPI"模板 → connection_json 填
`{"host":"192.168.0.125","port":80,"user":"admin","password":"...","channelNo":1}` →
`POST /api/patrol/robot/{id}/command {"command":"status|getMediaList|setPtz|capturePhoto", "params":{...}}`

## 10. VLM 调用保底策略（对齐成熟实践：OpenAI/Anthropic SDK、LiteLLM、Resilience4j）

| 策略 | 实现 | 配置 |
|---|---|---|
| 指数退避 + 抖动 | 429 退避 3s→6s→12s→20s，±30% 随机抖动防惊群 | `patrol.vlm.max-retry=5` |
| 遵守 Retry-After | 服务端 429 响应头优先于本地退避 | 自动 |
| 客户端主动限流 | 全局并发许可(默认1) + 最小调用间隔 2s，在 429 前自我约束 | `min-interval-ms` / `max-concurrent` |
| 熔断器 | 连续 5 次 429 → 熔断 60s，冷却期快速失败并提示剩余秒数，期满自动放行探测 | `circuit-threshold` / `circuit-open-ms` |
| 渐进式降载 | 同一次调用内发生 429 后，重试请求自动把图片降到 800px（视觉 token 大幅减少） | 自动 |
| 预降分辨率 | 首次发送前统一降到 1600px JPEG | `CompositeAnalyzer.VLM_MAX_SIDE` |
| 总截止时间 | 全部重试总预算 180s，超时立即止损 | `deadline-ms` |
| 模型降级 | 主模型 route-missing/失败时交替备用模型 | `model_fallback` |
| 诚实失败 | 配额耗尽/熔断 → 结果标 FAILED 或明确错误，绝不谎报正常 | — |
| Key 保护 | AES 加密存储；列表接口不下发密文；日志脱敏 | — |

排队语义：任务编排的多点位分析共享一个并发许可——天然串行，配合最小间隔，
把"每分钟请求数"约束在配额内。若配额提升，可调 `max-concurrent`/`min-interval-ms` 提吞吐。

## 11. 录像设备（NVR）模型与挂载语义（2026-09-12 新增）

**三类视频流来源，三个列表的对应关系：**

| 概念 | 方向 | 界面位置 | 说明 |
|---|---|---|---|
| GB28181 国标注册 | 设备 SIP 注册进来 | 国标设备 | NVR/摄像机在设备端配 SIP，注册后设备+通道自动出现 |
| 拉流代理 | 平台(ZLM) → 设备取 RTSP | 拉流代理 | 接入向导创建的通道；无人观看自动回收，播放自动拉起 |
| 推流 | 设备/上级 → 平台(ZLM) | 推流列表 | RTMP 推流、GB 收流会话等；国标点播的会话流也登记在此 |

**"一个设备两个通道"**：GB28181 里 NVR 注册时会把自己也报成一个通道（设备自身通道），
再加上名下每路摄像机通道，所以树里显示 2 通道（FX5719313 自身 + 海康高清摄像机）。

**挂载模型（本节新增，已实现）：**

```
patrol_nvr          录像设备档案（名称/厂商/IP/RTSP端口/管理端口/凭据/通道容量/区划）
patrol_nvr_camera   摄像头挂载绑定（channel_id 唯一，nvr_channel_no=NVR 侧通道号）
```

- 向导选「挂载到录像设备」：RTSP 从 NVR 取流（`rtsp://nvr:554/厂商路径/通道{NVR侧通道号}`），
  通道创建后写入绑定；选「直连」则从摄像机取流，不产生绑定。
- **云台经 NVR**：拉流代理通道无法走国标云台；有绑定的通道由
  `POST /api/patrol/access/nvr-ptz?channelId=` 走 ISAPI `PUT /ISAPI/PTZCtrl/channels/{NVR侧通道号}/continuous`
  （Digest 认证，500ms 自动停止）。PtzPanel 按 dataType 自动路由（国标→WVP 云台接口，代理→NVR）。
- 已有通道补挂载/解绑：通道管理 → 编辑 → 挂载录像设备。
- 录像归属：国标 NVR → 录像计划（7×24 计划录制到 ZLM 本地）；厂商 NVR 本机录像 → ISAPI
  ContentMgmt/search 检索（适配器 CMD_GET_MEDIA_LIST 已实现，回放 UI 未接）。
- NVR 密码不回传前端（hasPassword 标记），编辑留空=不修改；ISAPI 测试连通用 CMD_STATUS。

**部标 JT1078**：WVP 内置该模块但需 `jt1078.enable=true` 才装配（当前部署未开启），
巡检平台无车载终端场景 → 接入页不再展示「部标设备」Tab，避免 404。如需启用：
docker 配置加 `jt1078.enable: true` + 端口 21078。
