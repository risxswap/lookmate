package cc.riskswap.lookmate.common.model.param;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class LoginParam extends CredentialsParam {
    @NotNull(message = "记住登录必须为布尔值")
    private Boolean rememberMe = false;
}
