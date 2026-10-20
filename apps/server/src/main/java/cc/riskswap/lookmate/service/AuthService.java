package cc.riskswap.lookmate.service;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.config.AuthProperties;
import cc.riskswap.lookmate.dto.AccountDto;
import cc.riskswap.lookmate.entity.UserEntity;
import cc.riskswap.lookmate.mapper.UserMapper;
import cc.riskswap.lookmate.param.CredentialsParam;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
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

    public AuthService(UserMapper users, PasswordEncoder passwords, AuthProperties properties,
                       AuthRateLimiter limits, Clock clock) {
        this.users = users;
        this.passwords = passwords;
        this.properties = properties;
        this.limits = limits;
        this.clock = clock;
        this.dummyHash = passwords.encode(java.util.UUID.randomUUID().toString());
    }

    public AccountDto register(CredentialsParam credentials) {
        if (!properties.isRegistrationEnabled()) {
            throw new ApiException(403, "REGISTRATION_CLOSED", "暂未开放注册");
        }
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

    public AccountDto login(CredentialsParam credentials, String ip) {
        validatePassword(credentials.getPassword());
        String username = credentials.getUsername().toLowerCase(Locale.ROOT);
        limits.checkFailure(ip, username);
        UserEntity user = users.selectOne(new LambdaQueryWrapper<UserEntity>()
                .eq(UserEntity::getUsername, username));
        boolean matched = passwords.matches(credentials.getPassword(), user == null ? dummyHash : user.getPasswordHash());
        if (!matched || user == null || !"ACTIVE".equals(user.getStatus())) {
            limits.failed(ip, username);
            throw new ApiException(401, "INVALID_CREDENTIALS", "用户名或密码错误");
        }
        limits.succeeded(ip, username);
        return AccountDto.from(user);
    }

    public AccountDto activeAccount(String id) {
        UserEntity user = users.selectById(id);
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new ApiException(401, "UNAUTHENTICATED", "请重新登录");
        }
        return AccountDto.from(user);
    }

    private void validatePassword(String password) {
        int length = password.codePointCount(0, password.length());
        if (length < 8 || length > 64) {
            throw new ApiException(400, "VALIDATION_ERROR", "密码须为 8～64 位");
        }
    }
}
