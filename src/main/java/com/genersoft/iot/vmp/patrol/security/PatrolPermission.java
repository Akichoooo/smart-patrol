package com.genersoft.iot.vmp.patrol.security;

/**
 * 巡检平台权限编码常量。
 * 权限格式：模块 + action，例如 PERM_monitor.video:ptz。
 * 角色: ROLE_{roleId}。admin(roleId==1) 全权限兜底。
 */
public final class PatrolPermission {

    /** 权限前缀 */
    public static final String PERM_PREFIX = "PERM_";
    /** 角色前缀 */
    public static final String ROLE_PREFIX = "ROLE_";
    /** 摄像头功能级权限前缀: PERM_CH_{func} */
    public static final String CHANNEL_PERM_PREFIX = "PERM_CH_";

    /** 模块权限编码（与前端菜单树一致） */
    public static final String MODULE_OVERVIEW = "overview";
    public static final String MODULE_MONITOR_VIDEO = "monitor.video";
    public static final String MODULE_MONITOR_ROBOT = "monitor.robot";
    public static final String MODULE_MONITOR_DRONE = "monitor.drone";
    public static final String MODULE_MONITOR_PLAYBACK = "monitor.playback";
    public static final String MODULE_PATROL_TASK = "patrol.task";
    public static final String MODULE_PATROL_EXECUTION = "patrol.execution";
    public static final String MODULE_PATROL_RESULT = "patrol.result";
    public static final String MODULE_PATROL_REPORT = "patrol.report";
    public static final String MODULE_PATROL_ALARM = "patrol.alarm";
    public static final String MODULE_PATROL_STATS = "patrol.stats";
    public static final String MODULE_SETTINGS_SECURITY = "settings.security";
    public static final String MODULE_SETTINGS_ACCESS = "settings.access";
    public static final String MODULE_SETTINGS_MEDIA = "settings.media";
    public static final String MODULE_SETTINGS_ORG = "settings.org";
    public static final String MODULE_SETTINGS_ASSET = "settings.asset";
    public static final String MODULE_SETTINGS_AI = "settings.ai";
    public static final String MODULE_SETTINGS_PATROL = "settings.patrol";
    public static final String MODULE_SETTINGS_SYSTEM = "settings.system";

    /** 标准操作 */
    public static final String ACTION_VIEW = "view";
    public static final String ACTION_CREATE = "create";
    public static final String ACTION_EDIT = "edit";
    public static final String ACTION_DELETE = "delete";
    public static final String ACTION_EXECUTE = "execute";
    public static final String ACTION_EXPORT = "export";
    public static final String ACTION_REVIEW = "review";
    public static final String ACTION_CONFIRM = "confirm";

    /** 摄像头功能级 */
    public static final String CH_VIEW = "view";
    public static final String CH_PTZ = "ptz";
    public static final String CH_PRESET = "preset";
    public static final String CH_PLAYBACK = "playback";
    public static final String CH_DOWNLOAD = "download";
    public static final String CH_SNAPSHOT = "snapshot";
    public static final String CH_TALK = "talk";
    public static final String CH_RECORD = "record";

    private PatrolPermission() {
    }

    /** 生成模块+操作的 authority 字符串 */
    public static String perm(String module, String action) {
        return PERM_PREFIX + module + ":" + action;
    }

    /** 摄像头功能级 authority */
    public static String channelPerm(String func) {
        return CHANNEL_PERM_PREFIX + func;
    }

    /** 角色 authority */
    public static String role(int roleId) {
        return ROLE_PREFIX + roleId;
    }
}
