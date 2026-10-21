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

    public static AccountDto from(UserEntity user) {
        return new AccountDto(user.getId().toString(), user.getUsername(), user.getDisplayName());
    }
}
