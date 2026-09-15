# AGENTS.md — 本仓库 agent 工作约定（必读）

## 项目
WVP-GB28181-pro（Java 21 · Spring Boot 3.4 · MyBatis 注解 SQL）改造为**智能巡检平台**：
- 新前端：`web-react/`（React18 + TS + Vite + Semi Design）。**前端构建产物打进 jar**（vite 输出到 `src/main/resources/static/`）——改前端必须 `npm run build` 后重打 jar 重建 `polaris-wvp` 镜像，只重建 nginx 无效。
- 新后端：`com.genersoft.iot.vmp.patrol` 包。stock WVP 代码原则上不动。
- 旧前端 `web/` 仅留参考，不要改。

## 构建与部署（当前为混合模式：WVP jar 直跑 Windows 宿主机 + 中间件在 Docker）
```bash
export JAVA_HOME="/d/devloop/jdk 21 LTS"        # 默认 JAVA_HOME 是 17，必须切 21
cd web-react && npm run build                    # 前端产物进 jar
cd .. && mvn -DskipTests package                 # 产物 target/wvp-pro-*.jar（打包前删旧 jar）
# 启动整个平台（Docker 引擎 -> 容器 -> 本机 jar），双击或命令行均可：
scripts\start-platform.bat
# 只重启 WVP（容器已在跑时）：先杀 java.exe，再跑 scripts\start-wvp-local.bat
```

**部署拓扑（谁在 Docker、谁在本机）**

| 组件 | 位置 | 地址 | 容器名 |
|---|---|---|---|
| MySQL | Docker | 127.0.0.1:33061 | docker-polaris-mysql-1 |
| Redis | Docker | 127.0.0.1:16379 | docker-polaris-redis-1 |
| ZLMediaKit | Docker | 127.0.0.1:8081（收流 10003/udp） | docker-polaris-media-1 |
| YOLO 边缘推理 | Docker | 127.0.0.1:8999 | docker-yolo-service-1 |
| nginx 前端入口 | Docker | http://127.0.0.1:9080 | docker-polaris-nginx-1 |
| **WVP 后端** | **本机 jar（java.exe）** | 18978 + SIP 192.168.0.100:5060 | 无容器 |

- 容器名带 `docker-` 前缀：compose 项目名取自目录名 `docker`。
- **`polaris-wvp` 已加 `profiles: ["container-full"]`**，`docker compose up -d` 不会再创建它，nginx 因此不再需要 `--no-deps`。要跑整套容器版才用 `docker compose --profile container-full up -d`。
- 绝不给本机 jar 设 `RUN_ENV=docker`；SIP 必须绑真实网卡 5060，国标注册与点播才通。
- **`Stream_IP` 与 `SDP_IP` 是两件事，禁止一起改**（改错这一条的症状就是"原本能播的通道突然黑屏"）：
  - `Stream_IP` → `wvp_media_server.stream_ip`，只用于拼**给浏览器**的播放地址。本机 Docker(WSL2 mirrored) 的发布端口只有 `127.0.0.1` 通，物理网卡 IP 一律超时，所以这里**必须 127.0.0.1**。
  - `SDP_IP` → `sdp_ip`，写进 SDP、决定**设备往哪发 RTP**，必须真网卡 `192.168.0.100`。
  - `stream_ip` 只在 media server 行首次插入时写入，**启动不会覆盖已有行**；改完 `Stream_IP` 记得同步 `update wvp.wvp_media_server set stream_ip='127.0.0.1'` 再重启。
  - 验证：`GET /api/common/channel/play?channelId=` 返回的 `ws_flv` host 必须是 `127.0.0.1`。
- **同类坑：库里的 `yolo_url` 也存过容器主机名**。`YoloClient.baseUrl()` 优先取界面配置（`patrol_dict` type=sys_config code=yolo_url），本机 jar 解析不了 `yolo-service` 这个域名，症状是「[算法名] 服务不可达」。本机模式必须设成 `http://127.0.0.1:8999`（设置→智能算法→保存地址，或直接改 patrol_dict）。判据：`POST /api/patrol/algo/1/test` 的 `ok` 要为 true。
- **同一类坑的第三处：`patrol_algo.endpoint`**。它优先于全局 `yolo_url`，历史值也是 `http://yolo-service:8999`；不改的话症状是"识别跑了但 YOLO 结果为空"（`yolo=""` 而不是 `[]`），看起来像 YOLO 没生效。本机模式全部改成 `http://127.0.0.1:8999`。排查口诀：**凡是库里存的、指向 `*-service` 的名字，本机模式下都解析不了**。
- **`/v1/ocr_detect` 目前只是 `/v1/detect` 的别名**（`yolo_service.py` 里两个路由叠在同一个 handler 上），跑的仍是 `yolov8n.pt` 通用目标检测，**没有 OCR 实现**。所以"文字/数字"场景靠 YOLO 是检不出东西的，真正读数的是 VLM。要做真 OCR 得另接模型（可把该算法的 `endpoint` 指向 OCR 服务）。
- `PatrolGenericService.save` 的写入约定：**字段缺失或 null = 不动该列；空串 = 显式置 NULL**。前端要清空某个外键（如识别方案的 `algoId`）必须传 `''`，不能传 `null`。反向约束：**前端不能把界面态字段（mode/kbIds）直接 `{...form}` 提交**，会拼出不存在的列让 SQL 报 `Unknown column`。
- ZLM 的 hook 指向 `host.docker.internal:18978`（容器回连本机 jar）；本机 jwk 在 `config/jwk.json`（与 docker/wvp/config/jwk.json 不通用）。
- **Docker 引擎起不来先查数据盘锁**：磁盘管理里若有一块 Location 为 `...docker_data.vhdx` 的 `Msft Virtual Disk`，说明 vdisk 被残留挂载（diskpart attach 未 detach），WSL 会报 `ERROR_SHARING_VIOLATION`。跑 `scripts\fix-docker-vhdx-lock.bat`（需管理员）。
- 批处理脚本**必须纯 ASCII + CRLF**：`chcp 65001` 救不了 `rem` 里的中文，cmd 会用 GBK 解析 UTF-8 字节，把注释行当命令执行；`java -jar` 不展开通配符，jar 路径要用 `for` 解析。
- 注意：`docker compose` 必须在能找到 `docker/docker-compose.yml` 的目录执行（仓库根加 `-f`）；Git Bash 里 curl 发中文 JSON 会变 GBK——用 UTF-8 文件 + `--data-binary @file`。
- 登录接口是 **GET** `/api/user/login?username=&password=<32位md5>`（前端 `store/auth.ts` 已按 GET 实现）；用 POST 会返回 400「参数或方法错误」。

## 已知部署形态限制
- 容器版 WVP（`--profile container-full`）在 Docker/WSL2 下国标 SIP INVITE（点播/回放/云台-国标路）会被 NAT 挡，Linux host 网络才通；**当前混合模式（jar 直跑宿主机）不受此限，国标点播已实测可用**。RTSP 拉流两条路线都不受影响。
- 局域网访问需按 `doc/智能巡检重构/服务器部署配置清单.md` 配 stream_ip / Stream_IP / 防火墙。

## 架构规范（强制）
**写任何后端代码前先读 `doc/智能巡检重构/后端架构规范.md`**（§1-8 基础规范，§9 吸收自阿里 Java 开发手册/Effective Java/Spring 官方/Sonar），要点：
1. 构造注入（`private final` + `@RequiredArgsConstructor`），禁止字段注入。
2. 同类业务一个核心方法、多个薄入口委托；禁止复制胶水（先搜现有方法）。
3. Controller ≤30 行无业务逻辑；厂商差异走 `ProtocolAdapter` 策略+注册表，核心流程禁 if-else。
4. JDK21：固定形状 DTO 用 record；SQL/JSON 模板用 text block；策略族用 sealed+模式匹配。
5. **事务只包短而原子的多表写**；禁止横跨抓帧/AI 推理/HTTP 等慢 IO；注意自调用失效（§9-T1）。
6. 禁 `SimpleDateFormat`，用 `java.time`；线程池显式参数创建（§9-T2）。
7. 运行状态以事实源为准：拉流=ZLM getMediaList（`/api/patrol/access/stream-online`），录像=wvp_cloud_record；WVP 库里的 pulling/gbStatus 会失真。
8. AI 检测只走统一入口 `PatrolOrchestrator`（REST 统一入口 `/api/patrol/ai/analyze`），禁止第二套识别逻辑。
9. 数据关联铁律与级联删除：见 `doc/智能巡检重构/数据关系与模块业务说明.md`。
10. 新表/字段同步 `数据库/2.7.4/patrol-初始化.sql` 与 `patrol-升级.sql`。

## 前端铁律（web-react，踩过的坑，别重犯）
0. **导航结构（别再改回左栏）**：作业页（视频监控/机器人监控/无人机监控/录像回放/巡检任务/任务执行/巡检结果/任务报告/告警管理/查询统计）全部在**顶部栏**，由 `src/layout/navItems.ts` 的 `MAIN_NAV` 单一配置驱动；`MonitorLayout`/`PatrolLayout` 已退化为只渲染 `<Outlet/>` 的容器（**不要在分区 Layout 里再建左栏**，也不要重新引入 `<Nav mode="horizontal">` 两级的旧结构）。配置页留在 `/settings/*` 的独立左栏（`.app-sider`，只给 SettingsLayout 用）。路由与权限模型未变，新增页面要同时登记到 `MAIN_NAV` 与 `router.tsx`。
1. **`api/http.ts` 的 `unwrap()` 会把响应键递归转成 camelCase**（`ws_flv` → `wsFlv`）。因此后端返回的下划线字段到组件里已经改名；读取时必须两种都认（参考 `VideoPlayer.pickWsFlv`）。这条曾导致播放器守卫 `if (!streamInfo.ws_flv) return` 静默返回——格子纯黑、无报错、连 `video` 元素都不创建。
2. **Semi 2.x 组件回调签名变了**：`Tree.onSelect(selectKey, bool, node)` 节点在**第 3 个参数**（`onDoubleClick(e, node)` 是第 2 个）。旧代码读第 2 参上的 `nodeData` 会让整个树点击失效。改 Semi 组件回调前先在 `node_modules/@douyinfe/semi-ui/lib/es/<组件>/index.js` 里确认实参顺序。
3. `mpegts.createPlayer(...).attachMediaElement(el)` 必须传**真实 `HTMLMediaElement`**（自己 `createElement('video')`），传 `div` 会在 `load()` 抛 `c.load is not a function`；且必须 `video.muted = true`，否则被浏览器自动播放策略拒绝。
4. Jessibuca 的 `decoder` 默认取**相对当前页面**的 `decoder.js`（`/monitor` 路由下会 404 到 index.html，报 `Unexpected token '<'`），必须显式传 `decoder: '/static/js/jessibuca/decoder.js'`（与 decoder.wasm 同目录）。
5. **前端产物打进 nginx 镜像**（`docker/nginx/Dockerfile` 里 `COPY src/main/resources/static /opt/dist`，不是挂载卷）：改前端只重建 nginx 无效，必须 `npm run build` → `docker compose build polaris-nginx` → `up -d --force-recreate polaris-nginx`，否则浏览器还在跑旧 chunk。
6. 后台标签页里 Chrome 会因省电暂停 video-only 媒体（`AbortError: ... paused to save power`），用无头/后台标签验证播放会误判；以 ZLM `getMediaList` 的 `readerCount` + 前台截图为准。

## 已知部署形态限制
- 容器版 WVP（`--profile container-full`）在 Docker/WSL2 下国标 SIP INVITE（点播/回放/云台-国标路）会被 NAT 挡，Linux host 网络才通；**当前混合模式（jar 直跑宿主机）不受此限，国标点播已实测可用**。RTSP 拉流两条路线都不受影响。
- **Docker 发布的端口在本机只有 `127.0.0.1` 通**，物理网卡 IP（192.168.0.100 / 192.168.31.40）一律超时；本机进程（java 18978/5060）在物理 IP 上正常。所以局域网其它电脑目前用不了（9080/8081 都连不上），要支持需另做（放行防火墙入站，或把对外入口也搬本机）。
- 海康 iDS-MCD20M 这台 PVR **疑似同一时刻只允许一路取流**：RTSP 拉流在跑时再点国标点播会返回 `code:500`。两路别同时播。
