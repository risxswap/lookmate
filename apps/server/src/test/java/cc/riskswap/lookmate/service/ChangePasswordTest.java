package cc.riskswap.lookmate.service;

import java.time.Clock;
import java.util.List;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.entity.UserEntity;
import cc.riskswap.lookmate.mapper.UserMapper;
import cc.riskswap.lookmate.param.ChangePasswordParam;
import cc.riskswap.lookmate.param.CredentialsParam;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChangePasswordTest {
    final UserMapper users = mock(UserMapper.class);
    final PasswordEncoder encoder = mock(PasswordEncoder.class);
    final AuthProperties properties = new AuthProperties();
    final AuthRateLimiter limits = new AuthRateLimiter(properties, Clock.systemUTC());
    final AuthService service = new AuthService(users, encoder, properties, limits, Clock.systemUTC());
    UserEntity user() {
        var user = new UserEntity(); user.setId(1L); user.setUsername("alice");
        user.setStatus("ACTIVE"); user.setPasswordHash("original-hash");
        when(users.selectById("1")).thenReturn(user); return user;
    }
    void error(Runnable operation, String code) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }
    @Test void strictJsonAndPasswordBoundariesNeverReachPersistence() {
        for (String raw : List.of("null", "[]", "{}", "{} {}", "{\"currentPassword\":1,\"newPassword\":\"12345678\"}",
                "{\"currentPassword\":\"12345678\",\"newPassword\":null}",
                "{\"currentPassword\":\"12345678\",\"newPassword\":\"abcdefgh\",\"extra\":true}")) error(() -> ChangePasswordParam.parse(raw), "VALIDATION_ERROR");
        for (String next : List.of("1234567", "😀".repeat(65), "12345678")) error(() -> service.changePassword("1", new ChangePasswordParam("12345678", next), "ip"), "VALIDATION_ERROR");
        verifyNoInteractions(users);
    }
    @Test void wrongCurrentPasswordAndDisabledUserDoNotUpdate() {
        var user = user();
        error(() -> service.changePassword("1", new ChangePasswordParam("12345678", "abcdefgh"), "ip"), "CURRENT_PASSWORD_INCORRECT");
        user.setStatus("DISABLED");
        error(() -> service.changePassword("1", new ChangePasswordParam("12345678", "abcdefgh"), "ip"), "UNAUTHENTICATED");
        verify(users, never()).changePassword(any(), any(), any(), any());
    }
    @Test void unicodeAndSpacesArePreservedAndConflictDoesNotOverwrite() {
        user(); String current = " 123456 "; String next = "😀".repeat(64);
        when(encoder.matches(current, "original-hash")).thenReturn(true);
        when(encoder.encode(next)).thenReturn("new-hash");
        when(users.changePassword(eq("1"), eq("original-hash"), eq("new-hash"), any())).thenReturn(1, 0);
        service.changePassword("1", new ChangePasswordParam(current, next), "ip");
        error(() -> service.changePassword("1", new ChangePasswordParam(current, next), "ip"), "PASSWORD_CHANGED");
        verify(encoder, times(2)).encode(next);
    }
    @Test void loginFingerprintIsBoundToPasswordReadBeforeConcurrentChange() {
        var original = user(); when(users.selectOne(any())).thenReturn(original);
        when(encoder.matches("12345678", "original-hash")).thenAnswer(call -> {
            var changed = new UserEntity(); changed.setStatus("ACTIVE"); changed.setPasswordHash("changed-hash");
            when(users.selectById("1")).thenReturn(changed); return true;
        });
        var input = new CredentialsParam(); input.setUsername("alice"); input.setPassword("12345678");
        var login = service.login(input, "ip");
        error(() -> service.activeAccount("1", login.getPasswordFingerprint()), "UNAUTHENTICATED");
        error(() -> service.activeAccount("1", null), "UNAUTHENTICATED");
    }
    @Test void passwordLimitsAreIndependentFromLogin() {
        for (int i = 0; i < 4; i++) limits.passwordFailed("ip", "1");
        error(() -> limits.passwordFailed("ip", "1"), "RATE_LIMITED");
        error(() -> limits.passwordSucceeded("ip", "1"), "RATE_LIMITED");
        limits.checkFailure("ip", "1");
        for (int i = 0; i < properties.getLoginRequests(); i++) limits.passwordRequest("ip");
        error(() -> limits.passwordRequest("ip"), "RATE_LIMITED"); limits.request("ip", false);
    }
}
