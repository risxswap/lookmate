package cc.riskswap.lookmate.controller;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiResponse;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.dto.AccountDto;
import cc.riskswap.lookmate.param.CredentialsParam;
import cc.riskswap.lookmate.param.ChangePasswordParam;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService auth;
    private final AuthProperties properties;
    private final Clock clock;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrfTokens;

    @GetMapping("/config")
    public ApiResponse<?> config(HttpServletRequest request) {
        return response(Map.of("registrationEnabled", properties.isRegistrationEnabled()), request);
    }

    @GetMapping("/csrf")
    public ApiResponse<?> csrf(CsrfToken token, HttpServletRequest request) {
        return response(Map.of("token", token.getToken(), "headerName", token.getHeaderName()), request);
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<AccountDto> register(@Valid @RequestBody CredentialsParam credentials,
                                           HttpServletRequest request) {
        return response(auth.register(credentials), request);
    }

    @PostMapping("/login")
    public ApiResponse<AccountDto> login(@Valid @RequestBody CredentialsParam credentials,
                                        HttpServletRequest request, HttpServletResponse response) {
        var authenticated = auth.login(credentials, request.getRemoteAddr());
        AccountDto account = authenticated.getAccount();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(account.getId(), null,
                List.of(new SimpleGrantedAuthority("ROLE_USER")));
        new ChangeSessionIdAuthenticationStrategy().onAuthentication(authentication, request, response);
        new CsrfAuthenticationStrategy(csrfTokens).onAuthentication(authentication, request, response);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        request.getSession().setAttribute(AuthGuardFilter.LOGIN_AT, clock.millis());
        request.getSession().setAttribute(AuthGuardFilter.PASSWORD_FINGERPRINT, authenticated.getPasswordFingerprint());
        contexts.saveContext(context, request, response);
        return response(account, request);
    }

    @GetMapping("/me")
    public ApiResponse<AccountDto> me(HttpServletRequest request) {
        return response((AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT), request);
    }

    @PostMapping("/password")
    public ApiResponse<Void> changePassword(@RequestBody String body, HttpServletRequest request,
                                            HttpServletResponse response) {
        AccountDto account = (AccountDto) request.getAttribute(AuthGuardFilter.ACCOUNT);
        auth.changePassword(account.getId(), ChangePasswordParam.parse(body), request.getRemoteAddr());
        return logout(request, response);
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
        contexts.saveContext(SecurityContextHolder.createEmptyContext(), request, response);
        return response(null, request);
    }

    private <T> ApiResponse<T> response(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
