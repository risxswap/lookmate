package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.mapper.UserMapper;
import cc.riskswap.lookmate.param.ChangePasswordParam;
import cc.riskswap.lookmate.param.CredentialsParam;
import cc.riskswap.lookmate.service.AuthService;
import java.util.ArrayList;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(properties = "lookmate.jobs.enabled=false")
class PasswordIntegrationTest {
    private static final String ID = "-1301";
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @MockitoSpyBean UserMapper users;

    @BeforeEach
    void prepare() {
        clean();
        jdbc.update(
                "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,'password_test',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                ID,
                encoder.encode("original pass"));
    }

    @AfterEach
    void clean() {
        reset(users);
        jdbc.update("DELETE FROM `user` WHERE id=?", ID);
    }

    CredentialsParam credentials(String password) {
        var input = new CredentialsParam();
        input.setUsername("password_test");
        input.setPassword(password);
        return input;
    }

    void error(Runnable operation, String code) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    @Test
    void changesPasswordInvalidatesBothDevicesAndLeavesProfileVersionUnchanged() {
        var first = auth.login(credentials("original pass"), "device1");
        var second = auth.login(credentials("original pass"), "device2");
        auth.changePassword(
                ID, new ChangePasswordParam("original pass", " changed pass "), "device1");
        error(() -> auth.activeAccount(ID, first.getPasswordFingerprint()), "UNAUTHENTICATED");
        error(() -> auth.activeAccount(ID, second.getPasswordFingerprint()), "UNAUTHENTICATED");
        error(() -> auth.login(credentials("original pass"), "device1"), "INVALID_CREDENTIALS");
        var fresh = auth.login(credentials(" changed pass "), "device1");
        assertThat(auth.activeAccount(ID, fresh.getPasswordFingerprint()).getId()).isEqualTo(ID);
        assertThat(jdbc.queryForObject("SELECT version FROM `user` WHERE id=?", Long.class, ID))
                .isZero();
    }

    @Test
    void concurrentChangesHaveOneWinner() throws Exception {
        var barrier = new CyclicBarrier(3);
        var original = users.selectById(ID);
        // 固定三个请求读到同一数据库快照，实际条件更新仍经 MySQL 执行。
        doAnswer(
                        call -> {
                            barrier.await(10, TimeUnit.SECONDS);
                            return original;
                        })
                .when(users)
                .selectById(ID);
        try (var pool = Executors.newFixedThreadPool(3)) {
            var futures = new ArrayList<Future<Boolean>>();
            for (int i = 0; i < 3; i++) {
                int index = i;
                futures.add(
                        pool.submit(
                                () -> {
                                    try {
                                        auth.changePassword(
                                                ID,
                                                new ChangePasswordParam(
                                                        "original pass", "new pass " + index),
                                                "race" + index);
                                        return true;
                                    } catch (ApiException exception) {
                                        assertThat(exception.getCode())
                                                .isEqualTo("PASSWORD_CHANGED");
                                        return false;
                                    }
                                }));
            }
            int winners = 0;
            for (var result : futures) if (result.get(20, TimeUnit.SECONDS)) winners++;
            assertThat(winners).isEqualTo(1);
        }
        String hash =
                jdbc.queryForObject(
                        "SELECT password_hash FROM `user` WHERE id=?", String.class, ID);
        assertThat(encoder.matches("original pass", hash)).isFalse();
        int matches = 0;
        for (int i = 0; i < 3; i++) if (encoder.matches("new pass " + i, hash)) matches++;
        assertThat(matches).isEqualTo(1);
    }

    @Test
    void conditionalUpdateRequiresExactHashBytes() {
        String hash =
                jdbc.queryForObject(
                        "SELECT password_hash FROM `user` WHERE id=?", String.class, ID);
        assertThat(
                        users.changePassword(
                                ID, hash + " ", "replacement", java.time.LocalDateTime.now()))
                .isZero();
        assertThat(
                        users.changePassword(
                                ID,
                                hash.toUpperCase(java.util.Locale.ROOT),
                                "replacement",
                                java.time.LocalDateTime.now()))
                .isZero();
    }
}
