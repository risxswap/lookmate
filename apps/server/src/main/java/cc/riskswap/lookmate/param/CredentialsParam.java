package cc.riskswap.lookmate.param;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class CredentialsParam {
    @NotNull(message = "请输入用户名")
    @Pattern(regexp = "[A-Za-z0-9_]{4,32}", message = "用户名须为 4～32 位英文字母、数字或下划线")
    private String username;

    @NotNull(message = "请输入密码")
    private String password;
}
