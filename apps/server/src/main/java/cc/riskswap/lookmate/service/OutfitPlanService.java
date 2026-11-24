package cc.riskswap.lookmate.service;

import static cc.riskswap.lookmate.common.model.param.OutfitPlanParameters.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.dao.entity.OutfitPlanRow;
import cc.riskswap.lookmate.dao.mapper.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class OutfitPlanService {
    private static final Set<String> CREATE =
            Set.of("clientRequestId", "date", "scene", "note", "outfitId");
    private static final Set<String> PATCH = Set.of("version", "date", "scene", "note", "outfitId");
    private final OutfitPlanMapper mapper;
    private final OutfitMapper outfits;
    private final OutfitService outfitService;
    private final DressMapper dresses;
    private final JsonMapper json;
    private final FileReferenceService references;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageDto<OutfitPlanDto> list(
            Long user, String dateValue, String pageValue, String sizeValue) {
        var day = date(dateValue);
        int page = page(pageValue, 1, Integer.MAX_VALUE), size = page(sizeValue, 20, 100);
        return new PageDto<>(
                dtos(user, mapper.list(user, day, size, ((long) page - 1) * size)),
                page,
                size,
                mapper.count(user, day));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> calendar(Long user, String fromValue, String toValue) {
        var from = date(fromValue);
        var to = date(toValue);
        long span = ChronoUnit.DAYS.between(from, to);
        if (span < 0 || span >= 42) throw invalid();
        return Map.of("days", mapper.calendar(user, from, to));
    }

    @Transactional
    public OutfitPlanDto create(Long user, Map<String, Object> body) {
        fields(body, CREATE);
        var row = new OutfitPlanRow();
        row.setUserId(user);
        row.setClientRequestId(requestId(body.get("clientRequestId")));
        row.setPlanDate(date(body.get("date")));
        row.setScene(text(body.get("scene"), 20, false));
        row.setNote(text(body.get("note"), 80, true));
        row.setSourceOutfitId(body.get("outfitId") == null ? null : id(body.get("outfitId")));
        row.setRequestHash(requestHash(row));
        lock(user);
        var prior = mapper.byRequest(user, row.getClientRequestId());
        if (prior != null) {
            if (!prior.getRequestHash().equals(row.getRequestHash()))
                throw new ApiException(409, "IDEMPOTENCY_CONFLICT", "该请求键已用于其他穿搭安排");
            return dto(user, prior);
        }
        var snapshot = snapshot(user, row.getSourceOutfitId());
        var nextAssets = assets(snapshot);
        references.lockOutfitAssets(user, List.of(), nextAssets);
        row.setSnapshot(snapshot == null ? null : json.writeValueAsString(snapshot));
        mapper.insert(row);
        for (Long asset : nextAssets) mapper.asset(user, row.getId(), asset);
        rememberScene(user, row.getScene());
        return dto(user, require(user, row.getId()));
    }

    @Transactional
    public OutfitPlanDto patch(Long user, String value, Map<String, Object> body) {
        fields(body, PATCH);
        long expected = version(body.get("version"));
        long plan = id(value);
        lock(user);
        var row = require(user, plan);
        checkVersion(row, expected);
        if (body.containsKey("date")) row.setPlanDate(date(body.get("date")));
        if (body.containsKey("scene")) row.setScene(text(body.get("scene"), 20, false));
        if (body.containsKey("note")) row.setNote(text(body.get("note"), 80, true));
        if (body.containsKey("outfitId")) {
            Long source = body.get("outfitId") == null ? null : id(body.get("outfitId"));
            var snapshot = snapshot(user, source);
            var nextAssets = assets(snapshot);
            var oldAssets = mapper.assets(user, plan);
            references.lockOutfitAssets(user, oldAssets, nextAssets);
            row.setSourceOutfitId(source);
            row.setSnapshot(snapshot == null ? null : json.writeValueAsString(snapshot));
            mapper.deleteAssets(user, plan);
            for (Long asset : nextAssets) mapper.asset(user, plan, asset);
            for (Long asset : oldAssets)
                if (!nextAssets.contains(asset)) references.release(user, asset);
        }
        if (mapper.update(row) != 1) throw conflict();
        rememberScene(user, row.getScene());
        return dto(user, require(user, plan));
    }

    @Transactional
    public void delete(Long user, String value, String expectedValue) {
        long expected = version(expectedValue), plan = id(value);
        lock(user);
        var row = require(user, plan);
        checkVersion(row, expected);
        var oldAssets = mapper.assets(user, plan);
        references.lockOutfitAssets(user, oldAssets, Set.of());
        mapper.deleteAssets(user, plan);
        mapper.delete(user, plan);
        for (Long asset : oldAssets) references.release(user, asset);
    }

    private OutfitDto snapshot(Long user, Long source) {
        return source == null ? null : outfitService.detail(user, source.toString());
    }

    private SortedSet<Long> assets(OutfitDto snapshot) {
        var ids = new TreeSet<Long>();
        if (snapshot == null) return ids;
        if (snapshot.getSourceOutputFileId() != null) ids.add(id(snapshot.getSourceOutputFileId()));
        for (var item : snapshot.getItems()) {
            if (item.get("imageFileIds") instanceof List<?> images)
                for (var image : images) ids.add(id(image));
        }
        return ids;
    }

    private void rememberScene(Long user, String scene) {
        if (!OutfitService.PRESET_SCENES.contains(scene)) outfits.rememberScene(user, scene);
    }

    private void lock(Long user) {
        if (dresses.lockUser(user) == null) throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
    }

    private OutfitPlanRow require(Long user, Long plan) {
        var row = mapper.get(user, plan);
        if (row == null) throw new ApiException(404, "OUTFIT_PLAN_NOT_FOUND", "穿搭安排不存在");
        return row;
    }

    private void checkVersion(OutfitPlanRow row, long expected) {
        if (row.getVersion() != expected || expected == Long.MAX_VALUE) throw conflict();
    }

    private OutfitPlanDto dto(Long user, OutfitPlanRow row) {
        return dtos(user, List.of(row)).getFirst();
    }

    private List<OutfitPlanDto> dtos(Long user, List<OutfitPlanRow> rows) {
        var result = new ArrayList<OutfitPlanDto>(rows.size());
        var outfits = new HashSet<Long>();
        var dresses = new HashSet<Long>();
        for (var row : rows) {
            var dto = snapshotDto(row);
            result.add(dto);
            if (row.getSourceOutfitId() != null) outfits.add(row.getSourceOutfitId());
            if (dto.getOutfit() != null)
                for (var item : dto.getOutfit().getItems()) dresses.add(id(item.get("dressId")));
        }
        var foundOutfits =
                outfits.isEmpty() ? Set.<Long>of() : mapper.existingOutfits(user, outfits);
        var foundDresses =
                dresses.isEmpty() ? Set.<Long>of() : mapper.existingDresses(user, dresses);
        for (var dto : result) {
            dto.setSourceMissing(
                    dto.getSourceOutfitId() != null
                            && !foundOutfits.contains(id(dto.getSourceOutfitId())));
            if (dto.getOutfit() != null)
                for (var item : dto.getOutfit().getItems())
                    item.put("missing", !foundDresses.contains(id(item.get("dressId"))));
        }
        return result;
    }

    private OutfitPlanDto snapshotDto(OutfitPlanRow row) {
        var dto = new OutfitPlanDto();
        dto.setId(row.getId().toString());
        dto.setVersion(row.getVersion().toString());
        dto.setDate(row.getPlanDate().toString());
        dto.setScene(row.getScene());
        dto.setNote(row.getNote());
        dto.setSourceOutfitId(
                row.getSourceOutfitId() == null ? null : row.getSourceOutfitId().toString());
        if (row.getSnapshot() != null)
            dto.setOutfit(json.readValue(row.getSnapshot(), OutfitDto.class));
        dto.setCreatedAt(row.getCreatedAt().toInstant(ZoneOffset.UTC).toString());
        dto.setUpdatedAt(row.getUpdatedAt().toInstant(ZoneOffset.UTC).toString());
        return dto;
    }

    private String requestHash(OutfitPlanRow row) {
        var canonical = new LinkedHashMap<String, Object>();
        canonical.put("date", row.getPlanDate().toString());
        canonical.put("scene", row.getScene());
        canonical.put("note", row.getNote());
        canonical.put(
                "outfitId",
                row.getSourceOutfitId() == null ? null : row.getSourceOutfitId().toString());
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(
                                            json.writeValueAsString(canonical)
                                                    .getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
