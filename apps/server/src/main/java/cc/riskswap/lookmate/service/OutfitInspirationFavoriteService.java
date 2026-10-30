package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.dao.entity.OutfitInspirationFavoriteRow;
import cc.riskswap.lookmate.dao.mapper.OutfitInspirationFavoriteMapper;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class OutfitInspirationFavoriteService {
    private final OutfitInspirationCatalogService catalog;
    private final OutfitInspirationFavoriteMapper mapper;
    private final TransactionTemplate write;
    private final TransactionTemplate read;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    public OutfitInspirationFavoriteService(
            OutfitInspirationCatalogService catalog,
            OutfitInspirationFavoriteMapper mapper,
            PlatformTransactionManager manager) {
        this.catalog = catalog;
        this.mapper = mapper;
        write = new TransactionTemplate(manager);
        write.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        read = new TransactionTemplate(manager);
        read.setReadOnly(true);
        read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    }

    public PageDto<Map<String, Object>> list(
            Long userId,
            String pageValue,
            String sizeValue,
            String occasion,
            String style,
            String scope) {
        if (scope != null && !Set.of("all", "favorites").contains(scope)) throw invalid();
        int page = OutfitInspirationCatalogService.pageNumber(pageValue, 1, Integer.MAX_VALUE);
        int size = OutfitInspirationCatalogService.pageNumber(sizeValue, 20, 100);
        var matchingIds = catalog.matchingIds(occasion, style);
        if (!"favorites".equals(scope)) {
            var result = catalog.list(pageValue, sizeValue, occasion, style);
            if (result.getItems().isEmpty()) return result;
            var ids = result.getItems().stream().map(row -> (String) row.get("id")).toList();
            var favorites =
                    mapper.findPage(userId, ids).stream()
                            .collect(
                                    Collectors.toMap(
                                            OutfitInspirationFavoriteRow::getInspirationId,
                                            row -> row));
            return new PageDto<>(
                    result.getItems().stream()
                            .map(row -> decorate(row, favorites.get(row.get("id")), true))
                            .toList(),
                    page,
                    size,
                    result.getTotal());
        }
        var activeIds = catalog.matchingIds(null, null);
        // Count and page share a database snapshot; image loading stays outside the transaction.
        var rows =
                read.execute(
                        status ->
                                new FavoritePage(
                                        mapper.page(
                                                userId,
                                                activeIds,
                                                matchingIds,
                                                occasion,
                                                style,
                                                size,
                                                (long) (page - 1) * size),
                                        mapper.count(
                                                userId, activeIds, matchingIds, occasion, style)));
        return new PageDto<>(
                rows.items().stream().map(this::display).toList(), page, size, rows.total());
    }

    public Map<String, Object> detail(Long userId, String id) {
        validateId(id);
        var current = catalog.currentAvailable(id);
        var favorite = mapper.find(userId, id);
        if (current != null) return decorate(current, favorite, true);
        if (favorite == null) throw new ApiException(404, "RESOURCE_NOT_FOUND", "穿搭灵感不存在");
        return display(favorite);
    }

    public FavoriteChange favorite(Long userId, String id) {
        validateId(id);
        // Prepared before taking the user lock: resource reads and hashes must not extend the lock.
        var snapshot = JSON.writeValueAsString(catalog.requireAvailable(id));
        return write.execute(
                status -> {
                    lockUser(userId);
                    var existing = mapper.find(userId, id);
                    boolean created = existing == null;
                    if (created) {
                        mapper.insert(userId, id, snapshot);
                        existing = mapper.find(userId, id);
                    }
                    return new FavoriteChange(
                            created,
                            Map.of(
                                    "inspirationId",
                                    id,
                                    "favorited",
                                    true,
                                    "favoritedAt",
                                    existing.getCreatedAt().toInstant(ZoneOffset.UTC).toString()));
                });
    }

    public void unfavorite(Long userId, String id) {
        validateId(id);
        write.executeWithoutResult(
                status -> {
                    lockUser(userId);
                    mapper.delete(userId, id);
                });
    }

    private void lockUser(Long userId) {
        if (mapper.lockUser(userId) == null)
            throw new ApiException(401, "UNAUTHENTICATED", "请重新登录");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> display(OutfitInspirationFavoriteRow favorite) {
        var current = catalog.currentAvailable(favorite.getInspirationId());
        if (current != null) return decorate(current, favorite, true);
        Map<String, Object> snapshot = JSON.readValue(favorite.getDisplaySnapshot(), Map.class);
        snapshot.put("id", favorite.getInspirationId());
        var image = GenerationService.map(snapshot.get("image"));
        try {
            if (!catalog.hasAsset(
                    String.valueOf(snapshot.get("version")), String.valueOf(image.get("file"))))
                snapshot.put("image", null);
        } catch (ApiException e) {
            snapshot.put("image", null);
        }
        return decorate(snapshot, favorite, false);
    }

    private Map<String, Object> decorate(
            Map<String, Object> source, OutfitInspirationFavoriteRow favorite, boolean available) {
        var result = new LinkedHashMap<>(catalog.safeReference(source));
        result.put("availability", available ? "AVAILABLE" : "UNAVAILABLE");
        result.put("favorited", favorite != null);
        result.put(
                "favoritedAt",
                favorite == null
                        ? null
                        : favorite.getCreatedAt().toInstant(ZoneOffset.UTC).toString());
        return result;
    }

    private static void validateId(String id) {
        if (id == null || !id.matches("[a-z0-9][a-z0-9-]{0,63}")) throw invalid();
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_ERROR", "图库参数不正确");
    }

    public record FavoriteChange(boolean created, Map<String, Object> data) {}

    private record FavoritePage(List<OutfitInspirationFavoriteRow> items, long total) {}
}
