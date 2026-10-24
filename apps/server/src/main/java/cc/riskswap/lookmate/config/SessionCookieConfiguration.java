package cc.riskswap.lookmate.config;

import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import java.time.Clock;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration(proxyBeanMethods = false)
public class SessionCookieConfiguration {
    @Bean
    DefaultCookieSerializer cookieSerializer(
            ServerProperties server, AuthProperties auth, Clock clock) {
        var serializer =
                new DefaultCookieSerializer() {
                    @Override
                    public void writeCookieValue(CookieValue value) {
                        if (!value.getCookieValue().isEmpty()) {
                            var session = value.getRequest().getSession(false);
                            if (session != null
                                    && Boolean.TRUE.equals(
                                            session.getAttribute(AuthGuardFilter.REMEMBER_ME))
                                    && session.getAttribute(AuthGuardFilter.LOGIN_AT)
                                            instanceof Long loginAt) {
                                long remaining =
                                        auth.getRememberMeTimeout().toMillis()
                                                - (clock.millis() - loginAt);
                                value.setCookieMaxAge(
                                        (int)
                                                Math.max(
                                                        0,
                                                        Math.min(
                                                                Integer.MAX_VALUE,
                                                                (remaining + 999) / 1000)));
                            }
                        }
                        super.writeCookieValue(value);
                    }
                };
        // 继承部署 Cookie 属性；生命周期按会话决定，普通登录保持会话 Cookie。
        var cookie = server.getServlet().getSession().getCookie();
        if (cookie.getName() != null) serializer.setCookieName(cookie.getName());
        if (cookie.getDomain() != null) serializer.setDomainName(cookie.getDomain());
        if (cookie.getPath() != null) serializer.setCookiePath(cookie.getPath());
        if (cookie.getHttpOnly() != null) serializer.setUseHttpOnlyCookie(cookie.getHttpOnly());
        if (cookie.getSecure() != null) serializer.setUseSecureCookie(cookie.getSecure());
        if (cookie.getSameSite() != null)
            serializer.setSameSite(cookie.getSameSite().attributeValue());
        if (cookie.getPartitioned() != null) serializer.setPartitioned(cookie.getPartitioned());
        return serializer;
    }
}
