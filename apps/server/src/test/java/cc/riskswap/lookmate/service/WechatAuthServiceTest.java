package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.*;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.wechat.WechatClient;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import tools.jackson.databind.json.JsonMapper;

class WechatAuthServiceTest {
    final UserMapper users = mock(UserMapper.class);
    final AuthTicketMapper tickets = mock(AuthTicketMapper.class);
    final AuthService auth = mock(AuthService.class);
    final MiniappSessionService sessions = mock(MiniappSessionService.class);
    final WechatClient wechat = mock(WechatClient.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-10-30T00:00:00Z"), ZoneOffset.UTC);
    final PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
    final WechatAuthService service =
            new WechatAuthService(
                    users,
                    tickets,
                    auth,
                    sessions,
                    wechat,
                    tm,
                    JsonMapper.builder().build(),
                    clock);

    WechatAuthServiceTest() {
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(wechat.appId()).thenReturn("app");
    }

    UserEntity user() {
        var u = new UserEntity();
        u.setId(1L);
        u.setStatus("ACTIVE");
        when(users.lock(1L)).thenReturn(u);
        when(auth.fingerprint(u)).thenReturn("current");
        return u;
    }

    AuthTicketRow ticket(String kind, String status) throws Exception {
        var t = new AuthTicketRow();
        t.setTicketKey("a".repeat(32));
        t.setKind(kind);
        t.setStatus(status);
        t.setExpiresAt(LocalDateTime.ofInstant(clock.instant().plusSeconds(300), ZoneOffset.UTC));
        t.setOwnerHash(
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest("browser".getBytes(StandardCharsets.UTF_8))));
        t.setPayload(
                kind.equals("QR")
                        ? "{\"userId\":\"1\",\"fingerprint\":\"current\"}"
                        : "{\"appId\":\"app\",\"openId\":\"open\"}");
        when(tickets.lock(t.getTicketKey())).thenReturn(t);
        when(tickets.find(t.getTicketKey())).thenReturn(t);
        return t;
    }

    void error(Runnable run, String code) {
        assertThatThrownBy(run::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    @Test
    void unknownIdentityDoesNotCreateUser() {
        when(wechat.exchange("code")).thenReturn("open");
        var result = service.login("code");
        assertThat(result.get("status")).isEqualTo("UNBOUND");
        verify(users, never()).insert(any(UserEntity.class));
        var captor = ArgumentCaptor.forClass(AuthTicketRow.class);
        verify(tickets).insert(captor.capture());
        assertThat(captor.getValue().getTicketKey()).hasSize(32);
        assertThat(captor.getValue().getExpiresAt())
                .isEqualTo(LocalDateTime.of(2026, 10, 30, 0, 5));
    }

    @Test
    void registerCreatesPasswordlessAccountAndConsumesTicket() throws Exception {
        var t = ticket("IDENTITY", "PENDING");
        doAnswer(
                        call -> {
                            UserEntity u = call.getArgument(0);
                            u.setId(1L);
                            return 1;
                        })
                .when(users)
                .insert(any(UserEntity.class));
        when(sessions.issue(any())).thenReturn(Map.of("status", "AUTHENTICATED"));
        service.register(t.getTicketKey());
        var c = ArgumentCaptor.forClass(UserEntity.class);
        verify(users).insert(c.capture());
        assertThat(c.getValue().getUsername()).isNull();
        assertThat(c.getValue().getPasswordHash()).isNull();
        assertThat(t.getStatus()).isEqualTo("CONSUMED");
        assertThat(t.getPayload()).isEqualTo("{}");
        error(() -> service.register(t.getTicketKey()), "WECHAT_TICKET_INVALID");
    }

    @Test
    void staleOrDuplicateIdentityCannotCreateAccount() throws Exception {
        var t = ticket("IDENTITY", "PENDING");
        t.setExpiresAt(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC));
        error(() -> service.register(t.getTicketKey()), "WECHAT_TICKET_INVALID");
        verify(users, never()).insert(any(UserEntity.class));
    }

    @Test
    void bindRechecksPasswordAfterLockAndNeverOverwrites() throws Exception {
        var t = ticket("IDENTITY", "PENDING");
        var u = user();
        var c = new CredentialsParam();
        c.setUsername("alice");
        c.setPassword("password");
        when(auth.login(c, "ip"))
                .thenReturn(new AuthenticatedAccount(new AccountDto("1", "alice", null), "old"));
        error(() -> service.bind(t.getTicketKey(), c, "ip"), "PASSWORD_CHANGED");
        verify(users, never()).updateById(any(UserEntity.class));
        when(auth.login(c, "ip"))
                .thenReturn(
                        new AuthenticatedAccount(new AccountDto("1", "alice", null), "current"));
        u.setWechatOpenId("another");
        error(() -> service.bind(t.getTicketKey(), c, "ip"), "WECHAT_ALREADY_BOUND");
    }

    @Test
    void qrClaimOnlyOriginalBrowserAndOnce() throws Exception {
        user();
        var t = ticket("QR", "CONFIRMED");
        error(() -> service.claim(t.getTicketKey(), "other"), "NOT_FOUND");
        assertThat(service.claim(t.getTicketKey(), "browser").getId()).isEqualTo(1L);
        assertThat(t.getStatus()).isEqualTo("CONSUMED");
        error(() -> service.claim(t.getTicketKey(), "browser"), "QR_NOT_CONFIRMED");
    }

    @Test
    void qrClaimRejectsPasswordChangeAndDisabledAccount() throws Exception {
        var u = user();
        var t = ticket("QR", "CONFIRMED");
        when(auth.fingerprint(u)).thenReturn("changed");
        error(() -> service.claim(t.getTicketKey(), "browser"), "UNAUTHENTICATED");
        assertThat(t.getStatus()).isEqualTo("CONFIRMED");
        u.setStatus("DISABLED");
        error(() -> service.claim(t.getTicketKey(), "browser"), "UNAUTHENTICATED");
    }

    @Test
    void cancellationWinsBeforeClaimAndDoesNotChangeAccount() throws Exception {
        user();
        var t = ticket("QR", "CONFIRMED");
        assertThat(service.decide(t.getTicketKey(), 1L, false).get("status"))
                .isEqualTo("CANCELLED");
        error(() -> service.claim(t.getTicketKey(), "browser"), "QR_EXPIRED");
        verify(users, never()).updateById(any(UserEntity.class));
    }

    @Test
    void expiredAndRefreshedQrCannotBeConfirmedOrClaimed() throws Exception {
        user();
        var t = ticket("QR", "PENDING");
        t.setExpiresAt(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC));
        error(() -> service.decide(t.getTicketKey(), 1L, true), "QR_EXPIRED");
        assertThat(t.getStatus()).isEqualTo("EXPIRED");
        error(() -> service.claim(t.getTicketKey(), "browser"), "QR_EXPIRED");
    }

    @Test
    void refreshInvalidatesOldRequestBeforeWechatCallEvenOnFailure() {
        when(wechat.qr(any())).thenThrow(new ApiException(503, "WECHAT_UNAVAILABLE", "offline"));
        error(() -> service.createQr("browser"), "WECHAT_UNAVAILABLE");
        var order = inOrder(tickets, wechat);
        order.verify(tickets).ensureOwner(any());
        order.verify(tickets).lock(any());
        order.verify(tickets).expireOwner(any());
        order.verify(tickets).insert(any());
        order.verify(wechat).qr(any());
    }

    @Test
    void strictParamsRejectUnknownAndCoercedFields() {
        for (String body :
                List.of(
                        "null",
                        "[]",
                        "{} {}",
                        "{\"code\":1}",
                        "{\"code\":\"ok\",\"userId\":\"1\"}"))
            error(
                    () -> WechatParameters.text(WechatParameters.parse(body, "code"), "code", 256),
                    "VALIDATION_ERROR");
    }

    @Test
    void bindingPasswordPreservesWhitespaceAndUnicode() {
        assertThat(
                        WechatParameters.password(
                                WechatParameters.parse("{\"password\":\"        \"}", "password")))
                .isEqualTo("        ");
        String value = "😀".repeat(64);
        assertThat(
                        WechatParameters.password(
                                WechatParameters.parse(
                                        "{\"password\":\"" + value + "\"}", "password")))
                .isEqualTo(value);
        error(
                () ->
                        WechatParameters.password(
                                WechatParameters.parse("{\"password\":123}", "password")),
                "VALIDATION_ERROR");
    }
}
