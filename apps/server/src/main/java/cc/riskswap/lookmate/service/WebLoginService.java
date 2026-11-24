package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.common.model.dto.AuthenticatedAccount;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.dao.entity.UserEntity;
import jakarta.servlet.http.*;
import java.time.Clock;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.*;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class WebLoginService {
    private final AuthService auth;
    private final AuthProperties properties;
    private final Clock clock;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;

    public AccountDto login(
            UserEntity user, HttpServletRequest request, HttpServletResponse response) {
        return login(auth.authenticated(user), false, request, response);
    }

    public AccountDto login(
            AuthenticatedAccount authenticated,
            boolean rememberMe,
            HttpServletRequest request,
            HttpServletResponse response) {
        var previous = request.getSession(false);
        if (previous != null) previous.invalidate();
        var account = authenticated.getAccount();
        var authentication =
                UsernamePasswordAuthenticationToken.authenticated(
                        account.getId(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
        var session = request.getSession();
        session.setAttribute(AuthGuardFilter.REMEMBER_ME, rememberMe);
        if (rememberMe)
            session.setMaxInactiveInterval(
                    Math.toIntExact(properties.getRememberMeTimeout().getSeconds()));
        session.setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis());
        session.setAttribute(
                AuthGuardFilter.PASSWORD_FINGERPRINT, authenticated.getPasswordFingerprint());
        new CsrfAuthenticationStrategy(csrf).onAuthentication(authentication, request, response);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        return account;
    }
}
