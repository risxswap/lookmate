package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.integration.ai.GenerationGateway;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Versioned platform resources are retained independently of user file cleanup. */
@Service
public class HairstyleCatalogService {
    private final String currentVersion;

    public HairstyleCatalogService() {
        this("v1");
    }

    HairstyleCatalogService(String currentVersion) {
        this.currentVersion = currentVersion;
    }

    private static final String URL_PREFIX = "/api/hairstyles/assets/";
    private static final int MAX_ASSET_BYTES = 20 * 1024 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final java.util.concurrent.ConcurrentMap<String, List<Map<String, Object>>> catalogs =
            new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.ConcurrentMap<String, Map<String, Object>> descriptions =
            new java.util.concurrent.ConcurrentHashMap<>();

    public PageDto<Map<String, Object>> list(
            String page, String pageSize, String length, String bangs, String texture) {
        int p = pageNumber(page, 1, Integer.MAX_VALUE);
        int size = pageNumber(pageSize, 20, 100);
        filter(length, Set.of("SHORT", "MEDIUM", "LONG"));
        filter(bangs, Set.of("NONE", "LIGHT", "FULL"));
        filter(texture, Set.of("STRAIGHT", "WAVY", "CURLY"));
        var selected =
                catalog(currentVersion).stream()
                        .filter(this::active)
                        .filter(row -> length == null || length.equals(row.get("length")))
                        .filter(row -> bangs == null || bangs.equals(row.get("bangs")))
                        .filter(row -> texture == null || texture.equals(row.get("texture")))
                        .toList();
        long offset = (long) (p - 1) * size;
        var items = selected.stream().skip(offset).limit(size).map(this::describe).toList();
        return new PageDto<>(items, p, size, (long) selected.size());
    }

    public Map<String, Object> detail(String id) {
        if (id == null || !id.matches("[a-z0-9][a-z0-9-]{0,63}")) throw missing();
        return catalog(currentVersion).stream()
                .filter(this::active)
                .filter(row -> id.equals(row.get("id")))
                .findFirst()
                .map(this::describe)
                .orElseThrow(HairstyleCatalogService::missing);
    }

    public Map<String, Object> select(String id, String version) {
        var selected = detail(id);
        if (!Objects.equals(version, selected.get("version")))
            throw new ApiException(409, "HAIRSTYLE_CHANGED", "发型款式已更新，请重新选择");
        return selected;
    }

    public byte[] asset(String version, String filename) {
        if (version == null
                || !version.matches("v[1-9][0-9]{0,8}")
                || filename == null
                || !filename.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\\.(png|jpg|jpeg|webp)"))
            throw missing();
        boolean registered =
                catalog(version).stream()
                        .flatMap(row -> images(row).stream())
                        .anyMatch(image -> filename.equals(image.get("filename")));
        if (!registered) throw missing();
        return readAsset(version, filename);
    }

    public List<GenerationGateway.Image> references(Map<String, Object> snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return List.of();
        String version = String.valueOf(snapshot.get("version"));
        var result = new ArrayList<GenerationGateway.Image>();
        for (var image : images(snapshot)) {
            String url = String.valueOf(image.get("url"));
            String prefix = URL_PREFIX + version + "/";
            if (!url.startsWith(prefix)) throw missing();
            byte[] bytes = asset(version, url.substring(prefix.length()));
            if (!Objects.equals(image.get("sha256"), sha(bytes)))
                throw new ApiException(409, "RETRY_INPUT_UNAVAILABLE", "原发型参考图片已改变，无法复用");
            result.add(
                    new GenerationGateway.Image(
                            "hairstyle:"
                                    + snapshot.get("id")
                                    + ":"
                                    + version
                                    + ":"
                                    + image.get("id"),
                            bytes));
        }
        if (result.isEmpty()) throw missing();
        return result;
    }

    public long referenceBytes(Map<String, Object> snapshot) {
        long total = 0;
        if (snapshot == null || snapshot.isEmpty()) return 0;
        String version = String.valueOf(snapshot.get("version"));
        var original =
                catalog(version).stream()
                        .filter(row -> Objects.equals(row.get("id"), snapshot.get("id")))
                        .findFirst()
                        .map(this::describe)
                        .orElseThrow(HairstyleCatalogService::missing);
        if (!Objects.equals(original.get("images"), snapshot.get("images")))
            throw new ApiException(409, "RETRY_INPUT_UNAVAILABLE", "原发型参考图片已改变，无法复用");
        for (var image : images(original))
            total = Math.addExact(total, ((Number) image.get("sizeBytes")).longValue());
        return total;
    }

    private boolean active(Map<String, Object> row) {
        return !Boolean.FALSE.equals(row.get("active"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> describe(Map<String, Object> row) {
        var cached =
                descriptions.computeIfAbsent(
                        row.get("version") + ":" + row.get("id"), key -> describeUncached(row));
        return JSON.convertValue(cached, Map.class);
    }

    private Map<String, Object> describeUncached(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        for (String key :
                List.of(
                        "id",
                        "version",
                        "name",
                        "length",
                        "bangs",
                        "texture",
                        "description",
                        "careAdvice")) result.put(key, row.get(key));
        String version = String.valueOf(row.get("version"));
        var photos = new ArrayList<Map<String, Object>>();
        for (var image : images(row)) {
            String filename = String.valueOf(image.get("filename"));
            byte[] bytes = readAsset(version, filename);
            photos.add(
                    Map.of(
                            "id",
                            image.get("id"),
                            "angle",
                            image.get("angle"),
                            "url",
                            URL_PREFIX + version + "/" + filename,
                            "sha256",
                            sha(bytes),
                            "sizeBytes",
                            bytes.length));
        }
        result.put("images", photos);
        return result;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> catalog(String version) {
        return catalogs.computeIfAbsent(version, this::loadCatalog);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> loadCatalog(String version) {
        if (!version.matches("v[1-9][0-9]{0,8}")) throw missing();
        var resource = new ClassPathResource("hairstyles/" + version + "/catalog.json");
        if (!resource.exists()) throw missing();
        try (var input = resource.getInputStream()) {
            return JSON.readValue(input, List.class);
        } catch (IOException | RuntimeException e) {
            throw new ApiException(503, "HAIRSTYLE_CATALOG_UNAVAILABLE", "发型图库暂不可用");
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> images(Map<String, Object> row) {
        return (List<Map<String, Object>>) row.getOrDefault("images", List.of());
    }

    private byte[] readAsset(String version, String filename) {
        if (!version.matches("v[1-9][0-9]{0,8}")
                || !filename.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\\.(png|jpg|jpeg|webp)"))
            throw missing();
        try (var input =
                new ClassPathResource("hairstyles/" + version + "/" + filename).getInputStream()) {
            byte[] bytes = input.readNBytes(MAX_ASSET_BYTES + 1);
            if (bytes.length == 0 || bytes.length > MAX_ASSET_BYTES) throw missing();
            return bytes;
        } catch (IOException e) {
            throw missing();
        }
    }

    private static String sha(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void filter(String value, Set<String> allowed) {
        if (value != null && !allowed.contains(value))
            throw new ApiException(400, "VALIDATION_ERROR", "图库筛选或分页参数不正确");
    }

    private static int pageNumber(String value, int fallback, int max) {
        if (value == null) return fallback;
        try {
            if (!value.matches("[1-9][0-9]{0,9}"))
                throw new ApiException(400, "VALIDATION_ERROR", "图库筛选或分页参数不正确");
            int result = Integer.parseInt(value);
            if (result > max) throw new ApiException(400, "VALIDATION_ERROR", "图库筛选或分页参数不正确");
            return result;
        } catch (NumberFormatException e) {
            throw new ApiException(400, "VALIDATION_ERROR", "图库筛选或分页参数不正确");
        }
    }

    private static ApiException missing() {
        return new ApiException(404, "RESOURCE_NOT_FOUND", "发型或参考图片不存在");
    }
}
