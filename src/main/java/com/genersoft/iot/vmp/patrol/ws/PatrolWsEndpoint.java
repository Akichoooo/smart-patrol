package com.genersoft.iot.vmp.patrol.ws;

import com.alibaba.fastjson2.JSONObject;
import jakarta.websocket.*;
import jakarta.websocket.server.PathParam;
import jakarta.websocket.server.ServerEndpoint;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * 巡检平台 WebSocket：/api/patrol/ws
 * 推送类型：EXECUTION_PROGRESS / POINT_RESULT / ALARM / EXECUTION_FINISHED
 * 鉴权：连接参数 access-token（JwtAuthenticationFilter 已支持 sec-websocket-protocol / query param）
 */
@Slf4j
@Component
@ServerEndpoint("/api/patrol/ws")
public class PatrolWsEndpoint {

    private static final CopyOnWriteArraySet<Session> SESSIONS = new CopyOnWriteArraySet<>();
    private static final Map<String, Long> LAST_PING = new ConcurrentHashMap<>();

    @OnOpen
    public void onOpen(Session session, @PathParam("token") String token) {
        SESSIONS.add(session);
        log.info("[PatrolWS] 连接建立，当前 {} 个会话", SESSIONS.size());
    }

    @OnClose
    public void onClose(Session session) {
        SESSIONS.remove(session);
    }

    @OnError
    public void onError(Session session, Throwable t) {
        SESSIONS.remove(session);
        log.warn("[PatrolWS] 连接异常: {}", t.getMessage());
    }

    @OnMessage
    public void onMessage(Session session, String msg) {
        if ("ping".equalsIgnoreCase(msg)) {
            try {
                session.getBasicRemote().sendText("pong");
            } catch (IOException ignore) {
            }
        }
    }

    /** 广播一条推送 */
    public static void push(String type, Object data) {
        JSONObject msg = new JSONObject();
        msg.put("type", type);
        msg.put("data", data);
        msg.put("ts", System.currentTimeMillis());
        String text = msg.toJSONString();
        for (Session s : SESSIONS) {
            try {
                if (s.isOpen()) {
                    s.getBasicRemote().sendText(text);
                }
            } catch (IOException e) {
                SESSIONS.remove(s);
            }
        }
    }
}
