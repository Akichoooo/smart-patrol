package com.genersoft.iot.vmp.conf;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class SchedulingConfig {

    @Bean
    @org.springframework.context.annotation.Primary  // patrol 模块新增 TaskExecutor 后，WVP 原有按类型注入点(RedisRpcConfig)仍解析到本调度器
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(5);
        scheduler.setThreadNamePrefix("scheduled-");
        scheduler.setVirtualThreads(true);  // 必须在 initialize() 之前
        scheduler.initialize();
        return scheduler;
    }
}
