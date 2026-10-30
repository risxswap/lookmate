package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.common.model.dto.AuthenticatedAccount;
import cc.riskswap.lookmate.common.model.param.ChangePasswordParam;
import cc.riskswap.lookmate.common.model.param.CredentialsParam;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.dao.entity.UserEntity;
import cc.riskswap.lookmate.dao.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Locale;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
    private final UserMapper users;
    private final PasswordEncoder passwords;
    private final AuthProperties properties;
    private final AuthRateLimiter limits;
    private final Clock clock;
    private final String dummyHash;

    public AuthService(
            UserMapper users,
            PasswordEncoder passwords,
            AuthProperties properties,
            AuthRateLimiter limits,
            Clock clock) {
        this.users = users;
        this.passwords = passwords;
        this.properties = properties;
        this.limits = limits;
        this.clock = clock;
        this.dummyHash = passwords.encode(java.util.UUID.randomUUID().toString());
    }

    public AccountDto register(CredentialsParam credentials) {
        validatePassword(credentials.getPassword());
        UserEntity user = new UserEntity();
        user.setUsername(credentials.getUsername().toLowerCase(Locale.ROOT));
        // 哈希在数据库写入前计算，避免长事务。
        user.setPasswordHash(passwords.encode(credentials.getPassword()));
        user.setStatus("ACTIVE");
        LocalDateTime now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        try {
            users.insert(user);
        } catch (DuplicateKeyException exception) {
            throw new ApiException(409, "USERNAME_TAKEN", "用户名已被使用");
        }
        return AccountDto.from(user);
    }

    public AuthenticatedAccount login(CredentialsParam credentials, String ip) {
        validatePassword(credentials.getPassword());
        String username = credentials.getUsername().toLowerCase(Locale.ROOT);
        limits.checkFailure(ip, username);
        UserEntity user =
                users.selectOne(
                        new LambdaQueryWrapper<UserEntity>().eq(UserEntity::getUsername, username));
        boolean matched =
                passwords.matches(
                        credentials.getPassword(),
                        user == null || user.getPasswordHash() == null
                                ? dummyHash
                                : user.getPasswordHash());
        if (!matched || user == null || !"ACTIVE".equals(user.getStatus())) {
            limits.failed(ip, username);
            throw new ApiException(401, "INVALID_CREDENTIALS", "用户名或密码错误");
        }
        limits.succeeded(ip, username);
        return new AuthenticatedAccount(AccountDto.from(user), fingerprint(user));
    }

    public void changePassword(String id, ChangePasswordParam input, String ip) {
        validatePassword(input.getCurrentPassword());
        validatePassword(input.getNewPassword());
        if (input.getCurrentPassword().equals(input.getNewPassword())) {
            throw new ApiException(400, "VALIDATION_ERROR", "新密码不能与原密码相同");
        }
        limits.checkPasswordFailure(ip, id);
        UserEntity user = users.selectById(id);
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new ApiException(401, "UNAUTHENTICATED", "请重新登录");
        }
        if (user.getPasswordHash() == null)
            throw new ApiException(400, "PASSWORD_NOT_SET", "该账号未设置密码");
        if (!passwords.matches(input.getCurrentPassword(), user.getPasswordHash())) {
            limits.passwordFailed(ip, id);
            throw new ApiException(400, "CURRENT_PASSWORD_INCORRECT", "原密码错误");
        }
        // 昂贵的哈希运算在单条原子更新事务之外执行。
        String newHash = passwords.encode(input.getNewPassword());
        limits.passwordSucceeded(ip, id);
        if (users.changePassword(
                        id,
                        user.getPasswordHash(),
                        newHash,
                        LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
                != 1) {
            throw new ApiException(409, "PASSWORD_CHANGED", "密码已变更，请核对最新密码或重新登录");
        }
    }

    public AccountDto activeAccount(String id, String sessionFingerprint) {
        UserEntity user = users.selectById(id);
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new ApiException(401, "UNAUTHENTICATED", "请重新登录");
        }
        if (sessionFingerprint == null
                || !MessageDigest.isEqual(
                        fingerprint(user).getBytes(StandardCharsets.UTF_8),
                        sessionFingerprint.getBytes(StandardCharsets.UTF_8))) {
            throw new ApiException(401, "UNAUTHENTICATED", "密码已变更，请重新登录");
        }
        return AccountDto.from(user);
    }

    public String fingerprint(UserEntity user) {
        String hash =
                (user.getPasswordHash() == null ? "wechat" : user.getPasswordHash())
                        + ":"
                        + (user.getAuthVersion() == null ? 0 : user.getAuthVersion());
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(hash.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private void validatePassword(String password) {
        if (password == null) {
            throw new ApiException(400, "VALIDATION_ERROR", "请输入密码");
        }
        int length = password.codePointCount(0, password.length());
        if (length < 8 || length > 64) {
            throw new ApiException(400, "VALIDATION_ERROR", "密码须为 8～64 位");
        }
    }
}
