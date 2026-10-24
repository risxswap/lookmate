package cc.riskswap.lookmate.config;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import jakarta.validation.Validation;
import java.time.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.server.Cookie;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.session.web.http.CookieSerializer;

class SessionCookieConfigurationTest {
    @Test
    void validatesWholePositiveSecondsWithinServletCookieLimit() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            var properties = new AuthProperties();
            for (Duration value :
                    new Duration[] {
                        null,
                        Duration.ZERO,
                        Duration.ofMillis(1500),
                        Duration.ofSeconds((long) Integer.MAX_VALUE + 1)
                    }) {
                properties.setRememberMeTimeout(value);
                assertThat(validator.validate(properties)).isNotEmpty();
            }
            for (Duration value :
                    new Duration[] {
                        Duration.ofSeconds(1),
                        Duration.ofDays(30),
                        Duration.ofSeconds(Integer.MAX_VALUE)
                    }) {
                properties.setRememberMeTimeout(value);
                assertThat(validator.validate(properties)).isEmpty();
            }
        }
    }

    @Test
    void subsecondRemainingLifetimeKeepsCookieUntilServerDeadline() {
        var clock = Clock.fixed(Instant.parse("2026-10-24T00:00:00Z"), ZoneOffset.UTC);
        var auth = new AuthProperties();
        auth.setRememberMeTimeout(Duration.ofSeconds(1));
        var serializer =
                new SessionCookieConfiguration()
                        .cookieSerializer(new ServerProperties(), auth, clock);
        var request = new MockHttpServletRequest();
        request.getSession().setAttribute(AuthGuardFilter.REMEMBER_ME, true);
        request.getSession().setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis() - 500);
        var response = new MockHttpServletResponse();
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "test-id"));
        assertThat(response.getHeader("Set-Cookie")).contains("Max-Age=1");
        request.getSession().setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis() - 1000);
        response = new MockHttpServletResponse();
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "test-id"));
        assertThat(response.getHeader("Set-Cookie")).contains("Max-Age=0");
    }

    @Test
    void preservesDeploymentCookieAttributesAndUsesRemainingLifetime() {
        var clock = Clock.fixed(Instant.parse("2026-10-24T00:00:00Z"), ZoneOffset.UTC);
        var server = new ServerProperties();
        var cookie = server.getServlet().getSession().getCookie();
        cookie.setName("CUSTOM_SESSION");
        cookie.setPath("/custom");
        cookie.setDomain("example.com");
        cookie.setSecure(true);
        cookie.setHttpOnly(true);
        cookie.setSameSite(Cookie.SameSite.LAX);
        cookie.setPartitioned(true);
        var serializer =
                new SessionCookieConfiguration()
                        .cookieSerializer(server, new AuthProperties(), clock);
        var request = new MockHttpServletRequest();
        request.getSession().setAttribute(AuthGuardFilter.REMEMBER_ME, true);
        request.getSession()
                .setAttribute(
                        AuthGuardFilter.LOGIN_AT, clock.millis() - Duration.ofDays(29).toMillis());
        var response = new MockHttpServletResponse();
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "test-id"));
        assertThat(response.getHeader("Set-Cookie"))
                .contains(
                        "CUSTOM_SESSION=",
                        "Path=/custom",
                        "Domain=example.com",
                        "Secure",
                        "HttpOnly",
                        "SameSite=Lax",
                        "Partitioned",
                        "Max-Age=86400");
        request.getSession().setAttribute(AuthGuardFilter.REMEMBER_ME, false);
        response = new MockHttpServletResponse();
        serializer.writeCookieValue(
                new CookieSerializer.CookieValue(request, response, "normal-id"));
        assertThat(response.getHeader("Set-Cookie")).doesNotContain("Max-Age", "Expires");
    }
}
