package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.AssetProperties;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;

@Component
@EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
        name = "lookmate.jobs.enabled",
        havingValue = "true",
        matchIfMissing = true)
public class AssetScheduler {
    private final FileService files;
    private final ThreadPoolExecutor processing;
    private final ThreadPoolExecutor cleanup;

    public AssetScheduler(FileService files, AssetProperties properties) {
        this.files = files;
        int count = Math.max(1, Math.min(4, properties.getProcessingConcurrency()));
        processing =
                new ThreadPoolExecutor(
                        count,
                        count,
                        0,
                        TimeUnit.SECONDS,
                        new SynchronousQueue<>(),
                        Thread.ofPlatform().name("image-verification-", 0).factory(),
                        new ThreadPoolExecutor.AbortPolicy());
        cleanup =
                new ThreadPoolExecutor(
                        1,
                        1,
                        0,
                        TimeUnit.SECONDS,
                        new SynchronousQueue<>(),
                        Thread.ofPlatform().name("asset-cleanup-", 0).factory(),
                        new ThreadPoolExecutor.AbortPolicy());
    }

    @Scheduled(fixedDelayString = "${lookmate.assets.poll-ms:3000}")
    public void dispatch() {
        for (var file : files.pending())
            try {
                processing.execute(() -> files.verify(file));
            } catch (RejectedExecutionException e) {
                break;
            }
    }

    @Scheduled(fixedDelayString = "${lookmate.assets.cleanup-ms:60000}")
    public void sweep() {
        try {
            cleanup.execute(files::cleanup);
        } catch (RejectedExecutionException e) {
            /* One durable sweep already running. */
        }
    }

    @PreDestroy
    public void close() {
        processing.shutdown();
        cleanup.shutdown();
    }
}
