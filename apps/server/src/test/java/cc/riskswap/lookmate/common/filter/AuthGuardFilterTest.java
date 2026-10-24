package cc.riskswap.lookmate.common.filter;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.service.AuthRateLimiter;
import cc.riskswap.lookmate.service.AuthService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class AuthGuardFilterTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T00:00:00Z"), ZoneOffset.UTC);
    private final AuthService auth = mock(AuthService.class);
    private final AuthProperties properties = new AuthProperties();
    private final AuthGuardFilter filter =
            new AuthGuardFilter(auth, new AuthRateLimiter(properties, clock), properties, clock);

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void anonymousPrivateWriteReturnsUnauthorizedBeforeCsrf() {
        var request = new MockHttpServletRequest("POST", "/api/profile");
        request.setServletPath("/api/profile");
        assertThatThrownBy(
                        () ->
                                filter.doFilter(
                                        request,
                                        new MockHttpServletResponse(),
                                        new MockFilterChain()))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(401));
    }

    @Test
    void sevenDayBoundaryInvalidatesEvenRecentlyUsedSession() {
        var request = authenticated("/api/profile", properties.getAbsoluteTimeout().toMillis());
        var session = (MockHttpSession) request.getSession();
        request.setMethod("POST");
        assertThatThrownBy(
                        () ->
                                filter.doFilter(
                                        request,
                                        new MockHttpServletResponse(),
                                        new MockFilterChain()))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(401));
        assertThat(session.isInvalid()).isTrue();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(auth);
    }

    @Test
    void activeSessionBeforeDeadlineKeepsOriginalLoginTime() throws Exception {
        var request = authenticated("/api/auth/me", properties.getAbsoluteTimeout().toMillis() - 1);
        Object loginAt = request.getSession().getAttribute(AuthGuardFilter.LOGIN_AT);
        when(auth.activeAccount("1", "fingerprint")).thenReturn(new AccountDto("1", "alice", null));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        assertThat(request.getAttribute(AuthGuardFilter.ACCOUNT)).isInstanceOf(AccountDto.class);
        assertThat(request.getSession().getAttribute(AuthGuardFilter.LOGIN_AT)).isEqualTo(loginAt);
    }

    @Test
    void disabledAccountLosesSessionButPublicCsrfCanStillProceed() throws Exception {
        var request = authenticated("/api/auth/csrf", 1000);
        var session = (MockHttpSession) request.getSession();
        when(auth.activeAccount("1", "fingerprint"))
                .thenThrow(new ApiException(401, "UNAUTHENTICATED", "请重新登录"));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        assertThat(session.isInvalid()).isTrue();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void rememberedSessionSurvivesOrdinaryLimitButExpiresExactlyAtRememberDeadline()
            throws Exception {
        var request =
                authenticated("/api/auth/me", properties.getRememberMeTimeout().toMillis() - 1);
        request.getSession().setAttribute(AuthGuardFilter.REMEMBER_ME, true);
        when(auth.activeAccount("1", "fingerprint")).thenReturn(new AccountDto("1", "alice", null));
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        assertThat(request.getSession().getMaxInactiveInterval()).isEqualTo(1);
        var expired = authenticated("/api/auth/me", properties.getRememberMeTimeout().toMillis());
        expired.getSession().setAttribute(AuthGuardFilter.REMEMBER_ME, true);
        assertThatThrownBy(
                        () ->
                                filter.doFilter(
                                        expired,
                                        new MockHttpServletResponse(),
                                        new MockFilterChain()))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(401));
    }

    private MockHttpServletRequest authenticated(String path, long age) {
        SecurityContextHolder.getContext()
                .setAuthentication(
                        UsernamePasswordAuthenticationToken.authenticated("1", null, List.of()));
        var request = new MockHttpServletRequest("GET", path);
        request.setServletPath(path);
        request.getSession().setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis() - age);
        request.getSession().setAttribute(AuthGuardFilter.PASSWORD_FINGERPRINT, "fingerprint");
        return request;
    }
}
