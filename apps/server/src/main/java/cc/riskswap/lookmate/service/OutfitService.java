package cc.riskswap.lookmate.service;

import static cc.riskswap.lookmate.common.model.param.OutfitParameters.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class OutfitService {
    private static final Set<String> CREATE =
            Set.of("name", "note", "dressIds", "groupIds", "pinned");
    private static final Set<String> PATCH =
            Set.of("version", "name", "note", "dressIds", "groupIds", "pinned");
    private final OutfitMapper mapper;
    private final DressMapper dresses;
    private final WardrobeService wardrobe;
    private final JsonMapper json;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<OutfitDto> list(
            Long user, String pageValue, String sizeValue, String groupValue) {
        int page = page(pageValue, 1, Integer.MAX_VALUE), size = page(sizeValue, 20, 100);
        Long group = groupValue == null ? null : id(groupValue);
        if (group != null) requireGroup(user, group);
        return new PageDto<>(
                mapper.list(user, group, size, ((long) page - 1) * size).stream()
                        .map(r -> dto(user, r))
                        .toList(),
                page,
                size,
                mapper.count(user, group));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OutfitDto detail(Long user, String value) {
        return dto(user, require(user, id(value)));
    }

    public Map<String, Object> snapshotForGeneration(Long user, String value, String revision) {
        var row = require(user, id(value));
        if (row.getRevision() != version(revision))
            throw new ApiException(409, "OUTFIT_CHANGED", "搭配已修改，请刷新后重试");
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.getId().toString());
        result.put("name", row.getName());
        result.put("note", row.getNote());
        result.put("revision", row.getRevision().toString());
        result.put("items", items(user, row.getId()));
        return result;
    }

    @Transactional
    public OutfitDto create(Long user, Map<String, Object> body) {
        fields(body, CREATE);
        String name = text(body.get("name"), 100, false);
        var selected = ids(body.get("dressIds"), 1, 32);
        lock(user);
        var row = new OutfitRow();
        row.setUserId(user);
        row.setName(name);
        row.setNote(text(body.get("note"), 2000, true));
        row.setPinned(body.containsKey("pinned") && flag(body.get("pinned")));
        var groups = groupIds(user, body);
        var snapshots = select(user, selected, List.of());
        mapper.insert(row);
        saveItems(user, row.getId(), snapshots);
        saveGroups(user, row.getId(), groups);
        return dto(user, require(user, row.getId()));
    }

    @Transactional
    public OutfitDto patch(Long user, String value, Map<String, Object> body) {
        fields(body, PATCH);
        long version = version(body.get("version"));
        lock(user);
        var row = require(user, id(value));
        checkVersion(row.getVersion(), version);
        var old = items(user, row.getId());
        var next = old;
        if (body.containsKey("dressIds"))
            next = select(user, ids(body.get("dressIds"), 1, 32), old);
        String note = body.containsKey("note") ? text(body.get("note"), 2000, true) : row.getNote();
        boolean changed =
                !Objects.equals(note, row.getNote())
                        || !old.stream()
                                .map(i -> i.get("dressId"))
                                .toList()
                                .equals(next.stream().map(i -> i.get("dressId")).toList());
        if (changed) {
            if (row.getRevision() == Long.MAX_VALUE) throw conflict();
            row.setRevision(row.getRevision() + 1);
        }
        row.setNote(note);
        if (body.containsKey("name")) row.setName(text(body.get("name"), 100, false));
        if (body.containsKey("pinned")) row.setPinned(flag(body.get("pinned")));
        if (body.containsKey("groupIds")) saveGroups(user, row.getId(), groupIds(user, body));
        if (body.containsKey("dressIds")) saveItems(user, row.getId(), next);
        if (mapper.update(row) != 1) throw conflict();
        return dto(user, require(user, row.getId()));
    }

    @Transactional
    public void delete(Long user, String value, String expected) {
        long v = version(expected);
        lock(user);
        var row = require(user, id(value));
        checkVersion(row.getVersion(), v);
        var assets = new java.util.TreeSet<>(mapper.assets(user, row.getId()));
        if (row.getSourceOutputFileId() != null) assets.add(row.getSourceOutputFileId());
        mapper.deleteMembers(user, row.getId());
        mapper.deleteItems(user, row.getId());
        mapper.deleteAssets(user, row.getId());
        mapper.delete(user, row.getId());
        for (Long asset : assets) {
            dresses.file(user, asset);
            dresses.scheduleCleanup(user, asset);
        }
    }

    @Transactional
    public OutfitDto fromDesign(Long user, String taskValue, Map<String, Object> body) {
        fields(body, Set.of("name", "groupIds", "pinned"));
        lock(user);
        long task = id(taskValue);
        var source = mapper.source(user, task);
        if (source == null) throw new ApiException(404, "DESIGN_NOT_FOUND", "完整穿搭方案不存在");
        Map<String, Object> input = read((String) source.get("inputSnapshot"));
        var candidates = maps(input.get("candidateItems"));
        var selected = mapper.sourceItems(user, task);
        if (selected.isEmpty() || selected.size() > 32)
            throw new ApiException(409, "DESIGN_NOT_USABLE", "方案没有可保存的单品");
        var snapshots = new ArrayList<Map<String, Object>>();
        for (Long dress : selected) {
            var c =
                    candidates.stream()
                            .filter(i -> dress.toString().equals(i.get("dressId")))
                            .findFirst()
                            .orElseThrow(
                                    () -> new ApiException(409, "DESIGN_NOT_USABLE", "方案缺少单品快照"));
            var item = new LinkedHashMap<String, Object>();
            item.put("dressId", dress.toString());
            item.put("dressName", c.get("name"));
            item.put("categoryCode", c.get("categoryCode"));
            item.put("categoryName", c.get("categoryName"));
            var category =
                    dresses.categories().stream()
                            .filter(x -> Objects.equals(x.getCode(), c.get("categoryCode")))
                            .findFirst()
                            .orElseThrow(
                                    () -> new ApiException(409, "DESIGN_NOT_USABLE", "方案分类不可用"));
            item.put("categoryId", category.getId());
            item.put("color", c.get("color"));
            var images = maps(c.get("images"));
            item.put("imageFileIds", images.stream().map(i -> i.get("fileId").toString()).toList());
            item.put("features", images.stream().map(i -> i.get("features")).toList());
            snapshots.add(item);
        }
        var row = new OutfitRow();
        row.setUserId(user);
        // Source copy defaults fit the editable fields; explicitly supplied names remain strict.
        row.setName(
                body.containsKey("name")
                        ? text(body.get("name"), 100, false)
                        : copyText(source.get("title"), 100));
        row.setNote(copyText(source.get("wearingAdvice"), 2000));
        row.setSourceDesignId(task);
        row.setSourceOutputFileId(mapper.sourceOutput(user, task));
        row.setPinned(body.containsKey("pinned") && flag(body.get("pinned")));
        var groups = groupIds(user, body);
        mapper.insert(row);
        saveItems(user, row.getId(), snapshots);
        saveGroups(user, row.getId(), groups);
        return dto(user, require(user, row.getId()));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<OutfitGroupDto> groups(Long user, String pageValue, String sizeValue) {
        int page = page(pageValue, 1, Integer.MAX_VALUE), size = page(sizeValue, 20, 100);
        return new PageDto<>(
                mapper.groups(user, size, ((long) page - 1) * size).stream()
                        .map(this::groupDto)
                        .toList(),
                page,
                size,
                mapper.groupCount(user));
    }

    @Transactional
    public OutfitGroupDto createGroup(Long user, Map<String, Object> body) {
        fields(body, Set.of("name"));
        String name = text(body.get("name"), 50, false);
        lock(user);
        var row = new OutfitGroupRow();
        row.setUserId(user);
        row.setName(name);
        try {
            mapper.insertGroup(row);
        } catch (DuplicateKeyException e) {
            throw groupExists();
        }
        return groupDto(requireGroup(user, row.getId()));
    }

    @Transactional
    public OutfitGroupDto patchGroup(Long user, String value, Map<String, Object> body) {
        fields(body, Set.of("name", "version"));
        String name = text(body.get("name"), 50, false);
        long v = version(body.get("version"));
        lock(user);
        var row = requireGroup(user, id(value));
        checkVersion(row.getVersion(), v);
        row.setName(name);
        try {
            if (mapper.updateGroup(row) != 1) throw conflict();
        } catch (DuplicateKeyException e) {
            throw groupExists();
        }
        return groupDto(requireGroup(user, row.getId()));
    }

    @Transactional
    public void deleteGroup(Long user, String value, String expected) {
        long v = version(expected);
        lock(user);
        var row = requireGroup(user, id(value));
        checkVersion(row.getVersion(), v);
        for (var outfit : mapper.groupOutfits(user, row.getId())) {
            checkVersion(outfit.getVersion(), outfit.getVersion());
            if (mapper.update(outfit) != 1) throw conflict();
        }
        mapper.unlinkGroup(user, row.getId());
        mapper.deleteGroup(user, row.getId());
    }

    private List<Map<String, Object>> select(
            Long user, List<Long> selected, List<Map<String, Object>> old) {
        var prior =
                old.stream().collect(Collectors.toMap(i -> i.get("dressId").toString(), i -> i));
        var result = new ArrayList<Map<String, Object>>();
        var categories =
                dresses.categories().stream()
                        .collect(Collectors.toMap(DressCategoryDto::getId, c -> c));
        for (Long dress : selected) {
            if (prior.containsKey(dress.toString())) {
                result.add(prior.get(dress.toString()));
                continue;
            }
            if (dresses.dress(user, dress) == null)
                throw new ApiException(409, "DRESS_NOT_USABLE", "所选衣物不可用");
            var d = wardrobe.detail(user, dress.toString());
            var c = categories.get(d.getCategoryId());
            if (c == null || d.getImages().isEmpty())
                throw new ApiException(409, "DRESS_NOT_USABLE", "所选衣物不可用");
            var item = new LinkedHashMap<String, Object>();
            item.put("dressId", d.getId());
            item.put("dressName", d.getName());
            item.put("categoryId", d.getCategoryId());
            item.put("categoryCode", c.getCode());
            item.put("categoryName", c.getName());
            item.put("color", d.getColor());
            item.put("imageFileIds", d.getImages().stream().map(DressImageDto::getFileId).toList());
            item.put(
                    "features",
                    d.getImages().stream().map(DressImageDto::getEffectiveFeatures).toList());
            result.add(item);
        }
        return result;
    }

    private void saveItems(Long user, Long outfit, List<Map<String, Object>> next) {
        var oldAssets = mapper.assets(user, outfit);
        var nextAssets = new TreeSet<Long>();
        var current = mapper.get(user, outfit);
        if (current.getSourceOutputFileId() != null)
            nextAssets.add(current.getSourceOutputFileId());
        for (var item : next)
            for (Object file : (List<?>) item.get("imageFileIds")) nextAssets.add(id(file));
        var all = new TreeSet<>(oldAssets);
        all.addAll(nextAssets);
        for (Long asset : all) {
            var f = dresses.file(user, asset);
            if (nextAssets.contains(asset)) {
                if (f == null
                        || !Set.of("TEMP", "READY").contains(f.getStatus())
                        || f.isExpired()
                        || ("TEMP".equals(f.getStatus()) && f.getExpiresAt() == null)
                        || f.getSizeBytes() == null
                        || f.getSizeBytes() < 1
                        || f.getSizeBytes() > 20L * 1024 * 1024
                        || f.getMimeType() == null
                        || !Set.of("image/jpeg", "image/png", "image/webp")
                                .contains(f.getMimeType()))
                    throw new ApiException(409, "FILE_NOT_USABLE", "搭配图片尚未就绪或已失效");
                dresses.bindFile(user, asset);
            }
        }
        mapper.deleteItems(user, outfit);
        mapper.deleteAssets(user, outfit);
        for (int position = 0; position < next.size(); position++) {
            var snapshot = new LinkedHashMap<>(next.get(position));
            snapshot.remove("missing");
            var item = new OutfitItemRow();
            item.setUserId(user);
            item.setOutfitId(outfit);
            item.setDressId(id(snapshot.get("dressId")));
            item.setPosition(position);
            item.setSnapshot(json.writeValueAsString(snapshot));
            mapper.insertItem(item);
        }
        for (Long asset : nextAssets) mapper.asset(user, outfit, asset);
        for (Long asset : oldAssets)
            if (!nextAssets.contains(asset)) dresses.scheduleCleanup(user, asset);
    }

    private List<Long> groupIds(Long user, Map<String, Object> body) {
        var groups =
                body.containsKey("groupIds") ? ids(body.get("groupIds"), 0, 20) : List.<Long>of();
        for (Long group : groups) requireGroup(user, group);
        return groups;
    }

    private void saveGroups(Long user, Long outfit, List<Long> groups) {
        mapper.deleteMembers(user, outfit);
        for (Long group : groups) mapper.member(user, outfit, group);
    }

    private List<Map<String, Object>> items(Long user, Long outfit) {
        return mapper.items(user, outfit).stream()
                .map(
                        r -> {
                            var value = read(r.getSnapshot());
                            value.put("missing", r.isMissing());
                            return value;
                        })
                .toList();
    }

    private OutfitDto dto(Long user, OutfitRow row) {
        var d = new OutfitDto();
        d.setId(row.getId().toString());
        d.setName(row.getName());
        d.setNote(row.getNote());
        d.setPinned(row.isPinned());
        d.setVersion(row.getVersion().toString());
        d.setRevision(row.getRevision().toString());
        d.setSourceDesignId(
                row.getSourceDesignId() == null ? null : row.getSourceDesignId().toString());
        d.setSourceOutputFileId(
                row.getSourceOutputFileId() == null
                        ? null
                        : row.getSourceOutputFileId().toString());
        d.setCreatedAt(utc(row.getCreatedAt()));
        d.setUpdatedAt(utc(row.getUpdatedAt()));
        d.setItems(items(user, row.getId()));
        d.setGroups(mapper.memberships(user, row.getId()).stream().map(this::groupDto).toList());
        return d;
    }

    private OutfitGroupDto groupDto(OutfitGroupRow row) {
        var d = new OutfitGroupDto();
        d.setId(row.getId().toString());
        d.setName(row.getName());
        d.setVersion(row.getVersion().toString());
        d.setCreatedAt(utc(row.getCreatedAt()));
        d.setUpdatedAt(utc(row.getUpdatedAt()));
        return d;
    }

    private OutfitRow require(Long user, Long id) {
        var row = mapper.get(user, id);
        if (row == null) throw new ApiException(404, "OUTFIT_NOT_FOUND", "搭配不存在");
        return row;
    }

    private OutfitGroupRow requireGroup(Long user, Long id) {
        var row = mapper.group(user, id);
        if (row == null) throw new ApiException(404, "OUTFIT_GROUP_NOT_FOUND", "分组不存在");
        return row;
    }

    private void lock(Long user) {
        if (dresses.lockUser(user) == null) throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
    }

    private static void checkVersion(long actual, long expected) {
        if (actual != expected || actual == Long.MAX_VALUE) throw conflict();
    }

    private static ApiException conflict() {
        return new ApiException(409, "VERSION_CONFLICT", "内容已更新，请刷新后重试");
    }

    private static ApiException groupExists() {
        return new ApiException(409, "OUTFIT_GROUP_NAME_EXISTS", "分组名称已存在");
    }

    private static String copyText(Object raw, int maximum) {
        if (raw == null) return null;
        String value = raw.toString();
        return value.codePointCount(0, value.length()) <= maximum
                ? value
                : value.substring(0, value.offsetByCodePoints(0, maximum));
    }

    private static String utc(LocalDateTime time) {
        return time.toInstant(ZoneOffset.UTC).toString();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> read(String raw) {
        return new LinkedHashMap<>(json.readValue(raw, Map.class));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object raw) {
        return raw instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }
}
