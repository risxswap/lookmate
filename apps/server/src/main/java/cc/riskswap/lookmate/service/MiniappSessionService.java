package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.dao.entity.UserEntity;
import java.time.*;
import java.util.*;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.stereotype.Service;

@Service
public class MiniappSessionService {
    public static final String HEADER = "X-Miniapp-Token";
    public static final String VERIFIED = "lookmate.miniappVerified";
    private final SessionRepository<Session> sessions;
    private final AuthService auth;
    private final Clock clock;

    @SuppressWarnings("unchecked")
    public MiniappSessionService(SessionRepository<?> sessions, AuthService auth, Clock clock) {
        this.sessions = (SessionRepository<Session>) sessions;
        this.auth = auth;
        this.clock = clock;
    }

    public Map<String, Object> issue(UserEntity user) {
        Session s = sessions.createSession();
        s.setMaxInactiveInterval(Duration.ofDays(30));
        s.setAttribute("miniapp", true);
        s.setAttribute("userId", user.getId().toString());
        s.setAttribute("fingerprint", auth.fingerprint(user));
        Instant expiry = clock.instant().plus(Duration.ofDays(30));
        s.setAttribute("expires", expiry.toEpochMilli());
        sessions.save(s);
        return Map.of(
                "status",
                "AUTHENTICATED",
                "token",
                s.getId(),
                "expiresAt",
                expiry,
                "account",
                AccountDto.from(user));
    }

    public AccountDto validate(String token) {
        if (token == null || token.length() > 256 || token.isBlank()) throw invalid();
        Session s = sessions.findById(token);
        if (s == null || !Boolean.TRUE.equals(s.getAttribute("miniapp"))) throw invalid();
        Long expiry = s.getAttribute("expires");
        if (expiry == null || clock.millis() >= expiry) {
            sessions.deleteById(token);
            throw invalid();
        }
        try {
            return auth.activeAccount(s.getAttribute("userId"), s.getAttribute("fingerprint"));
        } catch (ApiException e) {
            sessions.deleteById(token);
            throw e;
        }
    }

    private ApiException invalid() {
        return new ApiException(401, "UNAUTHENTICATED", "登录已失效，请重新登录");
    }
}
