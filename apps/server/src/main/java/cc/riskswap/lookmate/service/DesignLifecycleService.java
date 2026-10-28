package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.dao.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@lombok.extern.slf4j.Slf4j
public class DesignLifecycleService {
    private final DesignLifecycleMapper lifecycle;
    private final GenerationMapper tasks;
    private final FileMapper files;
    private final TransactionTemplate tx;
    private final AssetProperties properties;
    private final tools.jackson.databind.ObjectMapper json;

    public DesignLifecycleService(
            DesignLifecycleMapper lifecycle,
            GenerationMapper tasks,
            FileMapper files,
            org.springframework.transaction.PlatformTransactionManager manager,
            AssetProperties properties,
            tools.jackson.databind.ObjectMapper json) {
        this.lifecycle = lifecycle;
        this.tasks = tasks;
        this.files = files;
        this.tx = new TransactionTemplate(manager);
        this.properties = properties;
        this.json = json;
    }

    public void remove(Long user, String value, boolean hide) {
        Long id = GenerationService.id(value);
        tx.executeWithoutResult(
                s -> {
                    if (files.lockUser(user) == null)
                        throw new ApiException(401, "UNAUTHENTICATED", "请先登录");
                    var task = tasks.lock(user, id);
                    if (task == null) throw new ApiException(404, "DESIGN_NOT_FOUND", "设计记录不存在");
                    if (hide && task.getHiddenAt() != null) return;
                    if (task.getHiddenAt() != null)
                        throw new ApiException(404, "DESIGN_NOT_FOUND", "设计记录不存在");
                    boolean allowed =
                            hide
                                    ? "UNKNOWN".equals(task.getStatus())
                                    : java.util.Set.of("SUCCEEDED", "FAILED")
                                            .contains(task.getStatus());
                    if (!allowed)
                        throw new ApiException(409, "DESIGN_ACTION_NOT_ALLOWED", "当前状态不能执行此操作");
                    if (hide) lifecycle.hide(user, id);
                    else purge(user, id);
                });
    }

    public void cleanup() {
        if (properties.isMaintenance()) return;
        for (var candidate : lifecycle.purgeCandidates()) {
            try {
                tx.executeWithoutResult(
                        s -> {
                            files.lockUser(candidate.getUserId());
                            if (tasks.lock(candidate.getUserId(), candidate.getId()) != null
                                    && lifecycle.purgeable(candidate.getUserId(), candidate.getId())
                                            > 0) purge(candidate.getUserId(), candidate.getId());
                        });
            } catch (RuntimeException failure) {
                log.warn(
                        "Design cleanup deferred: task={}, type={}",
                        candidate.getId(),
                        failure.getClass().getSimpleName());
            }
        }
    }

    private void purge(Long user, Long task) {
        var assets = lifecycle.assets(user, task);
        lifecycle.folderItems(user, task);
        lifecycle.favorites(user, task);
        lifecycle.items(user, task);
        lifecycle.hair(user, task);
        lifecycle.result(user, task);
        lifecycle.references(user, task);
        lifecycle.calls(user, task);
        lifecycle.jobs(user, task);
        lifecycle.detachRetries(user, task);
        tasks.release(user, task);
        lifecycle.task(user, task);
        for (Long asset : assets) scheduleCleanup(user, asset);
    }

    private void scheduleCleanup(Long user, Long asset) {
        if (files.directReferences(asset) > 0) return;
        for (String snapshot : files.recognitionReferences(user)) {
            var root = json.readTree(snapshot);
            var images = root.path("images");
            if (root.path("schemaVersion").asInt() != 1 || !images.isArray()) return;
            for (var image : images) {
                var id = image.path("assetId");
                if (!id.isString()
                        || !id.asText().matches("[1-9][0-9]*")
                        || id.asText().equals(asset.toString())) return;
            }
        }
        lifecycle.scheduleFile(user, asset);
    }
}
