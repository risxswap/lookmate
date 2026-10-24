package cc.riskswap.lookmate.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.advice.ApiExceptionHandler;
import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.filter.RequestBoundaryFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.common.model.dto.AuthenticatedAccount;
import cc.riskswap.lookmate.controller.AuthController;
import cc.riskswap.lookmate.service.AuthRateLimiter;
import cc.riskswap.lookmate.service.AuthService;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.session.MapSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.config.annotation.web.http.EnableSpringHttpSession;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
        classes = RememberLoginTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "server.servlet.session.cookie.secure=false",
            "lookmate.auth.login-requests=1000"
        })
@ActiveProfiles("remember-session-test")
class RememberLoginTest {
    @Configuration(proxyBeanMethods = false)
    @Profile("remember-session-test")
    @EnableAutoConfiguration(exclude = DataSourceAutoConfiguration.class)
    @EnableSpringHttpSession
    @Import({
        AuthController.class,
        SecurityConfiguration.class,
        SessionCookieConfiguration.class,
        JsonConfiguration.class,
        ApiErrors.class,
        ApiExceptionHandler.class,
        RequestBoundaryFilter.class,
        AuthRateLimiter.class
    })
    static class TestApplication {
        @Bean
        @ConditionalOnProperty(
                name = "lookmate.test.redis",
                havingValue = "false",
                matchIfMissing = true)
        MapSessionRepository sessionRepository() {
            var repository = new MapSessionRepository(new ConcurrentHashMap<>());
            repository.setDefaultMaxInactiveInterval(Duration.ofHours(2));
            return repository;
        }

        @Bean
        AuthService authService() {
            return mock(AuthService.class);
        }
    }

    @LocalServerPort int port;
    @Autowired org.springframework.core.env.Environment environment;
    @Autowired org.springframework.data.redis.core.StringRedisTemplate redis;
    @Autowired AuthService auth;
    @Autowired SessionRepository sessions;
    @Autowired ObjectMapper mapper;
    String cookie;
    String csrf;
    HttpClient client;

    @BeforeEach
    void prepare() {
        client = HttpClient.newHttpClient();
        cookie = null;
        reset(auth);
        var account = new AccountDto("1", "remember_test", null);
        when(auth.login(any(), any())).thenReturn(new AuthenticatedAccount(account, "fingerprint"));
        when(auth.activeAccount("1", "fingerprint")).thenReturn(account);
    }

    @AfterEach
    void close() {
        client.close();
    }

    @Test
    void remembersCookieRestoresIdentityAndShrinksTtlWithoutExtendingDeadline() throws Exception {
        var response = login(",\"rememberMe\":true");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Set-Cookie").orElseThrow())
                .contains("Max-Age=", "Expires=", "HttpOnly", "SameSite=Lax")
                .doesNotContain("Secure");
        long maxAge =
                java.net.HttpCookie.parse(response.headers().firstValue("Set-Cookie").orElseThrow())
                        .getFirst()
                        .getMaxAge();
        assertThat(maxAge).isBetween(2591998L, 2592000L);
        var session = currentSession();
        assertThat(session.getMaxInactiveInterval()).isEqualTo(Duration.ofDays(30));
        if (environment.getProperty("lookmate.test.redis", Boolean.class, false)) {
            String namespace = environment.getProperty("spring.session.data.redis.namespace");
            assertThat(redis.getExpire(namespace + ":sessions:" + session.getId()))
                    .isBetween(2591998L, 2592000L);
        }
        Long loginAt = session.getAttribute(AuthGuardFilter.LOGIN_AT);
        session.setAttribute(AuthGuardFilter.LOGIN_AT, loginAt - Duration.ofDays(8).toMillis());
        sessions.save(session);
        // 新 HTTP 客户端仅携带 Cookie，模拟丢失页面状态后重新打开。
        client.close();
        client = HttpClient.newHttpClient();
        assertThat(send("GET", "/me", null).statusCode()).isEqualTo(200);
        assertThat(currentSession().getMaxInactiveInterval().getSeconds())
                .isBetween(1900798L, 1900800L);
        assertThat(send("GET", "/csrf", null).headers().allValues("Set-Cookie")).isEmpty();
        session = currentSession();
        session.setAttribute(
                AuthGuardFilter.LOGIN_AT,
                System.currentTimeMillis() - Duration.ofDays(30).toMillis());
        sessions.save(session);
        String expiredId = session.getId();
        assertThat(send("GET", "/me", null).statusCode()).isEqualTo(401);
        assertThat(sessions.findById(expiredId)).isNull();
    }

    @Test
    void ordinaryLoginAndSwitchFromRememberedRotateAndRestoreSessionCookie() throws Exception {
        login(",\"rememberMe\":true");
        String oldId = currentSession().getId();
        var response = login("");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Set-Cookie").orElseThrow())
                .doesNotContain("Max-Age", "Expires");
        assertThat(currentSession().getId()).isNotEqualTo(oldId);
        assertThat(sessions.findById(oldId)).isNull();
        assertThat(currentSession().getMaxInactiveInterval()).isEqualTo(Duration.ofHours(2));
        assertThat((Boolean) currentSession().getAttribute(AuthGuardFilter.REMEMBER_ME)).isFalse();
    }

    @Test
    void logoutDeletesRememberedSessionAndCookie() throws Exception {
        login(",\"rememberMe\":true");
        String id = currentSession().getId();
        token();
        var response = send("POST", "/logout", "{}");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Set-Cookie").orElseThrow()).contains("Max-Age=0");
        assertThat(sessions.findById(id)).isNull();
        assertThat(send("GET", "/me", null).statusCode()).isEqualTo(401);
    }

    @Test
    void changedPasswordOrDisabledAccountRejectsRememberedIdentity() throws Exception {
        login(",\"rememberMe\":true");
        String id = currentSession().getId();
        when(auth.activeAccount("1", "fingerprint"))
                .thenThrow(new ApiException(401, "UNAUTHENTICATED", "请重新登录"));
        assertThat(send("GET", "/me", null).statusCode()).isEqualTo(401);
        assertThat(sessions.findById(id)).isNull();
    }

    @Test
    void invalidRememberValuesAndRegistrationFieldAreRejectedWithoutAuthentication()
            throws Exception {
        for (String value : new String[] {"null", "\"true\"", "1", "0", "{}", "[]"}) {
            assertThat(login(",\"rememberMe\":" + value).statusCode()).isEqualTo(400);
        }
        token();
        assertThat(
                        send(
                                        "POST",
                                        "/register",
                                        "{\"username\":\"remember_test\",\"password\":\"test pass\",\"rememberMe\":true}")
                                .statusCode())
                .isEqualTo(400);
        verify(auth, never()).login(any(), any());
        verify(auth, never()).register(any());
        assertThat(login(",\"rememberMe\":false").statusCode()).isEqualTo(200);
    }

    @Test
    void failedLoginDoesNotEstablishRememberedSession() throws Exception {
        when(auth.login(any(), any()))
                .thenThrow(new ApiException(401, "INVALID_CREDENTIALS", "用户名或密码错误"));
        assertThat(login(",\"rememberMe\":true").statusCode()).isEqualTo(401);
        assertThat((Object) currentSession().getAttribute(AuthGuardFilter.REMEMBER_ME)).isNull();
        assertThat(currentSession().getMaxInactiveInterval()).isEqualTo(Duration.ofHours(2));
    }

    @Test
    void failedReloginPreservesExistingRememberedDeadline() throws Exception {
        login(",\"rememberMe\":true");
        var before = currentSession();
        when(auth.login(any(), any()))
                .thenThrow(new ApiException(401, "INVALID_CREDENTIALS", "用户名或密码错误"));
        assertThat(login(",\"rememberMe\":true").statusCode()).isEqualTo(401);
        assertThat(currentSession().getId()).isEqualTo(before.getId());
        assertThat((Object) currentSession().getAttribute(AuthGuardFilter.LOGIN_AT))
                .isEqualTo(before.getAttribute(AuthGuardFilter.LOGIN_AT));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LOOKMATE_REMEMBER_BROWSER", matches = "true")
    void browserHarness() throws Exception {
        when(auth.login(any(), any()))
                .thenAnswer(
                        call -> {
                            var credentials =
                                    call.getArgument(
                                            0,
                                            cc.riskswap.lookmate.common.model.param.CredentialsParam
                                                    .class);
                            if (!"test pass".equals(credentials.getPassword()))
                                throw new ApiException(401, "INVALID_CREDENTIALS", "用户名或密码错误");
                            return new AuthenticatedAccount(
                                    new AccountDto("1", "remember_test", null), "fingerprint");
                        });
        System.out.println("REMEMBER_BROWSER_PORT=" + port);
        var stop = java.nio.file.Path.of("/tmp/lookmate-remember-browser.stop");
        long deadline = System.nanoTime() + Duration.ofMinutes(20).toNanos();
        while (!java.nio.file.Files.exists(stop) && System.nanoTime() < deadline) Thread.sleep(500);
    }

    HttpResponse<String> login(String extra) throws Exception {
        token();
        return send(
                "POST",
                "/login",
                "{\"username\":\"remember_test\",\"password\":\"test pass\"" + extra + "}");
    }

    void token() throws Exception {
        csrf =
                mapper.readTree(send("GET", "/csrf", null).body())
                        .path("data")
                        .path("token")
                        .asText();
    }

    HttpResponse<String> send(String method, String path, String body) throws Exception {
        var builder =
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/auth" + path));
        if (cookie != null) builder.header("Cookie", cookie);
        if (body != null)
            builder.header("Content-Type", "application/json").header("X-CSRF-TOKEN", csrf);
        var response =
                client.send(
                        builder.method(
                                        method,
                                        body == null
                                                ? HttpRequest.BodyPublishers.noBody()
                                                : HttpRequest.BodyPublishers.ofString(body))
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
        response.headers()
                .firstValue("Set-Cookie")
                .ifPresent(value -> cookie = value.split(";", 2)[0]);
        return response;
    }

    Session currentSession() {
        return sessions.findById(
                new String(
                        Base64.getDecoder().decode(cookie.substring(cookie.indexOf('=') + 1)),
                        StandardCharsets.UTF_8));
    }
}
