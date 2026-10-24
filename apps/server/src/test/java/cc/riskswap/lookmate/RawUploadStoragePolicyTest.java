package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.integration.storage.QiniuObjectStorage;
import com.qiniu.util.Auth;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class RawUploadStoragePolicyTest {
    private final QiniuObjectStorage storage = new QiniuObjectStorage(properties());

    @Test
    void uploadCredentialLimitsActualMimeSizeAndOverwrite() {
        String token = storage.uploadToken("original/account/photo", 600, 20971520);
        var policy =
                new JsonMapper()
                        .readTree(
                                new String(
                                        Base64.getUrlDecoder().decode(token.split(":")[2]),
                                        StandardCharsets.UTF_8));
        assertThat(policy.path("mimeLimit").asText()).isEqualTo("image/jpeg;image/png;image/webp");
        assertThat(policy.path("fsizeLimit").asLong()).isEqualTo(20971520);
        assertThat(policy.path("insertOnly").asInt()).isEqualTo(1);
        assertThat(policy.path("detectMime").asInt()).isEqualTo(1);
        assertThat(policy.path("scope").asText())
                .isEqualTo("private-bucket:original/account/photo");
    }

    @Test
    void thumbnailProcessingIsPartOfPrivateSignatureAndOriginalHasNoProcessing() {
        String thumbnail = storage.thumbnailUrl("private-bucket", "original/account/a b.png", 300);
        assertThat(thumbnail)
                .startsWith(
                        "https://private.example/original/account/a%20b.png?imageView2/2/w/320/h/320&e=");
        assertValidSignature(thumbnail);
        String original = storage.signedUrl("private-bucket", "original/account/a b.png", 300);
        assertThat(original)
                .startsWith("https://private.example/original/account/a%20b.png?e=")
                .doesNotContain("imageView2");
        assertValidSignature(original);
    }

    private static void assertValidSignature(String url) {
        int delimiter = url.lastIndexOf("&token=");
        String signedContent = url.substring(0, delimiter);
        String token = url.substring(delimiter + "&token=".length());
        assertThat(token).isEqualTo(Auth.create("test-access", "test-secret").sign(signedContent));
    }

    private static AssetProperties properties() {
        var properties = new AssetProperties();
        properties.setAccessKey("test-access");
        properties.setSecretKey("test-secret");
        properties.setBucket("private-bucket");
        properties.setDownloadDomain("https://private.example");
        properties.setUploadUrl("https://upload.example");
        return properties;
    }
}
