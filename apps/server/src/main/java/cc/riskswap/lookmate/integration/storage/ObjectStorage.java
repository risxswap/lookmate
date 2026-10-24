package cc.riskswap.lookmate.integration.storage;

public interface ObjectStorage {
    boolean available();

    String bucket();

    String uploadUrl();

    String uploadToken(String key, long seconds, long maxBytes);

    String signedUrl(String bucket, String key, long seconds);

    record Metadata(long sizeBytes, String mimeType) {}

    /** Returns null when the object does not exist. */
    Metadata stat(String bucket, String key) throws Exception;

    String thumbnailUrl(String bucket, String key, long seconds);

    byte[] read(String bucket, String key, int maxBytes) throws Exception;

    void put(String bucket, String key, byte[] bytes, String mime) throws Exception;

    void delete(String bucket, String key) throws Exception;
}
