package com.genersoft.iot.vmp.patrol.media;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

/**
 * 本地磁盘存储实现：按 yyyyMMdd 分目录，文件名 UUID。
 * 对外 URL 走 nginx 静态目录（/patrol-media/**）直接服务，不经过 Tomcat/JVM，省内存也更快。
 */
@Slf4j
@Component
public class LocalDiskMediaStorage implements MediaStorage {

    @Value("${patrol.media.upload-dir:./media/patrol}")
    private String uploadDir;

    /** nginx 静态映射前缀（与 nginx.conf.template 的 location 保持一致） */
    @Value("${patrol.media.url-prefix:/patrol-media}")
    private String urlPrefix;

    @Override
    public String type() {
        return "local";
    }

    private Path root() throws IOException {
        Path p = Paths.get(uploadDir);
        if (!Files.exists(p)) {
            Files.createDirectories(p);
        }
        return p;
    }

    /** 目录穿越防护：只允许 日期目录/文件名 形式 */
    private Path resolveSafe(String key) throws IOException {
        if (key == null || key.isBlank() || key.contains("..") || key.startsWith("/") || key.startsWith("\\")) {
            throw new IOException("非法媒体 key: " + key);
        }
        Path p = root().resolve(key).normalize();
        if (!p.startsWith(root().normalize())) {
            throw new IOException("非法媒体路径: " + key);
        }
        return p;
    }

    @Override
    public String put(byte[] bytes, String ext) throws IOException {
        String day = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        String dir = "images/" + day;
        Path target = root().resolve(dir);
        Files.createDirectories(target);
        String fileName = UUID.randomUUID().toString().replace("-", "") + (ext == null || ext.isBlank() ? ".jpg" : ext);
        Files.write(target.resolve(fileName), bytes);
        return dir + "/" + fileName;
    }

    @Override
    public byte[] get(String key) throws IOException {
        Path p = resolveSafe(key);
        if (!Files.exists(p)) {
            return null;
        }
        return Files.readAllBytes(p);
    }

    @Override
    public String url(String key) {
        if (key == null) {
            return null;
        }
        String prefix = urlPrefix.endsWith("/") ? urlPrefix.substring(0, urlPrefix.length() - 1) : urlPrefix;
        return prefix + "/" + key;
    }

    @Override
    public boolean delete(String key) {
        try {
            return Files.deleteIfExists(resolveSafe(key));
        } catch (IOException e) {
            return false;
        }
    }
}
