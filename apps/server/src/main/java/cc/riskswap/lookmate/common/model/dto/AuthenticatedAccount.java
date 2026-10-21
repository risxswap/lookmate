package cc.riskswap.lookmate.common.model.dto;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/** 仅用于服务端建立会话，不作为接口响应。 */
@Getter
@RequiredArgsConstructor
public final class AuthenticatedAccount {
    private final AccountDto account;
    private final String passwordFingerprint;
}
