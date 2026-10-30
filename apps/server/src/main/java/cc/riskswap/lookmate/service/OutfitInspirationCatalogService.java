package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.integration.ai.GenerationGateway;
import java.io.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Immutable platform artwork is independent of user files and retained by version. */
@Service
public class OutfitInspirationCatalogService {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String PREFIX = "/api/outfit-inspirations/assets/";
    private static final Set<String> OCCASIONS =
            Set.of("DAILY", "COMMUTE", "DATE", "PARTY", "TRAVEL");
    private static final Set<String> STYLES =
            Set.of("MINIMAL", "CASUAL", "COMMUTE", "RETRO", "SPORT_CASUAL", "SOFT");
    private final String currentVersion;
    private final int maxAssetBytes;
    private final int maxEntries;
    private final Map<String, List<Map<String, Object>>> catalogs = new ConcurrentHashMap<>();
    private volatile ApiException currentFailure;

    public OutfitInspirationCatalogService() {
        this("v1", 5 * 1024 * 1024, 100);
    }

    public OutfitInspirationCatalogService(String version) {
        this(version, 5 * 1024 * 1024, 100);
    }

    @Autowired
    public OutfitInspirationCatalogService(
            @Value("${lookmate.outfit-inspirations.current-version:v1}") String version,
            @Value("${lookmate.outfit-inspirations.max-asset-bytes:5242880}") int maxAssetBytes,
            @Value("${lookmate.outfit-inspirations.max-entries:100}") int maxEntries) {
        this.currentVersion = version;
        this.maxAssetBytes = maxAssetBytes;
        this.maxEntries = maxEntries;
    }

    @jakarta.annotation.PostConstruct
    public void validateCurrentCatalog() {
        try {
            currentCatalog();
        } catch (ApiException e) {
            currentFailure = unavailable();
        }
        // Prevalidate retained immutable versions before any account transaction can reference
        // them.
        try {
            var resolver =
                    new org.springframework.core.io.support.PathMatchingResourcePatternResolver();
            for (var resource :
                    resolver.getResources("classpath*:outfit-inspirations/*/catalog.json")) {
                String path = resource.getURL().toString();
                var matcher =
                        java.util.regex.Pattern.compile(
                                        "/outfit-inspirations/(v[1-9][0-9]{0,8})/catalog\\.json$")
                                .matcher(path);
                if (matcher.find()) {
                    try {
                        catalog(matcher.group(1));
                    } catch (ApiException e) {
                        /* An unusable old version must not disable current browsing or cancellation. */
                    }
                }
            }
        } catch (IOException e) {
            /* Current validation above remains authoritative. */
        }
    }

    private List<Map<String, Object>> currentCatalog() {
        if (currentFailure != null) throw currentFailure;
        try {
            return catalog(currentVersion);
        } catch (RuntimeException e) {
            throw unavailable();
        }
    }

    public PageDto<Map<String, Object>> list(
            String page, String size, String occasion, String style) {
        int p = pageNumber(page, 1, Integer.MAX_VALUE), s = pageNumber(size, 20, 100);
        var ids = matchingIds(occasion, style);
        var rows = currentCatalog().stream().filter(r -> ids.contains(r.get("id"))).toList();
        return new PageDto<>(
                rows.stream()
                        .skip((long) (p - 1) * s)
                        .limit(s)
                        .map(OutfitInspirationCatalogService::describe)
                        .toList(),
                p,
                s,
                (long) rows.size());
    }

    public List<String> matchingIds(String occasion, String style) {
        if (occasion != null && !OCCASIONS.contains(occasion)
                || style != null && !STYLES.contains(style))
            throw new ApiException(400, "VALIDATION_ERROR", "灵感筛选参数不正确");
        return currentCatalog().stream()
                .filter(r -> Boolean.TRUE.equals(r.get("active")))
                .filter(r -> occasion == null || ((List<?>) r.get("occasions")).contains(occasion))
                .filter(r -> style == null || ((List<?>) r.get("styles")).contains(style))
                .map(r -> (String) r.get("id"))
                .toList();
    }

    public Map<String, Object> currentAvailable(String id) {
        return currentCatalog().stream()
                .filter(
                        r ->
                                Boolean.TRUE.equals(r.get("active"))
                                        && Objects.equals(id, r.get("id")))
                .findFirst()
                .map(OutfitInspirationCatalogService::describe)
                .orElse(null);
    }

    public Map<String, Object> requireAvailable(String id) {
        var value = currentAvailable(id);
        if (value == null)
            throw new ApiException(409, "OUTFIT_INSPIRATION_UNAVAILABLE", "穿搭灵感已下架，请重新选择");
        return value;
    }

    public Map<String, Object> select(String id, String version) {
        var value = requireAvailable(id);
        if (!Objects.equals(version, value.get("version")))
            throw new ApiException(409, "OUTFIT_INSPIRATION_CHANGED", "穿搭灵感已更新，请重新查看");
        return value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> describe(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        for (String key :
                List.of(
                        "id",
                        "version",
                        "name",
                        "primaryOccasion",
                        "occasions",
                        "styles",
                        "image",
                        "styling")) result.put(key, row.get(key));
        return JSON.convertValue(result, Map.class);
    }

    public static Map<String, Object> safeReference(Map<String, Object> reference) {
        if (reference == null || reference.isEmpty()) return null;
        var result = describe(reference);
        var image = GenerationService.map(result.get("image"));
        if (!image.isEmpty()) {
            var safe = new LinkedHashMap<String, Object>();
            for (String key : List.of("id", "url", "width", "height"))
                safe.put(key, image.get(key));
            result.put("image", safe);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> catalog(String version) {
        if (version == null || !version.matches("v[1-9][0-9]{0,8}")) throw missing();
        return catalogs.computeIfAbsent(
                version,
                v -> {
                    try (var input =
                            new ClassPathResource("outfit-inspirations/" + v + "/catalog.json")
                                    .getInputStream()) {
                        List<Map<String, Object>> rows = JSON.readValue(input, List.class);
                        if (rows.isEmpty() || rows.size() > maxEntries)
                            throw new IllegalArgumentException();
                        var ids = new HashSet<Object>();
                        for (var row : rows) {
                            if (!(row.get("id") instanceof String id)
                                    || !id.matches("[a-z0-9][a-z0-9-]{0,63}")
                                    || !ids.add(id)
                                    || !v.equals(row.get("version"))
                                    || !(row.get("active") instanceof Boolean)
                                    || !(row.get("sortOrder") instanceof Integer))
                                throw new IllegalArgumentException();
                            text(row.get("name"), 20);
                            tags(row.get("occasions"), OCCASIONS);
                            tags(row.get("styles"), STYLES);
                            if (!((List<?>) row.get("occasions"))
                                    .contains(row.get("primaryOccasion")))
                                throw new IllegalArgumentException();
                            var styling = GenerationService.map(row.get("styling"));
                            if (!styling.keySet()
                                    .equals(Set.of("palette", "silhouette", "wearing")))
                                throw new IllegalArgumentException();
                            styling.values().forEach(value -> text(value, 500));
                            var image = GenerationService.map(row.get("image"));
                            if (!(image.get("id") instanceof String imageId)
                                    || !imageId.matches("[a-z0-9][a-z0-9-]{0,99}"))
                                throw new IllegalArgumentException();
                            String file = (String) image.get("file");
                            byte[] bytes = readAsset(v, file);
                            String mime =
                                    file.endsWith(".png")
                                            ? "image/png"
                                            : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
                            if (!mime.equals(image.get("mime"))
                                    || !(image.get("sizeBytes") instanceof Number size)
                                    || size.longValue() != bytes.length
                                    || !sha(bytes).equals(image.get("sha256")))
                                throw new IllegalArgumentException();
                            try (var stream =
                                    ImageIO.createImageInputStream(
                                            new ByteArrayInputStream(bytes))) {
                                var readers = ImageIO.getImageReaders(stream);
                                if (!readers.hasNext()) throw new IllegalArgumentException();
                                var reader = readers.next();
                                try {
                                    String actual = reader.getFormatName().toLowerCase(Locale.ROOT);
                                    if (!(mime.equals("image/png") && actual.equals("png")
                                            || mime.equals("image/jpeg")
                                                    && Set.of("jpg", "jpeg").contains(actual)
                                            || mime.equals("image/webp") && actual.equals("webp")))
                                        throw new IllegalArgumentException();
                                } finally {
                                    reader.dispose();
                                }
                            }
                            var decoded = ImageIO.read(new ByteArrayInputStream(bytes));
                            if (decoded == null
                                    || !(image.get("width") instanceof Number width)
                                    || !(image.get("height") instanceof Number height)
                                    || decoded.getWidth() != width.intValue()
                                    || decoded.getHeight() != height.intValue())
                                throw new IllegalArgumentException();
                            image.put("url", PREFIX + v + "/" + file);
                            row.put("image", image);
                        }
                        return rows.stream()
                                .sorted(
                                        Comparator.<Map<String, Object>>comparingInt(
                                                        r ->
                                                                ((Number) r.get("sortOrder"))
                                                                        .intValue())
                                                .thenComparing(r -> (String) r.get("id")))
                                .toList();
                    } catch (IOException | RuntimeException e) {
                        throw unavailable();
                    }
                });
    }

    private static void text(Object value, int max) {
        if (!(value instanceof String s) || s.isBlank() || s.codePointCount(0, s.length()) > max)
            throw new IllegalArgumentException();
    }

    private static void tags(Object value, Set<String> allowed) {
        if (!(value instanceof List<?> list)
                || list.isEmpty()
                || new HashSet<>(list).size() != list.size()
                || !allowed.containsAll(list)) throw new IllegalArgumentException();
    }

    public boolean hasAsset(String version, String filename) {
        try {
            asset(version, filename);
            return true;
        } catch (ApiException e) {
            return false;
        }
    }

    public byte[] asset(String version, String filename) {
        var image =
                catalog(version).stream()
                        .map(r -> GenerationService.map(r.get("image")))
                        .filter(i -> Objects.equals(filename, i.get("file")))
                        .findFirst()
                        .orElseThrow(OutfitInspirationCatalogService::missing);
        byte[] bytes = readAsset(version, filename);
        if (!sha(bytes).equals(image.get("sha256"))) throw invalidAsset();
        return bytes;
    }

    public List<GenerationGateway.Image> references(Map<String, Object> snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return List.of();
        try {
            var image = GenerationService.map(snapshot.get("image"));
            var bytes = asset(String.valueOf(snapshot.get("version")), (String) image.get("file"));
            if (!sha(bytes).equals(image.get("sha256"))
                    || bytes.length != ((Number) image.get("sizeBytes")).longValue())
                throw invalidAsset();
            return List.of(
                    new GenerationGateway.Image(
                            "inspiration:"
                                    + snapshot.get("id")
                                    + ":"
                                    + snapshot.get("version")
                                    + ":"
                                    + image.get("id"),
                            bytes));
        } catch (RuntimeException e) {
            throw invalidAsset();
        }
    }

    public long referenceBytes(Map<String, Object> snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return 0;
        // Only inspect startup-verified metadata under the caller's short account transaction.
        var rows = catalogs.get(String.valueOf(snapshot.get("version")));
        if (rows == null) throw invalidAsset();
        var original =
                rows.stream()
                        .filter(row -> Objects.equals(row.get("id"), snapshot.get("id")))
                        .findFirst()
                        .orElseThrow(OutfitInspirationCatalogService::invalidAsset);
        if (!Objects.equals(original.get("image"), snapshot.get("image"))) throw invalidAsset();
        return ((Number) GenerationService.map(original.get("image")).get("sizeBytes")).longValue();
    }

    private byte[] readAsset(String version, String filename) {
        if (filename == null
                || !filename.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\\.(png|jpg|jpeg|webp)"))
            throw missing();
        try (var input =
                new ClassPathResource("outfit-inspirations/" + version + "/" + filename)
                        .getInputStream()) {
            byte[] bytes = input.readNBytes(maxAssetBytes + 1);
            if (bytes.length == 0 || bytes.length > maxAssetBytes) throw invalidAsset();
            return bytes;
        } catch (IOException e) {
            throw invalidAsset();
        }
    }

    private static String sha(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static int pageNumber(String value, int fallback, int max) {
        return HairstyleCatalogService.pageNumber(value, fallback, max);
    }

    private static ApiException missing() {
        return new ApiException(404, "RESOURCE_NOT_FOUND", "穿搭灵感或图片不存在");
    }

    private static ApiException unavailable() {
        return new ApiException(503, "OUTFIT_INSPIRATION_CATALOG_UNAVAILABLE", "穿搭灵感库暂不可用");
    }

    private static ApiException invalidAsset() {
        return new ApiException(409, "OUTFIT_INSPIRATION_ASSET_INVALID", "原穿搭灵感图片不可用");
    }
}
