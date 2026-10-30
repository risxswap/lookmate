package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
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
    private final Clock clock;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;

    public AccountDto login(
            UserEntity user, HttpServletRequest request, HttpServletResponse response) {
        if (request.getSession(false) != null) request.getSession(false).invalidate();
        var account = AccountDto.from(user);
        var authentication =
                UsernamePasswordAuthenticationToken.authenticated(
                        account.getId(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
        var session = request.getSession();
        session.setAttribute(AuthGuardFilter.REMEMBER_ME, false);
        session.setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis());
        session.setAttribute(AuthGuardFilter.PASSWORD_FINGERPRINT, auth.fingerprint(user));
        new CsrfAuthenticationStrategy(csrf).onAuthentication(authentication, request, response);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        return account;
    }
}
