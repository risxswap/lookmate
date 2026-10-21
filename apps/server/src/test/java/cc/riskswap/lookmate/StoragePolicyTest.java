package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.storage.QiniuObjectStorage;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class StoragePolicyTest {
    @Test
    void uploadTokenIsSingleObjectInsertOnlyAndBounded() {
        var p = new AssetProperties();
        p.setAccessKey("test-access");
        p.setSecretKey("test-secret");
        p.setBucket("private-bucket");
        p.setDownloadDomain("https://private.example");
        p.setUploadUrl("https://upload.example");
        var storage = new QiniuObjectStorage(p);
        assertThat(storage.available()).isTrue();
        String token = storage.uploadToken("original/user/unique", 600, 20971520);
        String policy =
                new String(
                        Base64.getUrlDecoder().decode(token.split(":")[2]),
                        java.nio.charset.StandardCharsets.UTF_8);
        var json = new tools.jackson.databind.json.JsonMapper().readTree(policy);
        assertThat(json.path("scope").asText()).isEqualTo("private-bucket:original/user/unique");
        assertThat(json.path("insertOnly").asInt()).isEqualTo(1);
        assertThat(json.path("fsizeLimit").asLong()).isEqualTo(20971520);
        assertThat(json.path("deadline").asLong())
                .isBetween(
                        System.currentTimeMillis() / 1000 + 590,
                        System.currentTimeMillis() / 1000 + 610);
        assertThat(storage.signedUrl("private-bucket", "display/user/unique.jpg", 300))
                .startsWith("https://private.example/display/user/unique.jpg?e=")
                .contains("&token=test-access:");
    }
}
