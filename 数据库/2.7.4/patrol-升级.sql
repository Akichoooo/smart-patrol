-- =====================================================================
-- 智能巡检平台 patrol 模块升级脚本（按需执行，幂等）
-- =====================================================================
SET NAMES utf8mb4;

-- 推模式（设备直接回传媒体并分析）没有任务上下文，execution_id/task_id 允许为空
ALTER TABLE `patrol_point_result` MODIFY COLUMN `execution_id` INT NULL COMMENT '执行实例ID(推模式为空)';
ALTER TABLE `patrol_point_result` MODIFY COLUMN `task_id` INT NULL COMMENT '任务ID(推模式为空)';
ALTER TABLE `patrol_media` MODIFY COLUMN `execution_id` INT NULL COMMENT '执行实例ID(推模式为空)';
ALTER TABLE `patrol_media` MODIFY COLUMN `point_result_id` INT NULL COMMENT '点位结果ID(入库后回填)';
ALTER TABLE `patrol_alarm` MODIFY COLUMN `execution_id` INT NULL COMMENT '执行实例ID(推模式为空)';

-- 媒体存储抽象：记录存储类型与对象 key（本地/S3/FTP 三选一）
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patrol_media' AND COLUMN_NAME = 'storage_type');
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE `patrol_media` ADD COLUMN `storage_type` VARCHAR(16) DEFAULT ''local'' COMMENT ''local/s3/ftp''',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patrol_media' AND COLUMN_NAME = 'object_key');
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE `patrol_media` ADD COLUMN `object_key` VARCHAR(512) DEFAULT NULL COMMENT ''存储对象key(相对路径)''',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `patrol_media` SET `object_key` = `path` WHERE `object_key` IS NULL AND `path` IS NOT NULL;

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

-- =====================================================================
-- 摄像机「录像归属」：录像由谁负责（ZLM 本地存储节点 / 厂商 NVR / 不录）
-- 与 patrol_nvr_camera（取流+云台经 NVR 挂载）配合：
--   storage_type=NVR 时 nvr_id 同时表示"取流/云台走该 NVR"；ZLM 时仅平台录像
-- =====================================================================
CREATE TABLE IF NOT EXISTS `patrol_channel_storage` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `channel_id` INT NOT NULL COMMENT 'wvp_device_channel.id',
  `storage_type` VARCHAR(16) NOT NULL DEFAULT 'NONE' COMMENT 'ZLM本地存储节点/NVR厂商录像/NONE不录',
  `nvr_id` INT DEFAULT NULL COMMENT 'storage_type=NVR 时的录像设备',
  `nvr_channel_no` INT DEFAULT 1 COMMENT 'NVR 侧通道号',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_channel` (`channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='摄像机录像归属(ZLM存储节点/厂商NVR/不录)';


-- ==================== 知识库支持结构化判定规则（给 VLM 当判定约束） ====================
-- 规则条目用于"限定识别范围 / 按标准值纠错 / 超限告警"；文本条目保持原有用法
ALTER TABLE `patrol_knowledge_doc`
  ADD COLUMN `doc_type` VARCHAR(16) NOT NULL DEFAULT 'TEXT' COMMENT '条目类型 TEXT=文本 RULE=结构化规则',
  ADD COLUMN `metric` VARCHAR(128) DEFAULT NULL COMMENT '约束对象/指标，如 屏幕温度读数',
  ADD COLUMN `rule_kind` VARCHAR(16) DEFAULT NULL COMMENT 'RANGE=数值范围 EXPECT=期望值 TIME_WINDOW=时间窗口',
  ADD COLUMN `min_val` DECIMAL(12,3) DEFAULT NULL,
  ADD COLUMN `max_val` DECIMAL(12,3) DEFAULT NULL,
  ADD COLUMN `unit` VARCHAR(16) DEFAULT NULL,
  ADD COLUMN `expect_value` VARCHAR(255) DEFAULT NULL COMMENT '期望值/期望描述',
  ADD COLUMN `severity` VARCHAR(8) DEFAULT 'medium' COMMENT 'high/medium/low',
  ADD COLUMN `action` VARCHAR(16) DEFAULT 'ALARM' COMMENT 'ALARM=告警 REVIEW=转人工 INFO=仅提示';
