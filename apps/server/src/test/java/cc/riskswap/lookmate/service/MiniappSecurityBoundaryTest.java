package cc.riskswap.lookmate.service;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.config.SecurityConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import tools.jackson.databind.json.JsonMapper;

class MiniappSecurityBoundaryTest {
    AnnotationConfigWebApplicationContext context;
    MockMvc mvc;

    @BeforeEach
    void setup() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(Config.class);
        context.refresh();
        mvc =
                MockMvcBuilders.standaloneSetup(new Endpoints())
                        .addFilters(context.getBean(FilterChainProxy.class))
                        .build();
        when(context.getBean(MiniappSessionService.class).validate("valid"))
                .thenReturn(new AccountDto("1", null, null));
    }

    @AfterEach
    void close() {
        context.close();
    }

    @Test
    void browserQrStillRequiresCsrf() throws Exception {
        mvc.perform(post("/api/auth/qr").servletPath("/api/auth/qr"))
                .andExpect(status().isForbidden());
    }

    @Test
    void validMiniappCredentialCanWriteWithoutCookieCsrf() throws Exception {
        mvc.perform(
                        post("/api/profile")
                                .servletPath("/api/profile")
                                .header("X-Miniapp-Token", "valid"))
                .andExpect(status().isOk());
    }

    @Test
    void onlyExplicitPublicWechatExchangeIsCsrfExempt() throws Exception {
        mvc.perform(post("/api/auth/wechat/login").servletPath("/api/auth/wechat/login"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").servletPath("/api/auth/login"))
                .andExpect(status().isForbidden());
    }

    @Configuration
    @EnableWebSecurity
    @Import(SecurityConfiguration.class)
    static class Config {
        @Bean
        AuthService auth() {
            return mock(AuthService.class);
        }

        @Bean
        MiniappSessionService mini() {
            return mock(MiniappSessionService.class);
        }

        @Bean
        AuthRateLimiter limits() {
            return mock(AuthRateLimiter.class);
        }

        @Bean
        ApiErrors errors() {
            return new ApiErrors(JsonMapper.builder().build());
        }
    }

    @RestController
    static class Endpoints {
        @PostMapping({"/api/auth/qr", "/api/profile", "/api/auth/wechat/login", "/api/auth/login"})
        String post() {
            return "ok";
        }
    }
}
