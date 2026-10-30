package cc.riskswap.lookmate.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties("lookmate.wechat")
public class WechatProperties {
    private String appId = "";
    private String appSecret = "";
    private String apiBaseUrl = "https://api.weixin.qq.com";
    private String codePage = "pages/scan/index";
    private String envVersion = "develop";
}
