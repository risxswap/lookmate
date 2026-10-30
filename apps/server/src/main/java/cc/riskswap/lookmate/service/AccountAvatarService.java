package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.dao.mapper.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AccountAvatarService {
    private final UserMapper users;
    private final FileMapper files;
    private final DressMapper dresses;
    private final TransactionTemplate tx;

    public AccountAvatarService(
            UserMapper u, FileMapper f, DressMapper d, PlatformTransactionManager tm) {
        users = u;
        files = f;
        dresses = d;
        tx = new TransactionTemplate(tm);
    }

    public AccountDto save(Long user, Long file) {
        return tx.execute(
                s -> {
                    var u = users.lock(user);
                    if (u == null || !"ACTIVE".equals(u.getStatus()))
                        throw new ApiException(401, "UNAUTHENTICATED", "账号不可用");
                    Long old = u.getAvatarFileId();
                    var ids = new TreeSet<Long>();
                    if (old != null) ids.add(old);
                    if (file != null) ids.add(file);
                    for (Long id : ids) {
                        var asset = files.lock(user, id);
                        if (Objects.equals(id, file)
                                && (asset == null
                                        || !Set.of("TEMP", "READY").contains(asset.getStatus())
                                        || (asset.getExpiresAt() != null
                                                && !asset.getExpiresAt()
                                                        .isAfter(asset.getDbNow()))))
                            throw new ApiException(400, "FILE_NOT_READY", "头像图片不可用，请重新上传");
                    }
                    if (file != null) dresses.bindFile(user, file);
                    users.avatar(user, file);
                    if (old != null && !Objects.equals(old, file))
                        dresses.scheduleCleanup(user, old);
                    u.setAvatarFileId(file);
                    return AccountDto.from(u);
                });
    }
}
