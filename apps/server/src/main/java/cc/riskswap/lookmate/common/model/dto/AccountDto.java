package cc.riskswap.lookmate.common.model.dto;

import cc.riskswap.lookmate.dao.entity.UserEntity;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class AccountDto {
    private final String id;
    private final String username;
    private final String displayName;
    private final boolean hasPassword;
    private final boolean wechatBound;
    private final String avatarFileId;

    public AccountDto(String id, String username, String displayName) {
        this(id, username, displayName, true, false, null);
    }

    public static AccountDto from(UserEntity u) {
        return new AccountDto(
                u.getId().toString(),
                u.getUsername(),
                u.getDisplayName(),
                u.getPasswordHash() != null,
                u.getWechatOpenId() != null,
                u.getAvatarFileId() == null ? null : u.getAvatarFileId().toString());
    }
}
