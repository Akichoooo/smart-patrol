# 新会话「全量执行」提示词

> 用法：新开一个会话，把下面 `====` 之间的内容整段粘贴进去即可。

====

## 任务：重构 WVP 为「智能巡检平台」，用 React + Semi Design 新 UI 完全替换南水机器狗巡检平台

你是一个资深全栈工程师，独立、连续地把这件事做完。不要只输出方案或骨架，要**真正写代码、构建、部署、验证**。你有充分的架构自由度，但必须满足「硬性约束」一节的要求。

### 第一步：先读全部材料（必须读完再动手）

> 本会话工作根目录就是 `D:\Docker Project\wvp-GB28181-pro`（代码、docker、文档都在此目录下，请以它为项目根）。

1. **方案主文档**（信息架构、页面树、WVP 接口对接矩阵、新增后端表设计、协议设计、多模态扩展底座、Token 续签修复、权限与审计设计、能力评估、实施阶段）：
   `D:\Docker Project\wvp-GB28181-pro\doc\智能巡检重构\重构方案-信息架构与WVP对接.md`
2. **旧平台 30 张截图**（逐张看清每个页面的字段、列、按钮、交互，作为还原依据）：
   `D:\Docker Project\wvp-GB28181-pro\doc\智能巡检重构\截图\`
   （编号不连续，共 30 张：2–27 加 29–32，缺 28，即 `屏幕截图(2).png` … `屏幕截图(32).png`）
3. **WVP 现有代码**（读清楚再用，不要改坏原有语义）：
   `D:\Docker Project\wvp-GB28181-pro`
   - 后端：`src/main/java/com/genersoft/iot/vmp/`
   - 旧前端（仅参考）：`web/`
   - 部署：`docker/docker-compose.yml`、`docker/nginx/`、`docker/wvp/wvp/application-docker.yml`
4. **已有的 AI 前端原型（未提交，重要参考）**：
   - `web/src/views/ai/`（`monitor/` 巡检监控台、`models/` 算法模型配置、`tasks/` 巡检任务编排、`alarms/` 告警处置中心，以及 `aiStorage.js` 数据层与 provider 代理映射）
   - 根目录 `yolo_service.py`（FastAPI 推理服务）、`yolov8n.pt`（模型权重）
   - **定位**：这是之前跑通的前端原型，**交互流程、字段、厂商预设、提示词思路都可直接借鉴**；但它用的是 localStorage + 直连云 VLM，**新实现必须改为走正式后端接口与数据库**，不要沿用 localStorage 方案。旧的 `web/` Vue 实现同理只作参考。
5. **测试凭据配置**（做 AI 测试前必读，含 VLM API Key）：
   `D:\Docker Project\wvp-GB28181-pro\doc\智能巡检重构\测试环境-密钥与模型配置.md`
   - 里面填好了商汤 SenseNova 的 Base URL / API 格式 / 模型名，以及本地 YOLO 服务的端口与接口；**API Key 由我来填**。
   - 该文件已 gitignore，**不要提交、不要外发、不要把 key 回显到日志或接口返回里**。
   - 开工做 AI 相关功能前，先用该文档第三节的 5 条 `curl` 命令自测连通性；跑不通先解决凭据/网络，再继续写代码。

### 已确定的方向（不要推翻，其余细节你有权决定）
- **新前端**：`D:\Docker Project\wvp-GB28181-pro\web-react\`，React 18 + TypeScript + Vite + **Semi Design**（`@douyinfe/semi-ui`）。构建产物输出到 `../src/main/resources/static`，由 nginx 的 `/opt/dist` 服务。旧 `web/` 保留参考，最后阶段移除。
- **新后端**：并入 WVP Java 工程，新增 `com.genersoft.iot.vmp.patrol` 包；新增接口一律 `/api/patrol/**`，**不改 WVP 原有接口语义**，保证可回滚。
- **Python 推理**：`yolo_service.py` 保留为纯推理微服务（FastAPI :8999，`GET /health`、`POST /v1/detect`、`POST /v1/ocr_detect`），容器化；Java 通过配置 `patrol.inference.yolo-url` 调用，**不要写死 127.0.0.1**。
- **协议**：厂商文档暂无 → 做「多协议可选 + 厂商预设 + 通用模板」。首发 4 预设（大疆上云 API / 云深处 Station OpenAPI / 宇树 Unitree DDS / 波士顿动力 Spot）+ 通用 HTTP/MQTT/TCP 模板 + RTSP-ONVIF/GB28181/Modbus 媒体通道。见方案文档第四节。
- **明确砍掉不做**：声纹监测、环境在线监测、系统自检状态。其余旧平台功能都要覆盖。

### 顶部栏（严格按此）
```
[智能巡检] → 点击进入 /overview      实时监控 | 巡视管理      通知🔔  用户▾  设置⚙
```
左「智能巡检」点击进信息总览；中间**就两个**（实时监控、巡视管理），不要加第三个；右侧通知（未读角标）、用户下拉（个人信息/改密/退出）、设置齿轮。机器狗/无人机/AI 全部归入这两个 + 设置。

### 页面与模块：你有合并/调整的自由度
方案文档第二节给的是完整页面树，**设置区已经合并为 8 个分组**（组内用 Tab），请照此实现：
```
设置：账号与安全 / 设备接入 / 媒体与级联 / 组织与地图 / 机器人与装备 / 智能算法 / 巡视配置 / 系统
```
除此之外，如果你判断某些页面可以进一步合并、某些子页应独立，**可以自行决定，但要遵守**：
1. 旧平台「顶部三项 + 左侧子菜单」的信息结构不能变（用户肌肉记忆）；
2. 合并后不能丢失任何旧功能点（对照 30 张截图逐条自查）；
3. 高频常用功能不许藏进设置；低频配置不许占顶部栏；
4. 每次合并/调整都在最终汇报里说明「合并了什么、为什么、怎么保证不丢功能」。

### 硬性约束（必须满足，不可省略）

**A. 安全底座（WVP 缺失，必须自建，不可后置）**
1. **修复 Token 无续签 Bug**（已核实：`JwtAuthenticationFilter` 的 `EXPIRING_SOON` 分支只检测不续签；`LoginUser.getAuthorities()` 返回 null）。实现滑动续签：即将过期时下发新 token 到响应头 `access-token`，并新增 `POST /api/user/refresh`；前端拦截器读取响应头自动更新。把 `login-timeout` 设为 5 分钟做验收：持续操作 30 分钟不掉线。
2. **自建 RBAC**（WVP 只有认证、没有授权；`RoleController` 里 authority 字段注释原文是「目前未使用」）：
   - ① 模块权限（菜单可见性）② 操作权限（view/create/edit/delete/execute/export/review/confirm）③ 数据权限（ALL / 指定区划树 / 指定分组 / 指定通道）④ **摄像头功能级权限**（view/ptz/preset/playback/download/snapshot/talk/record）。
   - 后端**强制校验**（不只前端隐藏）；WVP 接口用「URI→权限映射表 + 拦截器」保护，避免逐个改 WVP controller。
   - 登录后 `GET /api/patrol/auth/me` 下发权限，前端据此生成菜单 + 按钮级 `hasPermission`。
   - `admin` 全权限兜底。
3. **操作审计**：新建 `patrol_audit_log`，记录用户/模块/动作/目标/URI/参数(脱敏)/IP/结果/耗时；新接口用 AOP 注解，WVP 关键接口（设备通道增删改、云台、回放下载、用户与权限变更、登录登出、403 越权）用拦截器记录。设置→账号与安全→操作审计 可查询导出。密码/token/api_key 一律不入库。

**B. 多模态 + 面向对象的可扩展底座（型号未定，先设计好，后续增删不改核心）**
- 装备抽象 `PatrolAsset`（机器狗/无人机/摄像机/传感器/机库），**新增型号 = 注册装备档案 `patrol_device_profile`（JSON），不写代码**；删除型号 = 停用档案，历史数据保留。
- 协议抽象 `ProtocolAdapter` SPI + 能力协商（`capabilities()`）；不支持的能力下发前禁用而非报错。
- 模态抽象 `Modality`（IMAGE/VIDEO/AUDIO/TEXT/POINTCLOUD/MULTI）+ `Analyzer` SPI（Yolo/Vlm/Ocr/Composite，Audio/Video/PointCloud 留接口占位）。一个「识别方案」= Analyzer 链 + 参数，不绑厂商。
- 采集抽象 `CaptureAction`（PHOTO/VIDEO/AUDIO/POINTCLOUD × ONBOARD_CAMERA/FIXED_CHANNEL/PAYLOAD），点位可绑机器人自带相机或固定摄像机通道。
- 统一 `AnalysisResult` 结构；结构化 **`PointReading` 读数**（数值/单位/置信度）表先建好，作为将来曲线分析的数据源。
- **核心流程禁止 `if (vendor == "unitree")` 这类硬编码**，一律走注册表 + 配置。

**C. 业务核心**
- **「识别方案」一键配置多个点位**：`算法(YOLO) + VLM模型 + 提示词 + 知识库` 打包成可复用方案；任务里选一批点位批量套用，点位级可单独覆盖（点位级优先于任务级）。
- **推理编排闭环**：下发任务 → 机器人定点拍照回传 → 存图 → YOLO →（按需）知识库检索 → VLM → 融合判定 → 异常建告警+通知+WS 推送。**必须异步 + 超时 + 重试策略，进度走 WebSocket，不能同步阻塞**（VLM 耗时长）。
- **媒体回传三选一可配**：设备 POST 到平台 / 平台按 `getMediaList` 拉取 / 共享 S3-MinIO-FTP。
- **非幂等指令**（任务下发/停止等）严禁自动重试，超时回查状态。

**D. 工程坑（务必遵守）**
- 登录 `POST /api/user/login`，密码 **32 位 MD5**；Token 请求头是 **`access-token`**（不是 Authorization）。
- 生产同源 `baseURL=''`；开发 vite proxy：`/api`→`http://127.0.0.1:18978`，`/live`、`/zlm_snap`→`http://127.0.0.1:8081` 且 `ws:true`。
- 播放器：`ws_flv` 用 `mpegts.js`；H.265 通道回退 Jessibuca（WASM，包成 React 组件）；`rtc` 走 WebRTC。
- **UI 只用 Semi Design**，不引入 Element/Antd；默认深色主题，对齐旧平台风格。
- 密钥用 `secret://` 引用，不落明文；新增表一律 `patrol_` 前缀，补 `数据库/` 初始化与升级 SQL。

**E. 后端设计规范（Java 21 / Spring Boot 3.4.4 / Spring Security 6，必须遵守）**

这是一个长期演进的项目，后端要**面向对象、可扩展、可增删**，不要写成过程式的面条代码。

1. **多用 Java 的抽象能力**：
   - 接口 + 抽象类 + 继承：`ProtocolAdapter`（接口）/ `AbstractHttpProtocolAdapter`（抽象基类）/ `DeepRoboticsAdapter`、`DjiCloudAdapter`（子类）；`Analyzer` 接口 / `AbstractAnalyzer` 抽象基类 / `YoloAnalyzer`、`VlmAnalyzer`、`CompositeAnalyzer`。
   - 泛型：`AnalysisResult<T>`、`CommandResult<T>`、`PageResult<T>`；注册表用 `Registry<K, V extends Spi>` 泛型基类。
   - Java 21 特性：`record` 做 DTO/值对象、`sealed interface` 约束指令与事件类型、`switch` 模式匹配、虚拟线程跑推理任务。
   - 设计模式：SPI + Registry（协议/分析器注册）、Strategy（判定策略）、Template Method（通用 HTTP/MQTT 模板适配器）、Chain of Responsibility（识别方案 = Analyzer 责任链）、Factory（Adapter/Analyzer 工厂）、Builder（协议模板/方案构建）。
   - SOLID：单一职责，禁止 God Class；service 只编排，业务规则下沉到 domain；禁止在 controller 里写业务逻辑。
2. **用 Spring 原生组件，不要自造轮子**（详见方案文档 11.5）：
   - **权限**：走 Spring Security。把角色权限聚合成 `GrantedAuthority` 写进 SecurityContext，用 `@PreAuthorize` + 自定义 `PermissionEvaluator`；WVP 老接口用 `AuthorizationManager` + URI→权限映射表统一鉴权。**不要**在过滤器里手写 if-else 权限。
   - **审计**：用 `spring-boot-starter-aop`（已在 pom）写 `@Aspect` + 自定义 `@Audit` 注解切面，落 `patrol_audit_log`。
   - **异步**：推理编排用 `@Async` + 专用 `ThreadPoolTaskExecutor`（或 Java 21 虚拟线程）；流程推进用 `ApplicationEventPublisher` 发事件 + WebSocket 推送，**不要同步阻塞请求线程**。
   - **缓存**：`spring-boot-starter-cache` + Redis 缓存权限、协议模板、识别方案、token 续签状态。
   - **事务**：结果落库 + 告警生成 + 审计写入用 `@Transactional`。
   - **日志**：Logback（`logback-spring.xml` 已有）+ `MDC` 加 `traceId`/`userId`，让日志与审计可关联（WVP 目前**没有 MDC**，需要你补）。
   - **校验**：pom 里**缺 `spring-boot-starter-validation`，需要新增**；DTO 用 `@Valid` + 校验注解。
3. **不要改坏 WVP**：新增代码放 `patrol` 包；WVP 侧只做必要改造（`LoginUser.getAuthorities()` 返回真实权限、过滤器续签 token、pom 加 validation），改动要小而清晰、可回滚。
4. **先设计再编码**：动手前先写清「接口/抽象类/实现类」的类图与职责划分（可写在代码注释或一个 `patrol/DESIGN.md`），确认抽象合理后再落地，避免边写边改结构。

**F. 测试与资源约束（重点：Docker 绝对不要 OOM）**

本机 Docker 总内存只有 **7.75 GB**，现有 WVP+MySQL+Redis+ZLM+nginx 已占约 1.3 GB。必须按方案文档第十三节执行：

1. **禁止在本机 Docker 跑本地多模态大模型**（Qwen-VL/LLaVA/InternVL 等，加载 4–8GB 直接 OOM）。**VLM 一律走云端 API**（SenseNova，凭据见测试配置文件）。
2. **本地只跑 `yolov8n` 小模型**，不要换大模型；`yolo-service` 必须：CPU 推理、`OMP_NUM_THREADS=2` + `torch.set_num_threads(2)` + `MALLOC_ARENA_MAX=2`、单 worker、限制入参图片最长边（≤1920）与请求体积。
3. **给所有容器加 `mem_limit`**：wvp 1536m / mysql 1024m / media 512m / redis 256m / nginx 256m / yolo-service 1536m（上限合计约 5.1GB，给构建和 WSL 留余量）。WVP 的 `-Xmx1024m` 保持不动。
4. **前端构建防 OOM**：`docker compose build` 串行执行，不要与其他重任务并行；Dockerfile 里设 `NODE_OPTIONS=--max-old-space-size=2048`，或在本机构建后 copy 产物。
5. **遇到容器被杀的排查顺序**：`docker stats --no-stream` → `docker inspect <容器> --format '{{.State.OOMKilled}}'` → 再看容器日志。确认是 OOM 才调内存，不要盲目加大。
6. **测试前端**：`web-react/` 就是新前端目录，两种方式——① 开发态 `cd web-react && npm run dev`（vite 代理 `/api`→18978、`/live`+`/zlm_snap`→8081 且 ws）；② 类生产 `docker compose build polaris-nginx && docker compose up -d` 后访问 `http://<宿主机IP>:9080`。前提是 docker 栈已起、AI 页面还需 yolo-service 与 VLM key 就绪。
7. **测试顺序**：先跑通测试配置文档第三节的 5 条 `curl`（VLM 文本 + VLM 图片 + YOLO 健康检查），再让前端调后端、后端调推理，逐层验证，不要一上来就端到端。

### 执行方式（强制）
1. **自己编排这个长任务**：读完材料后，先产出一份总的实施计划（阶段 → 任务 → 依赖 → 验收），再用 TodoWrite 落成可勾选清单，按方案文档第七节 P0–P7 推进（其中 **P1.5 安全底座不可后置**）。你是这个长任务的总负责人：自行拆解、自行排序、自行并行（互不依赖的工作可以并发做）、自行判断何时该抽公共组件、自行决定合并哪些页面。
2. **每个阶段都要能独立验证**：每完成一个阶段就构建 + 自测 + 汇报，通过后再进下一阶段；不要攒到最后一次性构建。阶段之间的产物要可独立运行，避免"做一半系统是坏的"。
3. **每 1–2 个阶段做一次一致性回归**：确认新增代码符合 E 节的 OOP/Spring 规范，抽象没有跑偏，没有出现重复代码和 God Class；发现结构问题立刻重构，不要拖。
4. 每页**对照截图还原**字段与交互；缺后端接口先在 `patrol` 包补齐，P5 前不得用假数据糊弄。
5. WVP 接口路径/参数/返回结构不确定时，**直接读源码确认，不要猜**。
6. 部署验证：改 `docker/nginx/Dockerfile` 指向 `./web-react`，`docker-compose` 加 `yolo-service`，构建后 `docker compose up -d`，访问 `http://<host>:9080` 验证。
7. 破坏性操作（删旧 `web/`、清库、重建数据卷）先确认；其余按方案直接做。
8. 全程中文汇报。每阶段结束汇报：做了什么、怎么验证的、还剩什么、做了哪些合并/取舍。

### 最终交付判定
- 访问 9080 完全由新 React UI 承载；登录→顶部栏→信息总览/实时监控/巡视管理/设置 全通。
- 视频监控能播、云台/预置位可用；录像回放可查可下；设置下 WVP 直连页全部可用。
- **Token 续签验证通过**；不同角色的菜单/按钮/可见通道不同，越权返回 403；审计可查到云台/下载/改配置等操作。
- 机器狗/无人机可注册（含型号未定占位）、可配协议、可下发指令；算法/模型/提示词/知识库/识别方案可配置。
- 端到端跑通一条：配置方案 → 建任务（一键套用到多点位）→ 下发 → 回传照片 → YOLO+VLM 出识别结果 → 异常产生告警 → 结果/报告/统计可见。
- 对照 30 张截图逐条核对，除「声纹监测/环境在线监测/系统自检状态」外全部覆盖（地图/曲线/联动若受数据源限制，需在汇报中明确说明并给出后续方案）。

开始吧。先读材料，再列 TodoWrite，然后从 P0 动工。

====
