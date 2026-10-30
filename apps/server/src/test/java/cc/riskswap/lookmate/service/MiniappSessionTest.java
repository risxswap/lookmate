package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.dao.entity.UserEntity;
import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.session.*;

class MiniappSessionTest {
    @SuppressWarnings("unchecked")
    final SessionRepository<Session> repository = mock(SessionRepository.class);

    final AuthService auth = mock(AuthService.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-10-30T00:00:00Z"), ZoneOffset.UTC);
    final MiniappSessionService service = new MiniappSessionService(repository, auth, clock);

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void absoluteExpiryIsThirtyDaysAndReadsDoNotExtend() {
        var s = new MapSession();
        when(repository.createSession()).thenReturn(s);
        when(repository.findById(s.getId())).thenReturn(s);
        var user = new UserEntity();
        user.setId(1L);
        when(auth.fingerprint(user)).thenReturn("version0");
        when(auth.activeAccount("1", "version0")).thenReturn(new AccountDto("1", null, null));
        var result = service.issue(user);
        assertThat(result.get("expiresAt")).isEqualTo(clock.instant().plus(Duration.ofDays(30)));
        Long before = s.getAttribute("expires");
        assertThat(service.validate(s.getId()).getId()).isEqualTo("1");
        assertThat((Long) s.getAttribute("expires")).isEqualTo(before);
        verify(repository, times(1)).save(s);
    }

    @Test
    void expiryOrChangedCredentialsRemoveOldToken() {
        var s = new MapSession();
        s.setAttribute("miniapp", true);
        s.setAttribute("expires", clock.millis());
        when(repository.findById("token")).thenReturn(s);
        assertThatThrownBy(() -> service.validate("token")).isInstanceOf(ApiException.class);
        verify(repository).deleteById("token");
        s.setAttribute("expires", clock.millis() + 1000);
        s.setAttribute("userId", "1");
        s.setAttribute("fingerprint", "old");
        when(auth.activeAccount("1", "old"))
                .thenThrow(new ApiException(401, "UNAUTHENTICATED", "changed"));
        assertThatThrownBy(() -> service.validate("token")).isInstanceOf(ApiException.class);
        verify(repository, times(2)).deleteById("token");
    }

    @Test
    void browserSessionIdCannotBeUsedAsMiniappToken() {
        when(repository.findById("browser")).thenReturn(new MapSession());
        assertThatThrownBy(() -> service.validate("browser")).isInstanceOf(ApiException.class);
        verifyNoInteractions(auth);
    }

    @Test
    void validatedTokenAllowsPatchOverrideOnlyAfterAuthentication() throws Exception {
        var mini = mock(MiniappSessionService.class);
        when(mini.validate("good")).thenReturn(new AccountDto("1", null, null));
        var limits = mock(AuthRateLimiter.class);
        var filter =
                new AuthGuardFilter(auth, limits, new AuthProperties(), clock).withMiniapp(mini);
        var req = new MockHttpServletRequest("POST", "/api/profile");
        req.setServletPath("/api/profile");
        req.addHeader("X-Miniapp-Token", "good");
        req.addHeader("X-HTTP-Method-Override", "PATCH");
        var response = new MockHttpServletResponse();
        filter.doFilter(
                req,
                response,
                (request, r) -> {
                    assertThat(((HttpServletRequest) request).getMethod()).isEqualTo("PATCH");
                    assertThat(request.getAttribute(MiniappSessionService.VERIFIED))
                            .isEqualTo(true);
                });
    }

    @Test
    void forgedTokenNeverMarksRequestCsrfExempt() {
        var mini = mock(MiniappSessionService.class);
        when(mini.validate("bad")).thenThrow(new ApiException(401, "UNAUTHENTICATED", "invalid"));
        var filter =
                new AuthGuardFilter(auth, mock(AuthRateLimiter.class), new AuthProperties(), clock)
                        .withMiniapp(mini);
        var req = new MockHttpServletRequest("POST", "/api/profile");
        req.setServletPath("/api/profile");
        req.addHeader("X-Miniapp-Token", "bad");
        assertThatThrownBy(
                        () ->
                                filter.doFilter(
                                        req,
                                        new MockHttpServletResponse(),
                                        (r, s) -> fail("must not reach application")))
                .isInstanceOf(ApiException.class);
        assertThat(req.getAttribute(MiniappSessionService.VERIFIED)).isNull();
    }

    @Test
    void authenticatedOverrideRejectsOtherMethods() {
        var mini = mock(MiniappSessionService.class);
        when(mini.validate("good")).thenReturn(new AccountDto("1", null, null));
        var filter =
                new AuthGuardFilter(auth, mock(AuthRateLimiter.class), new AuthProperties(), clock)
                        .withMiniapp(mini);
        var req = new MockHttpServletRequest("POST", "/api/profile");
        req.setServletPath("/api/profile");
        req.addHeader("X-Miniapp-Token", "good");
        req.addHeader("X-HTTP-Method-Override", "DELETE");
        assertThatThrownBy(
                        () ->
                                filter.doFilter(
                                        req,
                                        new MockHttpServletResponse(),
                                        (r, s) -> fail("must not reach application")))
                .isInstanceOf(ApiException.class);
    }
}
