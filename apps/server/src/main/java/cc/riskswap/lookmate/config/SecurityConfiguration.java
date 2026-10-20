package cc.riskswap.lookmate.config;

import java.time.Clock;
import java.util.Map;
import cc.riskswap.lookmate.api.ApiErrors;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.AuthRateLimiter;
import cc.riskswap.lookmate.service.AuthService;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthProperties.class)
public class SecurityConfiguration {
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new DelegatingPasswordEncoder("pbkdf2", Map.of("pbkdf2",
                Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8()));
    }

    @Bean
    HttpSessionSecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    HttpSessionCsrfTokenRepository csrfTokenRepository() {
        return new HttpSessionCsrfTokenRepository();
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ApiErrors errors, AuthService auth,
            AuthRateLimiter limits, AuthProperties properties, Clock clock,
            HttpSessionSecurityContextRepository contexts, HttpSessionCsrfTokenRepository csrfTokens) throws Exception {
        return http
                .securityContext(context -> context.securityContextRepository(contexts))
                .csrf(csrf -> csrf.csrfTokenRepository(csrfTokens)
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .addFilterAfter(new AuthGuardFilter(auth, limits, properties, clock), SecurityContextHolderFilter.class)
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/liveness",
                                "/api/auth/config", "/api/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login", "/api/auth/logout").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().denyAll())
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) -> errors.write(request, response,
                                new ApiException(401, "UNAUTHENTICATED", "请先登录")))
                        .accessDeniedHandler((request, response, exception) -> errors.write(request, response,
                                exception instanceof CsrfException
                                        ? new ApiException(403, "CSRF_INVALID", "页面凭证已失效，请重试")
                                        : new ApiException(403, "FORBIDDEN", "无法执行此操作"))))
                .build();
    }

    @Bean
    UserDetailsService userDetailsService() {
        // JSON 登录由 AuthService 完成，禁用 Boot 默认账号。
        return new InMemoryUserDetailsManager();
    }
}
