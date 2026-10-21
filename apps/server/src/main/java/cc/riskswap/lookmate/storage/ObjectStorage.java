package cc.riskswap.lookmate.storage;

public interface ObjectStorage {
    boolean available();

    String bucket();

    String uploadUrl();

    String uploadToken(String key, long seconds, long maxBytes);

    String signedUrl(String bucket, String key, long seconds);

    byte[] read(String bucket, String key, int maxBytes) throws Exception;

    void put(String bucket, String key, byte[] bytes, String mime) throws Exception;

    void delete(String bucket, String key) throws Exception;
}
