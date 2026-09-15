package com.genersoft.iot.vmp.patrol.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 巡检线程池（Java 21 虚拟线程）：推理编排专用，HTTP 请求线程只触发不阻塞。
 * 注意：这里不开启 @EnableAsync —— WVP 存在大量休眠的 @Async 注解，全局开启会
 * 激活它们（行为变化，违反"不改坏 WVP"），因此编排由控制器显式提交到本执行器。
 */
@Configuration
public class PatrolAsyncConfig {

    @Bean("patrolTaskExecutor")
    public ThreadPoolTaskExecutor patrolTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        // 虚拟线程（Java 21）：VLM 长耗时不占平台线程
        executor.setThreadFactory(Thread.ofVirtual().name("patrol-exec-", 0).factory());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        return executor;
    }
}
