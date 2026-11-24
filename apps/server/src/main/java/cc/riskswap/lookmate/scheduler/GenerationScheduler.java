package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.common.util.GenerationLog;
import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.service.GenerationExecutor;
import cc.riskswap.lookmate.service.GenerationStagingCleanup;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class GenerationScheduler {
    private final GenerationExecutor executor;
    private final ThreadPoolExecutor pool;
    private final ThreadPoolExecutor saves;
    private final GenerationStagingCleanup cleanup;
    private final ThreadPoolExecutor cleanupPool;

    public GenerationScheduler(
            GenerationExecutor executor, GenerationProperties p, GenerationStagingCleanup cleanup) {
        this.executor = executor;
        this.cleanup = cleanup;
        pool = create(p.workerCount(), "design-generation-");
        saves = create(1, "design-save-");
        cleanupPool = create(1, "design-staging-cleanup-");
    }

    private static ThreadPoolExecutor create(int n, String name) {
        return new ThreadPoolExecutor(
                n,
                n,
                0,
                TimeUnit.SECONDS,
                new SynchronousQueue<>(),
                Thread.ofPlatform().name(name, 0).factory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    @Scheduled(fixedDelayString = "${lookmate.generation.poll-ms:3000}")
    public void dispatch() {
        executor.recover();
        for (var row : executor.pending())
            try {
                ("SAVING".equals(row.getStatus()) ? saves : pool)
                        .execute(() -> executor.execute(row));
            } catch (RejectedExecutionException busy) {
                /* Retained in the bounded database queue for the next dispatch. */
            }
    }

    @Scheduled(fixedDelay = 10000)
    public void renew() {
        executor.renew();
    }

    @Scheduled(
            fixedDelayString = "${lookmate.generation.staging-cleanup-ms:60000}",
            initialDelayString = "${lookmate.generation.staging-cleanup-ms:60000}")
    public void sweepStaging() {
        try {
            cleanupPool.execute(
                    () -> {
                        long started = GenerationLog.started();
                        try {
                            cleanup.sweep();
                        } catch (RuntimeException failure) {
                            GenerationLog.failure("staging_cleanup", failure, started);
                        }
                    });
        } catch (RejectedExecutionException busy) {
            // The in-progress sweep retains its directory cursor for the next tick.
        }
    }

    @PreDestroy
    public void close() {
        pool.shutdown();
        saves.shutdown();
        cleanupPool.shutdown();
    }
}
