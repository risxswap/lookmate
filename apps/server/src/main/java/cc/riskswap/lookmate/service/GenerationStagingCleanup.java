package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.dao.entity.GenerationTaskRow;
import cc.riskswap.lookmate.dao.mapper.GenerationMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class GenerationStagingCleanup {
    private static final Pattern NAME =
            Pattern.compile("([1-9][0-9]{0,18})-([1-9][0-9]{0,18})\\.image(?:\\.tmp)?");
    private final GenerationProperties properties;
    private final AssetProperties assets;
    private final GenerationMapper tasks;
    private final GenerationExecutor executor;
    private DirectoryStream<Path> directory;
    private Iterator<Path> entries;

    private record Candidate(Path path, long userId, long taskId) {}

    public synchronized void sweep() {
        Path root = GenerationStaging.directory(properties);
        if (assets.isMaintenance() || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            close();
            return;
        }
        Instant cutoff =
                Instant.now().minusSeconds(Math.max(1, properties.getStagingCleanupGraceSeconds()));
        List<Candidate> candidates = new ArrayList<>();
        try {
            if (directory == null) {
                directory = Files.newDirectoryStream(root);
                entries = directory.iterator();
            }
            // Count every directory entry, even unrelated names. Continue the same scan next tick.
            int limit = Math.clamp(properties.getStagingCleanupBatchSize(), 1, 512);
            for (int i = 0; i < limit && entries.hasNext(); i++) {
                Path path = entries.next();
                var match = NAME.matcher(path.getFileName().toString());
                if (!match.matches() || !isOldRegularFile(path, cutoff)) continue;
                try {
                    candidates.add(
                            new Candidate(
                                    path,
                                    Long.parseLong(match.group(1)),
                                    Long.parseLong(match.group(2))));
                } catch (NumberFormatException ignored) {
                    // Outside the BIGINT ID range.
                }
            }
            if (!entries.hasNext()) close();
        } catch (IOException | DirectoryIteratorException failure) {
            close();
            log.warn(
                    "Generation staging scan deferred: type={}",
                    failure.getClass().getSimpleName());
            return;
        }
        if (candidates.isEmpty()) return;

        Set<Long> ids = new HashSet<>();
        for (var file : candidates) ids.add(file.taskId());
        Map<Long, GenerationTaskRow> owners = new HashMap<>();
        for (var row : tasks.stagingTasks(ids)) owners.put(row.getId(), row);
        for (var file : candidates) {
            // IDs are immutable and retries create a new task. UNKNOWN can still be reconciled.
            var owner = owners.get(file.taskId());
            if (owner != null
                    && (!Objects.equals(owner.getUserId(), file.userId())
                            || owner.getAttemptToken() != null
                            || !("SUCCEEDED".equals(owner.getStatus())
                                    || "FAILED".equals(owner.getStatus())))) continue;
            if (executor.isRunning(file.taskId()) || !isOldRegularFile(file.path(), cutoff))
                continue;
            try {
                Files.deleteIfExists(file.path());
            } catch (IOException failure) {
                log.warn(
                        "Generation staging removal deferred: task={}, type={}",
                        file.taskId(),
                        failure.getClass().getSimpleName());
            }
        }
    }

    private static boolean isOldRegularFile(Path path, Instant cutoff) {
        try {
            var attributes =
                    Files.readAttributes(
                            path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            return attributes.isRegularFile()
                    && !attributes.lastModifiedTime().toInstant().isAfter(cutoff);
        } catch (NoSuchFileException gone) {
            return false;
        } catch (IOException failure) {
            log.warn(
                    "Generation staging entry deferred: type={}",
                    failure.getClass().getSimpleName());
            return false;
        }
    }

    @PreDestroy
    public synchronized void close() {
        if (directory == null) return;
        try {
            directory.close();
        } catch (IOException failure) {
            log.warn(
                    "Generation staging directory close failed: type={}",
                    failure.getClass().getSimpleName());
        } finally {
            directory = null;
            entries = null;
        }
    }
}
