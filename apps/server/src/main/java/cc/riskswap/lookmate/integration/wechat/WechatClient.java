package cc.riskswap.lookmate.integration.wechat;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.util.BoundedHttp;
import cc.riskswap.lookmate.config.WechatProperties;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class WechatClient {
    private final WechatProperties properties;
    private final ObjectMapper json;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

    public WechatClient(WechatProperties p, ObjectMapper j) {
        properties = p;
        json = j;
    }

    private String accessToken;
    private long accessExpiresAt;

    public String appId() {
        return properties.getAppId();
    }

    private void configured() {
        if (properties.getAppId().isBlank() || properties.getAppSecret().isBlank())
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信登录尚未配置");
    }

    private String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    public String exchange(String code) {
        configured();
        var node =
                parse(
                        send(
                                        "/sns/jscode2session?appid="
                                                + enc(properties.getAppId())
                                                + "&secret="
                                                + enc(properties.getAppSecret())
                                                + "&js_code="
                                                + enc(code)
                                                + "&grant_type=authorization_code",
                                        null)
                                .body());
        String openId = node.path("openid").asText("");
        if (openId.isBlank() || openId.length() > 128 || node.path("errcode").asInt(0) != 0)
            throw new ApiException(502, "WECHAT_LOGIN_FAILED", "微信登录凭据无效，请重试");
        return openId;
    }

    public String qr(String scene) {
        configured();
        String access = accessToken();
        byte[] body =
                json.writeValueAsBytes(
                        Map.of(
                                "scene",
                                scene,
                                "page",
                                properties.getCodePage(),
                                "env_version",
                                properties.getEnvVersion(),
                                "check_path",
                                true));
        var response = send("/wxa/getwxacodeunlimit?access_token=" + enc(access), body);
        String type = response.headers().firstValue("content-type").orElse("");
        if (!type.startsWith("image/") || response.body().length > 2 * 1024 * 1024)
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信登录码暂不可用");
        return "data:"
                + type.split(";")[0]
                + ";base64,"
                + Base64.getEncoder().encodeToString(response.body());
    }

    private synchronized String accessToken() {
        if (accessToken != null && System.currentTimeMillis() < accessExpiresAt) return accessToken;
        JsonNode node =
                parse(
                        send(
                                        "/cgi-bin/token?grant_type=client_credential&appid="
                                                + enc(properties.getAppId())
                                                + "&secret="
                                                + enc(properties.getAppSecret()),
                                        null)
                                .body());
        String value = node.path("access_token").asText("");
        int seconds = node.path("expires_in").asInt(0);
        if (value.isBlank() || seconds <= 0)
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信登录码暂不可用");
        accessToken = value;
        accessExpiresAt = System.currentTimeMillis() + Math.max(1, seconds - 60) * 1000L;
        return value;
    }

    private JsonNode parse(byte[] body) {
        try {
            JsonNode value = json.readTree(body);
            if (value == null || !value.isObject()) throw new IllegalArgumentException();
            return value;
        } catch (RuntimeException e) {
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信服务响应异常");
        }
    }

    private HttpResponse<byte[]> send(String path, byte[] body) {
        try {
            var b =
                    HttpRequest.newBuilder(URI.create(properties.getApiBaseUrl() + path))
                            .timeout(Duration.ofSeconds(15));
            if (body == null) b.GET();
            else
                b.header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body));
            var result = BoundedHttp.send(http, b.build(), 2 * 1024 * 1024, 15);
            if (result.statusCode() != 200)
                throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信服务暂不可用");
            return result;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信服务请求中断");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(503, "WECHAT_UNAVAILABLE", "微信服务暂不可用");
        }
    }
}
