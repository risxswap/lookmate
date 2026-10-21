package cc.riskswap.lookmate.storage;

import cc.riskswap.lookmate.config.AssetProperties;
import com.qiniu.common.QiniuException;
import com.qiniu.storage.*;
import com.qiniu.util.Auth;
import com.qiniu.util.StringMap;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.stereotype.Component;

@Component
public class QiniuObjectStorage implements ObjectStorage {
    private final AssetProperties properties;
    private final HttpClient client =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public QiniuObjectStorage(AssetProperties properties) {
        this.properties = properties;
    }

    public boolean available() {
        return !properties.getAccessKey().isBlank()
                && !properties.getSecretKey().isBlank()
                && !properties.getBucket().isBlank()
                && https(properties.getDownloadDomain())
                && https(properties.getUploadUrl());
    }

    private static boolean https(String value) {
        try {
            var u = URI.create(value);
            return "https".equals(u.getScheme()) && u.getHost() != null && u.getUserInfo() == null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private Auth auth() {
        return Auth.create(properties.getAccessKey(), properties.getSecretKey());
    }

    private Configuration configuration() {
        var c = Configuration.create();
        c.useHttpsDomains = true;
        c.connectTimeout = 10;
        c.readTimeout = 30;
        c.writeTimeout = 30;
        c.retryMax = 0;
        return c;
    }

    public String bucket() {
        return properties.getBucket();
    }

    public String uploadUrl() {
        return properties.getUploadUrl();
    }

    public String uploadToken(String key, long seconds, long maxBytes) {
        return auth().uploadToken(
                        bucket(),
                        key,
                        seconds,
                        new StringMap().put("insertOnly", 1).put("fsizeLimit", maxBytes),
                        true);
    }

    public String signedUrl(String bucket, String key, long seconds) {
        if (!bucket().equals(bucket))
            throw new IllegalArgumentException("Storage bucket unavailable");
        String encoded =
                URLEncoder.encode(key, StandardCharsets.UTF_8)
                        .replace("+", "%20")
                        .replace("%2F", "/");
        return auth().privateDownloadUrl(
                        properties.getDownloadDomain().replaceAll("/$", "") + "/" + encoded,
                        seconds);
    }

    public byte[] read(String bucket, String key, int maxBytes) throws Exception {
        var request =
                HttpRequest.newBuilder(URI.create(signedUrl(bucket, key, 120)))
                        .timeout(Duration.ofSeconds(45))
                        .GET()
                        .build();
        HttpResponse<byte[]> result;
        try {
            result = BoundedHttp.send(client, request, maxBytes, 45);
        } catch (java.util.concurrent.ExecutionException e) {
            if (e.getCause() instanceof BoundedHttp.BodyTooLargeException)
                throw new InvalidImageException("图片超过大小限制");
            throw e;
        }
        if (result.statusCode() != 200) throw new java.io.IOException("Storage read unavailable");
        return result.body();
    }

    public void put(String bucket, String key, byte[] bytes, String mime) throws Exception {
        var a = auth();
        String token = a.uploadToken(bucket, key, 300, new StringMap().put("insertOnly", 1), true);
        try {
            var response =
                    new UploadManager(configuration()).put(bytes, key, token, null, mime, false);
            try {
                if (!response.isOK()) throw new java.io.IOException("Storage upload unavailable");
            } finally {
                response.close();
            }
        } catch (QiniuException e) {
            // Stable immutable target keys make recovery idempotent. Existing bytes must match.
            if (e.code() != 614 || !java.util.Arrays.equals(bytes, read(bucket, key, bytes.length)))
                throw e;
        }
    }

    public void delete(String bucket, String key) throws Exception {
        if (key == null) return;
        try {
            var response = new BucketManager(auth(), configuration()).delete(bucket, key);
            try {
                if (!response.isOK()) throw new java.io.IOException("Storage deletion unavailable");
            } finally {
                response.close();
            }
        } catch (QiniuException e) {
            if (e.code() != 612) throw e;
        }
    }
}
