package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.RecordParameters;
import cc.riskswap.lookmate.dao.entity.CollectionRow;
import cc.riskswap.lookmate.dao.entity.FavoriteRow;
import cc.riskswap.lookmate.dao.entity.TaskQueryRow;
import cc.riskswap.lookmate.dao.mapper.DesignQueryMapper;
import cc.riskswap.lookmate.dao.mapper.RecordsMapper;
import java.text.Normalizer;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RecordsService {
    private static final Set<String> TYPES = Set.of("HAIRSTYLE", "OUTFIT", "OVERALL");
    private static final Set<String> STATES =
            Set.of("QUEUED", "PLANNING", "GENERATING", "SAVING", "SUCCEEDED", "FAILED", "UNKNOWN");
    private final RecordsMapper records;
    private final DesignQueryMapper designs;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<TaskSummaryDto> designs(
            Long userId, String pageValue, String sizeValue, String type, String status) {
        int page = RecordParameters.page(pageValue, 1, Integer.MAX_VALUE);
        int size = RecordParameters.page(sizeValue, 20, 100);
        if (type != null && !TYPES.contains(type) || status != null && !STATES.contains(status))
            throw RecordParameters.invalid();
        var rows = records.designs(userId, type, status, size, offset(page, size));
        return new PageDto<>(
                rows.stream()
                        .map(row -> WorkspaceService.summary(row, new TaskSummaryDto()))
                        .toList(),
                page,
                size,
                records.designCount(userId, type, status));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<FavoriteDto> favorites(
            Long userId, String pageValue, String sizeValue, String collectionValue) {
        int page = RecordParameters.page(pageValue, 1, Integer.MAX_VALUE);
        int size = RecordParameters.page(sizeValue, 20, 100);
        Long collectionId = collectionValue == null ? null : RecordParameters.id(collectionValue);
        if (collectionId != null) requireCollection(userId, collectionId);
        var rows = records.favorites(userId, collectionId, size, offset(page, size));
        long total = records.favoriteCount(userId, collectionId);
        if (rows.isEmpty()) return new PageDto<>(List.of(), page, size, total);
        var tasks =
                records.tasks(userId, rows.stream().map(FavoriteRow::getTaskId).toList()).stream()
                        .collect(
                                Collectors.toMap(
                                        TaskQueryRow::getId,
                                        row ->
                                                WorkspaceService.summary(
                                                        row, new TaskSummaryDto())));
        var memberships =
                records.memberships(userId, rows.stream().map(FavoriteRow::getId).toList()).stream()
                        .collect(
                                Collectors.groupingBy(
                                        cc.riskswap.lookmate.dao.entity.MembershipRow
                                                ::getFavoriteId,
                                        Collectors.mapping(
                                                row -> row.getCollectionId().toString(),
                                                Collectors.toList())));
        return new PageDto<>(
                rows.stream()
                        .map(
                                row ->
                                        new FavoriteDto(
                                                row.getId().toString(),
                                                row.getResultId().toString(),
                                                row.getCreatedAt()
                                                        .toInstant(ZoneOffset.UTC)
                                                        .toString(),
                                                memberships.getOrDefault(row.getId(), List.of()),
                                                tasks.get(row.getTaskId())))
                        .toList(),
                page,
                size,
                total);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<CollectionDto> collections(Long userId, String pageValue, String sizeValue) {
        int page = RecordParameters.page(pageValue, 1, Integer.MAX_VALUE);
        int size = RecordParameters.page(sizeValue, 20, 100);
        return new PageDto<>(
                records.collections(userId, size, offset(page, size)).stream()
                        .map(this::collectionDto)
                        .toList(),
                page,
                size,
                records.collectionCount(userId));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CollectionDto collection(Long userId, String idValue) {
        return collectionDto(requireCollection(userId, RecordParameters.id(idValue)));
    }

    @Transactional
    public FavoriteDto favorite(Long userId, String resultValue) {
        Long resultId = RecordParameters.id(resultValue);
        lockUser(userId);
        var task = requireResult(userId, resultId);
        requireSucceeded(task);
        if (task.getFavoriteId() == null) records.createFavorite(userId, resultId);
        task = requireResult(userId, resultId);
        return favoriteDto(userId, records.favorite(userId, task.getFavoriteId()));
    }

    @Transactional
    public void unfavorite(Long userId, String resultValue) {
        Long resultId = RecordParameters.id(resultValue);
        lockUser(userId);
        var task = requireResult(userId, resultId);
        requireSucceeded(task);
        if (task.getFavoriteId() != null) {
            records.deleteFavoriteItems(userId, task.getFavoriteId());
            records.deleteFavorite(userId, task.getFavoriteId());
        }
    }

    @Transactional
    public CollectionDto createCollection(Long userId, String rawName) {
        String name = normalizeName(rawName);
        lockUser(userId);
        requireUniqueName(userId, name, 0L);
        var row = new CollectionRow();
        row.setName(name);
        records.createCollection(userId, row);
        return collectionDto(requireCollection(userId, row.getId()));
    }

    @Transactional
    public CollectionDto renameCollection(
            Long userId, String idValue, String rawName, String rawVersion) {
        Long id = RecordParameters.id(idValue);
        String name = normalizeName(rawName);
        Long version = version(rawVersion);
        lockUser(userId);
        var row = requireCollection(userId, id);
        if (!version.equals(row.getVersion()) || version == Long.MAX_VALUE) throw versionConflict();
        requireUniqueName(userId, name, id);
        if (records.renameCollection(userId, id, name, version) != 1) throw versionConflict();
        return collectionDto(requireCollection(userId, id));
    }

    @Transactional
    public void deleteCollection(Long userId, String idValue) {
        Long id = RecordParameters.id(idValue);
        lockUser(userId);
        requireCollection(userId, id);
        records.deleteCollectionItems(userId, id);
        records.deleteCollection(userId, id);
    }

    @Transactional
    public void membership(Long userId, String collectionValue, String favoriteValue, boolean add) {
        Long collectionId = RecordParameters.id(collectionValue);
        Long favoriteId = RecordParameters.id(favoriteValue);
        lockUser(userId);
        requireCollection(userId, collectionId);
        var favorite = records.favorite(userId, favoriteId);
        if (favorite == null) throw new ApiException(404, "FAVORITE_NOT_FOUND", "收藏不存在");
        requireSucceeded(requireResult(userId, favorite.getResultId()));
        if (add) {
            if (records.membership(userId, collectionId, favoriteId) == null)
                records.addItem(userId, collectionId, favoriteId);
        } else records.removeItem(userId, collectionId, favoriteId);
    }

    private void lockUser(Long userId) {
        if (records.lockUser(userId) == null)
            throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
    }

    private TaskQueryRow requireResult(Long userId, Long resultId) {
        var task = records.resultTask(userId, resultId);
        if (task == null) throw new ApiException(404, "RESULT_NOT_FOUND", "方案不存在");
        return task;
    }

    private void requireSucceeded(TaskQueryRow task) {
        if (!"SUCCEEDED".equals(task.getStatus()))
            throw new ApiException(409, "DESIGN_NOT_SUCCEEDED", "仅完整成功的方案可执行此操作");
    }

    private CollectionRow requireCollection(Long userId, Long id) {
        var row = records.collection(userId, id);
        if (row == null) throw new ApiException(404, "COLLECTION_NOT_FOUND", "收藏夹不存在");
        return row;
    }

    private void requireUniqueName(Long userId, String name, Long excludedId) {
        if (records.duplicateName(userId, name, excludedId) != null)
            throw new ApiException(409, "COLLECTION_NAME_EXISTS", "已有同名收藏夹");
    }

    private FavoriteDto favoriteDto(Long userId, FavoriteRow row) {
        return new FavoriteDto(
                row.getId().toString(),
                row.getResultId().toString(),
                row.getCreatedAt().toInstant(ZoneOffset.UTC).toString(),
                records.collectionIds(userId, row.getId()),
                WorkspaceService.summary(
                        designs.findTask(userId, row.getTaskId()), new TaskSummaryDto()));
    }

    private CollectionDto collectionDto(CollectionRow row) {
        return new CollectionDto(
                row.getId().toString(),
                row.getName(),
                row.getVersion().toString(),
                row.getCreatedAt().toInstant(ZoneOffset.UTC).toString(),
                row.getUpdatedAt().toInstant(ZoneOffset.UTC).toString());
    }

    static String normalizeName(String raw) {
        if (raw == null) throw validation();
        int start = 0;
        int end = raw.length();
        while (start < end && whitespace(raw.codePointAt(start)))
            start += Character.charCount(raw.codePointAt(start));
        while (end > start && whitespace(raw.codePointBefore(end)))
            end -= Character.charCount(raw.codePointBefore(end));
        String name = Normalizer.normalize(raw.substring(start, end), Normalizer.Form.NFC);
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 64) throw validation();
        return name;
    }

    private static boolean whitespace(int codePoint) {
        return Character.isWhitespace(codePoint)
                || Character.isSpaceChar(codePoint)
                || codePoint == 0x85;
    }

    private static Long version(String raw) {
        if (raw == null || !raw.matches("[0-9]{1,19}")) throw validation();
        try {
            return Long.valueOf(raw);
        } catch (NumberFormatException error) {
            throw validation();
        }
    }

    private static ApiException validation() {
        return new ApiException(400, "VALIDATION_ERROR", "收藏夹名称或版本不合法");
    }

    private static ApiException versionConflict() {
        return new ApiException(409, "VERSION_CONFLICT", "收藏夹已更新，请刷新后重试");
    }

    private static long offset(int page, int size) {
        return ((long) page - 1) * size;
    }
}
