package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.PageDto;
import cc.riskswap.lookmate.dao.entity.HairstyleFavoriteRow;
import cc.riskswap.lookmate.dao.mapper.HairstyleFavoriteMapper;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class HairstyleFavoriteService {
    private final HairstyleCatalogService catalog;
    private final HairstyleFavoriteMapper mapper;
    private final TransactionTemplate write;
    private final TransactionTemplate read;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    public HairstyleFavoriteService(
            HairstyleCatalogService catalog,
            HairstyleFavoriteMapper mapper,
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
            String length,
            String bangs,
            String texture,
            String scope) {
        if (scope != null && !Set.of("all", "favorites").contains(scope)) throw invalid();
        int page = HairstyleCatalogService.pageNumber(pageValue, 1, Integer.MAX_VALUE);
        int size = HairstyleCatalogService.pageNumber(sizeValue, 20, 100);
        var matchingIds = catalog.matchingIds(length, bangs, texture);
        if (!"favorites".equals(scope)) {
            var result = catalog.list(pageValue, sizeValue, length, bangs, texture);
            if (result.getItems().isEmpty()) return result;
            var ids = result.getItems().stream().map(row -> (String) row.get("id")).toList();
            var favorites =
                    mapper.findPage(userId, ids).stream()
                            .collect(
                                    Collectors.toMap(
                                            HairstyleFavoriteRow::getHairstyleId, row -> row));
            return new PageDto<>(
                    result.getItems().stream()
                            .map(row -> decorate(row, favorites.get(row.get("id")), true))
                            .toList(),
                    page,
                    size,
                    result.getTotal());
        }
        var activeIds = catalog.matchingIds(null, null, null);
        // Count and page share a database snapshot; image loading stays outside the transaction.
        var rows =
                read.execute(
                        status ->
                                new FavoritePage(
                                        mapper.page(
                                                userId,
                                                activeIds,
                                                matchingIds,
                                                length,
                                                bangs,
                                                texture,
                                                size,
                                                (long) (page - 1) * size),
                                        mapper.count(
                                                userId,
                                                activeIds,
                                                matchingIds,
                                                length,
                                                bangs,
                                                texture)));
        return new PageDto<>(
                rows.items().stream().map(this::display).toList(), page, size, rows.total());
    }

    public Map<String, Object> detail(Long userId, String id) {
        validateId(id);
        var current = catalog.currentAvailable(id);
        var favorite = mapper.find(userId, id);
        if (current != null) return decorate(current, favorite, true);
        if (favorite == null) throw new ApiException(404, "RESOURCE_NOT_FOUND", "发型不存在");
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
                                    "hairstyleId",
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
    private Map<String, Object> display(HairstyleFavoriteRow favorite) {
        var current = catalog.currentAvailable(favorite.getHairstyleId());
        if (current != null) return decorate(current, favorite, true);
        Map<String, Object> snapshot = JSON.readValue(favorite.getDisplaySnapshot(), Map.class);
        snapshot.put("id", favorite.getHairstyleId());
        var images = new ArrayList<Map<String, Object>>();
        for (var image : GenerationService.list(snapshot.get("images"))) {
            try {
                String prefix = "/api/hairstyles/assets/" + snapshot.get("version") + "/";
                String url = String.valueOf(image.get("url"));
                if (url.startsWith(prefix)) {
                    if (catalog.hasAsset(
                            String.valueOf(snapshot.get("version")),
                            url.substring(prefix.length()))) images.add(image);
                }
            } catch (ApiException e) {
                if (e.getStatus() != 404) throw e;
                // Historical artwork may be missing; retain the saved name and unavailable state.
            }
        }
        snapshot.put("images", images);
        return decorate(snapshot, favorite, false);
    }

    private Map<String, Object> decorate(
            Map<String, Object> source, HairstyleFavoriteRow favorite, boolean available) {
        var result = new LinkedHashMap<>(source);
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

    private record FavoritePage(List<HairstyleFavoriteRow> items, long total) {}
}
