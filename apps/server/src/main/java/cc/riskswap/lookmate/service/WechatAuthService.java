package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.CredentialsParam;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.wechat.WechatClient;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class WechatAuthService {
    private final UserMapper users;
    private final AuthTicketMapper tickets;
    private final AuthService auth;
    private final MiniappSessionService sessions;
    private final WechatClient wechat;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;

    public WechatAuthService(
            UserMapper u,
            AuthTicketMapper t,
            AuthService a,
            MiniappSessionService s,
            WechatClient w,
            PlatformTransactionManager tm,
            ObjectMapper j,
            Clock c) {
        users = u;
        tickets = t;
        auth = a;
        sessions = s;
        wechat = w;
        tx = new TransactionTemplate(tm);
        json = j;
        clock = c;
    }

    public Map<String, Object> login(String code) {
        String open = wechat.exchange(code);
        UserEntity u = users.wechat(wechat.appId(), open);
        if (u != null) {
            active(u);
            return sessions.issue(u);
        }
        AuthTicketRow ticket =
                make(
                        "IDENTITY",
                        null,
                        json.writeValueAsString(Map.of("appId", wechat.appId(), "openId", open)));
        tickets.insert(ticket);
        return Map.of(
                "status", "UNBOUND", "ticket", ticket.getTicketKey(), "expiresAt", instant(ticket));
    }

    public Map<String, Object> register(String ticket) {
        UserEntity u;
        try {
            u =
                    tx.execute(
                            s -> {
                                AuthTicketRow t = identity(ticket);
                                var payload = json.readTree(t.getPayload());
                                String app = payload.path("appId").asText(),
                                        open = payload.path("openId").asText();
                                if (users.wechat(app, open) != null) throw conflict();
                                UserEntity row = new UserEntity();
                                row.setStatus("ACTIVE");
                                row.setWechatAppId(app);
                                row.setWechatOpenId(open);
                                row.setAuthVersion(0L);
                                row.setCreatedAt(now());
                                row.setUpdatedAt(now());
                                users.insert(row);
                                t.setStatus("CONSUMED");
                                t.setPayload("{}");
                                tickets.update(t);
                                return row;
                            });
        } catch (DuplicateKeyException e) {
            throw conflict();
        }
        return sessions.issue(u);
    }

    public Map<String, Object> bind(String ticket, CredentialsParam credentials, String ip) {
        var verified = auth.login(credentials, ip);
        UserEntity u;
        try {
            u =
                    tx.execute(
                            s -> {
                                UserEntity row =
                                        users.lock(Long.valueOf(verified.getAccount().getId()));
                                active(row);
                                AuthTicketRow t = identity(ticket);
                                if (!auth.fingerprint(row)
                                        .equals(verified.getPasswordFingerprint()))
                                    throw new ApiException(409, "PASSWORD_CHANGED", "密码已变更，请重新验证");
                                var payload = json.readTree(t.getPayload());
                                String app = payload.path("appId").asText(),
                                        open = payload.path("openId").asText();
                                if (row.getWechatOpenId() != null
                                        || users.wechat(app, open) != null) throw conflict();
                                row.setWechatAppId(app);
                                row.setWechatOpenId(open);
                                row.setUpdatedAt(now());
                                users.updateById(row);
                                t.setStatus("CONSUMED");
                                t.setPayload("{}");
                                tickets.update(t);
                                return row;
                            });
        } catch (DuplicateKeyException e) {
            throw conflict();
        }
        return sessions.issue(u);
    }

    public Map<String, Object> createQr(String owner) {
        AuthTicketRow row = make("QR", hash(owner), "{}");
        tx.executeWithoutResult(
                s -> {
                    tickets.ensureOwner("o" + hash(owner).substring(0, 31));
                    tickets.lock("o" + hash(owner).substring(0, 31));
                    tickets.expireOwner(hash(owner));
                    tickets.insert(row);
                });
        String image = wechat.qr(row.getTicketKey());
        return Map.of("id", row.getTicketKey(), "expiresAt", instant(row), "imageDataUrl", image);
    }

    public Map<String, Object> qrStatus(String key, String owner) {
        return tx.execute(
                s -> {
                    AuthTicketRow row = qr(key);
                    if (owner != null && !Objects.equals(row.getOwnerHash(), hash(owner)))
                        throw missing();
                    return status(row);
                });
    }

    public Map<String, Object> decide(String key, Long userId, boolean confirm) {
        return tx.execute(
                s -> {
                    // user lock precedes auth request lock, matching account write ordering.
                    UserEntity user = users.lock(userId);
                    active(user);
                    AuthTicketRow row = qr(key);
                    requireNotExpired(row);
                    boolean cancelConfirmed =
                            !confirm
                                    && "CONFIRMED".equals(row.getStatus())
                                    && userId.toString()
                                            .equals(
                                                    json.readTree(row.getPayload())
                                                            .path("userId")
                                                            .asText());
                    if (!"PENDING".equals(row.getStatus()) && !cancelConfirmed)
                        throw new ApiException(409, "QR_NOT_PENDING", "登录码已处理，请刷新");
                    row.setStatus(confirm ? "CONFIRMED" : "CANCELLED");
                    row.setPayload(
                            confirm
                                    ? json.writeValueAsString(
                                            Map.of(
                                                    "userId",
                                                    userId.toString(),
                                                    "fingerprint",
                                                    auth.fingerprint(user)))
                                    : "{}");
                    tickets.update(row);
                    return status(row);
                });
    }

    public UserEntity claim(String key, String owner) {
        AuthTicketRow observed = tickets.find(key);
        if (observed == null
                || !"QR".equals(observed.getKind())
                || !Objects.equals(observed.getOwnerHash(), hash(owner))) throw missing();
        String userId = json.readTree(observed.getPayload()).path("userId").asText("");
        return tx.execute(
                s -> {
                    UserEntity user = userId.isBlank() ? null : users.lock(Long.valueOf(userId));
                    AuthTicketRow row = qr(key);
                    if (!Objects.equals(row.getOwnerHash(), hash(owner))) throw missing();
                    requireNotExpired(row);
                    if (!"CONFIRMED".equals(row.getStatus()))
                        throw new ApiException(409, "QR_NOT_CONFIRMED", "登录尚未确认或已领取");
                    var payload = json.readTree(row.getPayload());
                    if (!userId.equals(payload.path("userId").asText()))
                        throw new ApiException(409, "QR_NOT_CONFIRMED", "登录状态已变化，请重试");
                    active(user);
                    if (!auth.fingerprint(user).equals(payload.path("fingerprint").asText()))
                        throw new ApiException(401, "UNAUTHENTICATED", "账号凭据已变化，请重新扫码");
                    row.setStatus("CONSUMED");
                    tickets.update(row);
                    return user;
                });
    }

    private void requireNotExpired(AuthTicketRow row) {
        if (Set.of("EXPIRED", "CANCELLED").contains(row.getStatus()))
            throw new ApiException(410, "QR_EXPIRED", "登录码已过期或取消，请刷新");
    }

    private AuthTicketRow identity(String key) {
        AuthTicketRow t = tickets.lock(key);
        if (t == null
                || !"IDENTITY".equals(t.getKind())
                || !"PENDING".equals(t.getStatus())
                || !t.getExpiresAt().isAfter(now()))
            throw new ApiException(401, "WECHAT_TICKET_INVALID", "登录凭据已失效，请重新登录");
        return t;
    }

    private AuthTicketRow qr(String key) {
        AuthTicketRow row = tickets.lock(key);
        if (row == null || !"QR".equals(row.getKind())) throw missing();
        if (!row.getExpiresAt().isAfter(now())
                && !Set.of("CONSUMED", "CANCELLED").contains(row.getStatus())) {
            row.setStatus("EXPIRED");
            tickets.update(row);
        }
        return row;
    }

    private Map<String, Object> status(AuthTicketRow row) {
        return Map.of(
                "id", row.getTicketKey(), "status", row.getStatus(), "expiresAt", instant(row));
    }

    private AuthTicketRow make(String kind, String owner, String payload) {
        AuthTicketRow t = new AuthTicketRow();
        t.setTicketKey(UUID.randomUUID().toString().replace("-", ""));
        t.setKind(kind);
        t.setOwnerHash(owner);
        t.setPayload(payload);
        t.setStatus("PENDING");
        t.setExpiresAt(now().plusMinutes(5));
        return t;
    }

    private LocalDateTime now() {
        return LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
    }

    private Instant instant(AuthTicketRow row) {
        return row.getExpiresAt().toInstant(ZoneOffset.UTC);
    }

    private void active(UserEntity user) {
        if (user == null || !"ACTIVE".equals(user.getStatus()))
            throw new ApiException(401, "UNAUTHENTICATED", "账号不可用");
    }

    private ApiException conflict() {
        return new ApiException(409, "WECHAT_ALREADY_BOUND", "微信或账号已有绑定，不能覆盖或合并");
    }

    private ApiException missing() {
        return new ApiException(404, "NOT_FOUND", "登录请求不存在");
    }

    private String hash(String input) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
