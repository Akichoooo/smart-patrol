package com.genersoft.iot.vmp.patrol.media;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * 媒体存取门面：按配置选择 MediaStorage 实现（SPI 注册表）。
 * 未实现的存储（s3/ftp）明确报错，不做静默降级——待接入项见 DESIGN.md。
 */
@Slf4j
@Service
public class MediaService {

    @Value("${patrol.media.storage:local}")
    private String storageType;

    private final Map<String, MediaStorage> registry = new HashMap<>();

    public MediaService(java.util.List<MediaStorage> storages, LocalDiskMediaStorage local) {
        for (MediaStorage s : storages) {
            registry.put(s.type(), s);
        }
        registry.putIfAbsent("local", local);
    }

    /** 尚未实现的存储类型 → 明确原因 */
    private static final Set<String> NOT_IMPLEMENTED = Set.of("s3", "minio", "ftp");

    private MediaStorage storage() {
        String type = storageType == null ? "local" : storageType.trim().toLowerCase();
        if (NOT_IMPLEMENTED.contains(type)) {
            throw new IllegalStateException("媒体存储 [" + type + "] 未实现（待接入），请配置 patrol.media.storage=local");
        }
        MediaStorage s = registry.get(type);
        if (s == null) {
            throw new IllegalStateException("未知媒体存储类型: " + type);
        }
        return s;
    }

    /** base64 → 存储，返回对象 key */
    public String saveBase64(String base64) throws IOException {
        String data = base64.contains("base64,") ? base64.substring(base64.indexOf("base64,") + 7) : base64;
        return saveBytes(Base64.getDecoder().decode(data));
    }

    public String saveBytes(byte[] bytes) throws IOException {
        return storage().put(bytes, ".jpg");
    }

    public byte[] read(String key) throws IOException {
        return storage().get(key);
    }

    public String urlOf(String key) {
        return key == null ? null : storage().url(key);
    }

    public boolean delete(String key) {
        return key != null && storage().delete(key);
    }

    public String currentType() {
        return storageType == null ? "local" : storageType;
    }
}
