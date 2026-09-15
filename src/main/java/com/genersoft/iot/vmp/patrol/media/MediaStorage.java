package com.genersoft.iot.vmp.patrol.media;

import java.io.IOException;

/**
 * 巡检媒体存储 SPI。
 * 回传方式三选一（方案文档 4.5）对应三种实现：
 *  - local : 本地磁盘（默认，nginx 直接静态服务 /patrol-media/）
 *  - s3    : S3/MinIO（未实现，待接入）
 *  - ftp   : FTP（未实现，待接入）
 * 选择由配置 patrol.media.storage 决定，核心流程只依赖本接口。
 */
public interface MediaStorage {

    /** 存储类型标识：local / s3 / ftp */
    String type();

    /**
     * 保存字节，返回存储对象 key（含相对路径，不含 URL）
     */
    String put(byte[] bytes, String ext) throws IOException;

    /** 读取对象字节；不存在返回 null */
    byte[] get(String key) throws IOException;

    /** 对外访问 URL（由具体实现决定：本地→nginx 静态路径；S3→预签名/公网地址） */
    String url(String key);

    /** 删除对象 */
    boolean delete(String key);
}
