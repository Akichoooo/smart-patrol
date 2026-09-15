-- =====================================================================
-- 智能巡检平台 patrol 模块初始化 SQL（MySQL 8, WVP 2.7.4 扩展）
-- 全部表前缀 patrol_，不改动 WVP 原有表；可整体 DROP 回滚。
-- =====================================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. 权限与审计（P1.5 安全底座）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patrol_role_permission` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL COMMENT '角色ID(关联wvp_user_role.id)',
  `module` VARCHAR(64) NOT NULL COMMENT '模块编码 如 monitor.video / patrol.alarm / settings.ai',
  `actions_json` VARCHAR(512) NOT NULL DEFAULT '["view"]' COMMENT '操作列表 view/create/edit/delete/execute/export/review/confirm',
  UNIQUE KEY `uk_role_module` (`role_id`, `module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色模块与操作权限';

CREATE TABLE IF NOT EXISTS `patrol_role_data_scope` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL,
  `scope_type` VARCHAR(16) NOT NULL DEFAULT 'ALL' COMMENT 'ALL/REGION/GROUP/CHANNEL',
  `scope_json` TEXT COMMENT '区划/分组/通道 id 列表 JSON',
  UNIQUE KEY `uk_role_scope` (`role_id`, `scope_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色数据权限';

CREATE TABLE IF NOT EXISTS `patrol_role_channel_permission` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL,
  `channel_id` INT DEFAULT NULL COMMENT '通道ID(为空则按组)',
  `channel_group_id` INT DEFAULT NULL COMMENT '业务分组ID',
  `funcs_json` VARCHAR(256) NOT NULL DEFAULT '["view"]' COMMENT 'view/ptz/preset/playback/download/snapshot/talk/record',
  KEY `idx_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='摄像头功能级权限';

CREATE TABLE IF NOT EXISTS `patrol_uri_permission` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `uri_pattern` VARCHAR(128) NOT NULL COMMENT 'Ant风格 /api/front-end/ptz/*/**',
  `http_method` VARCHAR(8) DEFAULT 'ANY',
  `module` VARCHAR(64) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `channel_param` VARCHAR(64) DEFAULT NULL COMMENT '从哪个路径变量/参数取channelId',
  `audit_only` TINYINT(1) DEFAULT 0 COMMENT '1=仅审计不拦截',
  KEY `idx_uri` (`uri_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='WVP接口URI→权限映射(保护WVP老接口)';

CREATE TABLE IF NOT EXISTS `patrol_audit_log` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `username` VARCHAR(64),
  `module` VARCHAR(64),
  `action` VARCHAR(64),
  `target_type` VARCHAR(64) DEFAULT NULL,
  `target_id` VARCHAR(64) DEFAULT NULL,
  `target_name` VARCHAR(255) DEFAULT NULL,
  `http_method` VARCHAR(8),
  `uri` VARCHAR(255),
  `params_json` TEXT COMMENT '脱敏后的参数',
  `ip` VARCHAR(64),
  `user_agent` VARCHAR(255),
  `result` VARCHAR(16) DEFAULT 'SUCCESS' COMMENT 'SUCCESS/FAIL/DENIED',
  `error_msg` VARCHAR(512) DEFAULT NULL,
  `trace_id` VARCHAR(64) DEFAULT NULL,
  `duration_ms` BIGINT DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_user_time` (`user_id`, `created_at`),
  KEY `idx_module` (`module`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志';

-- ---------------------------------------------------------------------
-- 2. 协议与装备（P4）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patrol_protocol_template` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `protocol_type` VARCHAR(32) NOT NULL DEFAULT 'HTTP_REST' COMMENT 'HTTP_REST/MQTT/TCP/GRPC/DDS',
  `vendor` VARCHAR(64) DEFAULT NULL,
  `config_json` MEDIUMTEXT COMMENT 'endpoints/auth/events/media 配置',
  `capabilities_json` VARCHAR(1024) DEFAULT '[]',
  `version` INT DEFAULT 1,
  `enabled` TINYINT(1) DEFAULT 1,
  `builtin` TINYINT(1) DEFAULT 0 COMMENT '内置预设',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='协议模板';

CREATE TABLE IF NOT EXISTS `patrol_device_profile` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `vendor` VARCHAR(64) NOT NULL,
  `model` VARCHAR(64) NOT NULL,
  `asset_type` VARCHAR(32) NOT NULL DEFAULT 'ROBOT_DOG' COMMENT 'ROBOT_DOG/DRONE/CAMERA/SENSOR/GATE',
  `capabilities_json` VARCHAR(1024) DEFAULT '[]',
  `default_template_id` INT DEFAULT NULL,
  `default_capture_json` VARCHAR(1024) DEFAULT NULL COMMENT '默认采集动作 CaptureAction JSON',
  `enabled` TINYINT(1) DEFAULT 1,
  `remark` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_vendor_model` (`vendor`, `model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='装备档案(新增型号零代码)';

CREATE TABLE IF NOT EXISTS `patrol_robot_device` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `type` VARCHAR(16) NOT NULL DEFAULT 'ROBOT_DOG' COMMENT 'ROBOT_DOG/DRONE',
  `vendor` VARCHAR(64) DEFAULT NULL,
  `model` VARCHAR(64) DEFAULT NULL,
  `profile_id` INT DEFAULT NULL,
  `template_id` INT DEFAULT NULL,
  `connection_json` TEXT COMMENT '连接信息(密钥用secret://引用)',
  `status` VARCHAR(16) DEFAULT 'OFFLINE' COMMENT 'ONLINE/OFFLINE/UNKNOWN',
  `last_heartbeat` DATETIME DEFAULT NULL,
  `capabilities_json` VARCHAR(1024) DEFAULT '[]',
  `enabled` TINYINT(1) DEFAULT 1,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='机器人/无人机设备';

CREATE TABLE IF NOT EXISTS `patrol_waypoint` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `area` VARCHAR(128) DEFAULT NULL COMMENT '区域(如 主厂房B2)',
  `interval_name` VARCHAR(128) DEFAULT NULL COMMENT '设备间隔',
  `device_name` VARCHAR(128) DEFAULT NULL COMMENT '设备(被巡对象)',
  `part_name` VARCHAR(64) DEFAULT NULL COMMENT '部件(指示灯/表计/空开)',
  `type` VARCHAR(32) DEFAULT 'POINT' COMMENT '点位类型',
  `map_x` DOUBLE DEFAULT NULL,
  `map_y` DOUBLE DEFAULT NULL,
  `map_z` DOUBLE DEFAULT NULL,
  `edge_code` VARCHAR(64) DEFAULT NULL COMMENT '边缘侧编码(下发用)',
  `capture_channel_id` INT DEFAULT NULL COMMENT '绑定的WVP固定摄像机通道',
  `capture_mode` VARCHAR(16) DEFAULT 'PHOTO' COMMENT 'PHOTO/VIDEO/AUDIO/POINTCLOUD',
  `capture_source` VARCHAR(32) DEFAULT 'ONBOARD_CAMERA' COMMENT 'ONBOARD_CAMERA/FIXED_CHANNEL/PAYLOAD',
  `sort` INT DEFAULT 0,
  `enabled` TINYINT(1) DEFAULT 1,
  `remark` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_area` (`area`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='巡检点位';

CREATE TABLE IF NOT EXISTS `patrol_route` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `robot_device_id` INT DEFAULT NULL,
  `waypoint_ids_json` TEXT COMMENT '有序点位id列表',
  `description` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_device` (`robot_device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='航线(点位序列预设)';

-- ---------------------------------------------------------------------
-- 3. AI 配置（P3）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patrol_algo` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `engine` VARCHAR(32) DEFAULT 'YOLO',
  `endpoint` VARCHAR(255) DEFAULT NULL COMMENT '推理服务地址(如 http://yolo-service:8999)',
  `file_path` VARCHAR(255) DEFAULT NULL COMMENT '模型权重文件',
  `labels_json` TEXT,
  `version` VARCHAR(32) DEFAULT '1',
  `status` VARCHAR(16) DEFAULT 'ENABLED',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='算法(YOLO)';

CREATE TABLE IF NOT EXISTS `patrol_vlm_model` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `provider` VARCHAR(32) DEFAULT 'sensenova',
  `base_url` VARCHAR(255) NOT NULL,
  `api_key_enc` VARCHAR(512) DEFAULT NULL COMMENT 'AES加密存储，不落明文',
  `model` VARCHAR(128) NOT NULL,
  `model_fallback` VARCHAR(128) DEFAULT NULL,
  `protocol` VARCHAR(32) DEFAULT 'chat_completions' COMMENT 'chat_completions/responses/anthropic',
  `params_json` VARCHAR(1024) DEFAULT NULL COMMENT '供应商透传参数，如 {"thinking":{"type":"disabled"}} 关闭推理模型思考',
  `status` VARCHAR(16) DEFAULT 'ENABLED',
  `latency_ms` INT DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='VLM多模态模型';

CREATE TABLE IF NOT EXISTS `patrol_prompt` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `scene` VARCHAR(64) DEFAULT 'general' COMMENT '场景 meter/indicator_light/switch_status/text_digit/general',
  `content` TEXT NOT NULL,
  `variables_json` VARCHAR(512) DEFAULT NULL,
  `version` INT DEFAULT 1,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提示词模板';

CREATE TABLE IF NOT EXISTS `patrol_knowledge_base` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(512) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识库';

CREATE TABLE IF NOT EXISTS `patrol_knowledge_doc` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `kb_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content` MEDIUMTEXT,
  `embedding_ref` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `doc_type` VARCHAR(16) NOT NULL DEFAULT 'TEXT' COMMENT '条目类型 TEXT=文本 RULE=结构化规则',
  `metric` VARCHAR(128) DEFAULT NULL COMMENT '约束对象/指标，如 屏幕温度读数',
  `rule_kind` VARCHAR(16) DEFAULT NULL COMMENT 'RANGE=数值范围 EXPECT=期望值 TIME_WINDOW=时间窗口',
  `min_val` DECIMAL(12,3) DEFAULT NULL,
  `max_val` DECIMAL(12,3) DEFAULT NULL,
  `unit` VARCHAR(16) DEFAULT NULL,
  `expect_value` VARCHAR(255) DEFAULT NULL COMMENT '期望值/期望描述',
  `severity` VARCHAR(8) DEFAULT 'medium' COMMENT 'high/medium/low',
  `action` VARCHAR(16) DEFAULT 'ALARM' COMMENT 'ALARM=告警 REVIEW=转人工 INFO=仅提示',
  KEY `idx_kb` (`kb_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识库条目（文本知识 / 结构化判定规则）';

CREATE TABLE IF NOT EXISTS `patrol_identify_scheme` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(512) DEFAULT NULL,
  `algo_id` INT DEFAULT NULL,
  `vlm_model_id` INT DEFAULT NULL,
  `prompt_id` INT DEFAULT NULL,
  `kb_ids_json` VARCHAR(512) DEFAULT '[]',
  `vlm_enabled` TINYINT(1) DEFAULT 1 COMMENT '是否VLM复核',
  `threshold` DECIMAL(4,2) DEFAULT 0.60,
  `roi_json` VARCHAR(512) DEFAULT NULL,
  `risk_level` VARCHAR(16) DEFAULT 'medium' COMMENT 'low/medium/high',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='识别方案(一键套用)';

CREATE TABLE IF NOT EXISTS `patrol_analyzer` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `type` VARCHAR(32) NOT NULL COMMENT 'yolo/vlm/ocr/audio/video/pointcloud',
  `modality` VARCHAR(16) DEFAULT 'IMAGE',
  `engine` VARCHAR(32),
  `endpoint` VARCHAR(255),
  `params_json` VARCHAR(1024) DEFAULT NULL,
  `enabled` TINYINT(1) DEFAULT 1,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分析器注册表(多模态可插拔)';

-- ---------------------------------------------------------------------
-- 4. 任务与执行（P5）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patrol_task` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `type` VARCHAR(16) DEFAULT 'ROUTINE' COMMENT 'ROUTINE例行/SILENT静默/LINKAGE联动',
  `robot_device_id` INT DEFAULT NULL,
  `priority` VARCHAR(8) DEFAULT '1' COMMENT '1级/2级/3级',
  `creator` VARCHAR(64) DEFAULT NULL,
  `time_plans_json` TEXT COMMENT '时间方案 cron/时刻列表',
  `default_scheme_id` INT DEFAULT NULL,
  `enabled` TINYINT(1) DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_device` (`robot_device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='巡检任务';

CREATE TABLE IF NOT EXISTS `patrol_task_point` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` INT NOT NULL,
  `waypoint_id` INT NOT NULL,
  `seq` INT DEFAULT 0,
  `capture_mode` VARCHAR(16) DEFAULT 'PHOTO',
  `scheme_id` INT DEFAULT NULL COMMENT '为空用任务默认方案',
  `params_json` VARCHAR(1024) DEFAULT NULL COMMENT 'ROI/阈值覆盖',
  KEY `idx_task` (`task_id`),
  KEY `idx_waypoint` (`waypoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务点位';

CREATE TABLE IF NOT EXISTS `patrol_task_execution` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` INT NOT NULL,
  `device_id` INT DEFAULT NULL,
  `status` VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/RUNNING/PAUSED/FINISHED/STOPPED/FAILED',
  `progress` INT DEFAULT 0 COMMENT '0-100',
  `trigger_type` VARCHAR(16) DEFAULT 'MANUAL' COMMENT 'MANUAL/SCHEDULED',
  `total_points` INT DEFAULT 0,
  `finished_points` INT DEFAULT 0,
  `abnormal_points` INT DEFAULT 0,
  `error_msg` VARCHAR(512) DEFAULT NULL,
  `started_at` DATETIME DEFAULT NULL,
  `finished_at` DATETIME DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_task` (`task_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务执行实例';

CREATE TABLE IF NOT EXISTS `patrol_media` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `execution_id` INT DEFAULT NULL,
  `point_result_id` INT DEFAULT NULL,
  `type` VARCHAR(16) DEFAULT 'PHOTO' COMMENT 'PHOTO/VIDEO',
  `file_name` VARCHAR(255),
  `path` VARCHAR(512) COMMENT '存储相对路径',
  `url` VARCHAR(512),
  `size` BIGINT DEFAULT 0,
  `width` INT DEFAULT NULL,
  `height` INT DEFAULT NULL,
  `source` VARCHAR(32) DEFAULT 'ROBOT' COMMENT 'ROBOT/FIXED_CHANNEL/MANUAL',
  `captured_at` DATETIME DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_exec` (`execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='巡检媒体';

CREATE TABLE IF NOT EXISTS `patrol_point_result` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `execution_id` INT DEFAULT NULL COMMENT '执行实例ID(手动识别/推模式为空)',
  `task_id` INT DEFAULT NULL COMMENT '任务ID(手动识别/推模式为空)',
  `task_point_id` INT DEFAULT NULL,
  `waypoint_id` INT DEFAULT NULL,
  `waypoint_name` VARCHAR(128),
  `media_id` INT DEFAULT NULL,
  `scheme_id` INT DEFAULT NULL,
  `yolo_json` TEXT,
  `vlm_json` TEXT,
  `result` VARCHAR(16) DEFAULT 'ANALYZING' COMMENT 'NORMAL/ABNORMAL/ANALYZING/FAILED',
  `identify_type` VARCHAR(64) DEFAULT NULL COMMENT '识别类型(指示灯/空开/表计)',
  `identify_sub_type` VARCHAR(64) DEFAULT NULL,
  `defect_type` VARCHAR(64) DEFAULT NULL,
  `confidence` DECIMAL(5,2) DEFAULT NULL,
  `anomaly_reason` VARCHAR(512) DEFAULT NULL,
  `process_note` VARCHAR(512) DEFAULT NULL COMMENT '流程记录(等待上报/分析中…)',
  `review_status` VARCHAR(32) DEFAULT 'PENDING' COMMENT 'PENDING待人工确认/CONFIRMED_NORMAL/CONFIRMED_ABNORMAL',
  `reviewed_by` VARCHAR(64) DEFAULT NULL,
  `review_note` VARCHAR(512) DEFAULT NULL COMMENT '误识别原因/审核说明',
  `reviewed_at` DATETIME DEFAULT NULL,
  `captured_at` DATETIME DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_exec` (`execution_id`),
  KEY `idx_result` (`result`),
  KEY `idx_review` (`review_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='点位识别结果';

CREATE TABLE IF NOT EXISTS `patrol_point_reading` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `point_result_id` INT NOT NULL,
  `waypoint_id` INT DEFAULT NULL,
  `reading_key` VARCHAR(64) NOT NULL COMMENT '读数项(如 压力/温度/液位)',
  `value_num` DOUBLE DEFAULT NULL,
  `value_text` VARCHAR(128) DEFAULT NULL,
  `unit` VARCHAR(32) DEFAULT NULL,
  `confidence` DECIMAL(5,2) DEFAULT NULL,
  `recorded_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_point_key` (`waypoint_id`, `reading_key`),
  KEY `idx_result` (`point_result_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='结构化读数(曲线分析数据源)';

CREATE TABLE IF NOT EXISTS `patrol_alarm` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `alarm_no` VARCHAR(32) DEFAULT NULL,
  `point_result_id` INT DEFAULT NULL,
  `task_id` INT DEFAULT NULL,
  `execution_id` INT DEFAULT NULL,
  `waypoint_name` VARCHAR(128) DEFAULT NULL,
  `channel_id` INT DEFAULT NULL COMMENT '关联WVP通道(看监控画面用)',
  `source` VARCHAR(16) DEFAULT 'INSPECT' COMMENT 'INSPECT巡视/DEVICE设备/MONITOR静默/COMPARE对比',
  `level` VARCHAR(16) DEFAULT 'GENERAL' COMMENT 'GENERAL/SERIOUS/DANGER',
  `description` VARCHAR(512) DEFAULT NULL,
  `identify_type` VARCHAR(64) DEFAULT NULL,
  `identify_sub_type` VARCHAR(64) DEFAULT NULL,
  `anomaly_reason` VARCHAR(512) DEFAULT NULL,
  `media_id` INT DEFAULT NULL,
  `status` VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING待确认/DISPATCHED已派单/CLOSED已归档/FALSE_POSITIVE误报',
  `dispatch_json` VARCHAR(1024) DEFAULT NULL COMMENT '派单信息(责任人/优先级/说明/单号)',
  `confirmed_by` VARCHAR(64) DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `recovered_at` DATETIME DEFAULT NULL,
  `silenced_until` DATETIME DEFAULT NULL COMMENT '免打扰截止',
  `alarm_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_status` (`status`),
  KEY `idx_time` (`alarm_time`),
  KEY `idx_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='巡检告警';

-- ---------------------------------------------------------------------
-- 5. 其他（检修区域/通知/字典/报告）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patrol_maintenance_area` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `area_json` TEXT COMMENT '区划/分组/点位 id 列表',
  `start_at` DATETIME,
  `end_at` DATETIME,
  `status` VARCHAR(16) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/EXPIRED/DISABLED',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='检修区域(抑制告警)';

CREATE TABLE IF NOT EXISTS `patrol_notification` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL COMMENT '为空=全体',
  `title` VARCHAR(255) NOT NULL,
  `content` VARCHAR(1024),
  `type` VARCHAR(32) DEFAULT 'ALARM' COMMENT 'ALARM/TASK/SYSTEM',
  `biz_id` BIGINT DEFAULT NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_user_read` (`user_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';

CREATE TABLE IF NOT EXISTS `patrol_dict` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` VARCHAR(64) NOT NULL COMMENT 'identify_type/point_type/alarm_level',
  `code` VARCHAR(64) NOT NULL,
  `label` VARCHAR(128) NOT NULL,
  `sort` INT DEFAULT 0,
  `enabled` TINYINT(1) DEFAULT 1,
  UNIQUE KEY `uk_type_code` (`type`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='字典';

-- =====================================================================
-- 初始数据
-- =====================================================================

-- 角色权限：admin(角色1) 全权限由代码兜底，这里给"运维员"角色(如存在)示例
INSERT IGNORE INTO `patrol_role_data_scope` (`role_id`, `scope_type`, `scope_json`) VALUES (1, 'ALL', NULL);

-- WVP 关键接口 URI→权限映射（保护 + 审计）
INSERT INTO `patrol_uri_permission` (`uri_pattern`, `http_method`, `module`, `action`, `channel_param`, `audit_only`) VALUES
('/api/front-end/ptz/*/**', 'ANY', 'monitor.video', 'ptz', 'channelId', 0),
('/api/front-end/preset/*/**', 'ANY', 'monitor.video', 'preset', 'channelId', 0),
('/api/front-end/cruise/*/**', 'ANY', 'monitor.video', 'preset', 'channelId', 0),
('/api/front-end/scan/*/**', 'ANY', 'monitor.video', 'preset', 'channelId', 0),
('/api/front-end/wiper/**', 'ANY', 'monitor.video', 'preset', 'channelId', 0),
('/api/common/channel/front-end/**', 'ANY', 'monitor.video', 'ptz', 'channelId', 0),
('/api/play/start/**', 'ANY', 'monitor.video', 'view', 'channelId', 0),
('/api/play/stop/**', 'ANY', 'monitor.video', 'view', 'channelId', 0),
('/api/playback/**', 'ANY', 'monitor.video', 'playback', 'channelId', 0),
('/api/gb_record/download/**', 'ANY', 'monitor.video', 'download', 'channelId', 0),
('/api/play/snap/**', 'ANY', 'monitor.video', 'snapshot', 'channelId', 0),
('/api/common/channel/add', 'ANY', 'settings.access', 'create', NULL, 0),
('/api/common/channel/update', 'ANY', 'settings.access', 'edit', NULL, 0),
('/api/common/channel/reset', 'ANY', 'settings.access', 'edit', NULL, 0),
('/api/device/query/devices', 'ANY', 'settings.access', 'view', NULL, 1),
('/api/device/add', 'ANY', 'settings.access', 'create', NULL, 0),
('/api/device/update/**', 'ANY', 'settings.access', 'edit', NULL, 0),
('/api/device/delete/**', 'ANY', 'settings.access', 'delete', NULL, 0),
('/api/region/**', 'ANY', 'settings.org', 'edit', NULL, 1),
('/api/group/**', 'ANY', 'settings.org', 'edit', NULL, 1),
('/api/platform/**', 'ANY', 'settings.media', 'edit', NULL, 1),
('/api/server/media_server/**', 'ANY', 'settings.media', 'edit', NULL, 1),
('/api/push/**', 'ANY', 'settings.access', 'edit', NULL, 1),
('/api/proxy/**', 'ANY', 'settings.access', 'edit', NULL, 1),
('/api/user/**', 'ANY', 'settings.security', 'edit', NULL, 0),
('/api/role/**', 'ANY', 'settings.security', 'edit', NULL, 0),
('/api/userApiKey/**', 'ANY', 'settings.security', 'edit', NULL, 1),
('/api/record/plan/**', 'ANY', 'settings.media', 'edit', NULL, 1);

-- 内置协议模板：4 厂商预设 + 3 通用模板（内置，可停用不可删）
INSERT INTO `patrol_protocol_template` (`name`, `protocol_type`, `vendor`, `config_json`, `capabilities_json`, `builtin`, `enabled`) VALUES
('大疆上云API(Dock2)', 'MQTT', 'dji', '{}', '["status","startTask","pauseTask","resumeTask","stopTask","gotoWaypoint","capturePhoto","startVideo","stopVideo","setPtz","returnHome","getMediaList","subscribeEvents"]', 1, 0),
('云深处 Station OpenAPI', 'HTTP_REST', 'deeprobotics', '{"connection":{"baseUrl":"http://station.local","timeoutMs":15000},"auth":{"mode":"APPKEY_SIGNATURE"},"endpoints":{"status":{"method":"POST","path":"/remoteApi/getDogStateData","readOnly":true},"startTask":{"method":"POST","path":"/remoteApi/issue","idempotent":false},"pauseTask":{"method":"POST","path":"/remoteApi/taskCtrl","payload":"{\\"command\\":\\"2\\"}"},"resumeTask":{"method":"POST","path":"/remoteApi/taskCtrl","payload":"{\\"command\\":\\"3\\"}"},"stopTask":{"method":"POST","path":"/remoteApi/taskCtrl","payload":"{\\"command\\":\\"4\\"}"},"gotoWaypoint":{"method":"POST","path":"/remoteApi/setPosToDog"},"returnHome":{"method":"POST","path":"/remoteApi/chargeCtrl"},"setPtz":{"method":"POST","path":"/remoteApi/cameraCtrl"},"getMediaList":{"method":"POST","path":"/remoteApi/taskPointResultPage","readOnly":true}},"media":{"video":{"protocol":"RTSP"},"files":{"protocol":"PULL"}}}', '["status","startTask","pauseTask","resumeTask","stopTask","gotoWaypoint","capturePhoto","setPtz","returnHome","getMediaList"]', 1, 1),
('宇树 Unitree Go2/B2', 'DDS', 'unitree', '{}', '["status","capturePhoto","setPtz"]', 1, 0),
('波士顿动力 Spot', 'GRPC', 'bostondynamics', '{}', '["status","startTask","pauseTask","resumeTask","stopTask","gotoWaypoint","capturePhoto","startVideo","stopVideo","setPtz","returnHome","getMediaList","subscribeEvents"]', 1, 0),
('通用HTTP模板', 'HTTP_REST', 'generic', '{"connection":{"baseUrl":"","timeoutMs":10000},"endpoints":{}}', '["status","startTask","stopTask","getMediaList"]', 1, 1),
('通用MQTT模板', 'MQTT', 'generic', '{"connection":{"broker":"","port":1883},"topics":{}}', '["status","subscribeEvents"]', 1, 1),
('通用TCP模板', 'TCP', 'generic', '{"connection":{"host":"","port":0}}', '[]', 1, 1);

-- 装备档案示例（型号未定占位：可先注册，后续只改配置）
INSERT INTO `patrol_device_profile` (`vendor`, `model`, `asset_type`, `capabilities_json`, `default_template_id`, `default_capture_json`, `enabled`, `remark`) VALUES
('deeprobotics', 'X30', 'ROBOT_DOG', '["gotoWaypoint","capturePhoto","returnHome","setPtz"]', 2, '{"mode":"PHOTO","source":"ONBOARD_CAMERA"}', 1, '云深处 X30 巡检机器狗(内置预设)'),
('unitree', 'Go2', 'ROBOT_DOG', '["capturePhoto","setPtz"]', 3, '{"mode":"PHOTO","source":"ONBOARD_CAMERA"}', 1, '宇树 Go2(无官方航点,能力协商禁用gotoWaypoint)'),
('placeholder', '待定型号', 'ROBOT_DOG', '["status","startTask","stopTask"]', 5, '{"mode":"PHOTO","source":"ONBOARD_CAMERA"}', 1, '型号未定占位档案,确定后替换配置即可'),
('dji', 'Dock2+M3D', 'DRONE', '["startTask","capturePhoto","returnHome","getMediaList"]', 1, '{"mode":"PHOTO","source":"PAYLOAD"}', 1, '大疆机场2+Matrice3D'),
('placeholder', '待定无人机', 'DRONE', '["status","startTask","stopTask"]', 5, '{"mode":"PHOTO","source":"PAYLOAD"}', 1, '无人机型号占位');

-- 分析器注册
INSERT INTO `patrol_analyzer` (`name`, `type`, `modality`, `engine`, `endpoint`, `params_json`, `enabled`) VALUES
('YOLO目标检测', 'yolo', 'IMAGE', 'YOLO', NULL, '{"conf":0.25}', 1),
('YOLO-OCR文字数字', 'ocr', 'IMAGE', 'YOLO', NULL, '{"conf":0.6}', 1),
('云端VLM复核', 'vlm', 'IMAGE', 'OPENAI_COMPAT', NULL, NULL, 1),
('声纹分析(占位)', 'audio', 'AUDIO', 'RESERVED', NULL, NULL, 0),
('点云分析(占位)', 'pointcloud', 'POINTCLOUD', 'RESERVED', NULL, NULL, 0);

-- 字典
INSERT INTO `patrol_dict` (`type`, `code`, `label`, `sort`) VALUES
('identify_type', 'indicator_light', '指示灯/闪烁灯', 1),
('identify_type', 'switch_status', '空开状态', 2),
('identify_type', 'meter_reading', '表计读数', 3),
('identify_type', 'text_digit', '文字/数字OCR', 4),
('identify_type', 'safety', '区域违规安全事件', 5),
('identify_type', 'general', '通用外观巡检', 6),
('alarm_level', 'GENERAL', '一般告警', 1),
('alarm_level', 'SERIOUS', '严重告警', 2),
('alarm_level', 'DANGER', '危险告警', 3),
('point_type', 'POINT', '普通点位', 1),
('task_type', 'ROUTINE', '例行巡视', 1),
('task_type', 'SILENT', '静默任务', 2),
('task_type', 'LINKAGE', '联动任务', 3);

-- 提示词初始模板
INSERT INTO `patrol_prompt` (`name`, `scene`, `content`, `variables_json`) VALUES
('表计读数识别提示词', 'meter', '你是一名电力设备巡检专家。请仔细观察照片中的表计(压力表/温度表/液位计等)，按以下JSON输出：{"reading":{"value":数值,"unit":"单位","confidence":0-1},"anomaly":true/false,"confidence":0-1(你对判定的把握度),"reason":"异常或正常原因"}。如果读数超出常见量程或指针卡死，判定异常。', '["量程说明"]'),
('指示灯状态提示词', 'indicator_light', '你是电力设备巡检专家。请识别照片中设备指示灯的状态(运行/停止/告警/闪烁)，按JSON输出：{"lights":[{"name":"灯名","status":"green/red/yellow/off/flashing","anomaly":true/false}],"anomaly":true/false,"confidence":0-1(你对判定的把握度),"reason":"判定原因"}。红灯或异常闪烁需判定异常。', NULL),
('空开状态提示词', 'switch_status', '你是电力设备巡检专家。请识别照片中断路器/空开的分合闸状态，按JSON输出：{"switches":[{"name":"空开名称","state":"closed合闸/open分闸"}],"anomaly":true/false,"confidence":0-1(你对判定的把握度),"reason":"判定原因"}。与应有状态不符判定异常。', NULL),
('铭牌文字数字OCR提示词', 'text_digit', '你是工业设备巡检专家。请仔细识别照片中的铭牌/面板/标识牌上的文字与数字(设备编号、参数、警示语等)，按JSON输出：{"text":"识别出的完整文本","anomaly":true/false,"confidence":0-1(你对判定的把握度),"reason":"内容是否异常及原因"}。如果出现错别字、烧蚀、模糊不可读或与警示要求不符，判定异常。', NULL),
('通用设备外观巡检提示词', 'general', '你是工业设备巡检专家。请检查照片中设备外观是否正常(破损/渗漏/锈蚀/异物/放电痕迹)，按JSON输出：{"findings":[{"item":"发现项","anomaly":true/false}],"anomaly":true/false,"confidence":0-1(你对判定的把握度),"reason":"综合研判"}', NULL);

-- 识别方案 ↔ 提示词按场景一一对应（OCR 方案挂 text_digit 提示词，外观方案挂 general 提示词）
UPDATE `patrol_identify_scheme` SET `prompt_id` = (SELECT id FROM `patrol_prompt` WHERE `scene` = 'indicator_light' LIMIT 1) WHERE `name` LIKE '%指示灯%';
UPDATE `patrol_identify_scheme` SET `prompt_id` = (SELECT id FROM `patrol_prompt` WHERE `scene` = 'text_digit' LIMIT 1) WHERE `name` LIKE '%OCR%';
UPDATE `patrol_identify_scheme` SET `prompt_id` = (SELECT id FROM `patrol_prompt` WHERE `scene` = 'general' LIMIT 1) WHERE `name` LIKE '%外观%' OR `name` LIKE '%通用%';

-- =====================================================================
-- 录像设备（NVR/PVR，含"自研 NVR"=ZLM 录制）档案 + 摄像头挂载绑定
-- 挂载语义：RTSP 从 NVR 取流（通道号=NVR 侧通道号）、云台经 NVR 下发
-- =====================================================================
CREATE TABLE IF NOT EXISTS `patrol_nvr` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL COMMENT '录像设备名称',
  `vendor` VARCHAR(32) NOT NULL DEFAULT 'hik' COMMENT 'hik/dahua/univ/generic',
  `ip` VARCHAR(64) NOT NULL,
  `rtsp_port` INT DEFAULT 554 COMMENT 'RTSP 取流端口',
  `api_port` INT DEFAULT 80 COMMENT 'ISAPI/CGI 管理端口(云台/状态)',
  `username` VARCHAR(64) DEFAULT NULL,
  `password` VARCHAR(128) DEFAULT NULL,
  `channel_count` INT DEFAULT 16 COMMENT '通道容量',
  `region_civil_code` VARCHAR(64) DEFAULT NULL COMMENT '归属行政区划(国标编码)',
  `remark` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='录像设备(NVR)档案';

CREATE TABLE IF NOT EXISTS `patrol_nvr_camera` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `nvr_id` INT NOT NULL,
  `channel_id` INT NOT NULL COMMENT 'wvp_device_channel.id',
  `nvr_channel_no` INT NOT NULL DEFAULT 1 COMMENT 'NVR 侧通道号',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_channel` (`channel_id`),
  KEY `idx_nvr` (`nvr_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='摄像头挂载到录像设备的绑定';

CREATE TABLE IF NOT EXISTS `patrol_channel_storage` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `channel_id` INT NOT NULL COMMENT 'wvp_device_channel.id',
  `storage_type` VARCHAR(16) NOT NULL DEFAULT 'NONE' COMMENT 'ZLM本地存储节点/NVR厂商录像/NONE不录',
  `nvr_id` INT DEFAULT NULL COMMENT 'storage_type=NVR 时的录像设备',
  `nvr_channel_no` INT DEFAULT 1 COMMENT 'NVR 侧通道号',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_channel` (`channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='摄像机录像归属(ZLM存储节点/厂商NVR/不录)';
