package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.service.GenerationExecutor;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "lookmate.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class GenerationScheduler {
    private final GenerationExecutor executor;
    private final ThreadPoolExecutor pool;
    private final ThreadPoolExecutor saves;

    public GenerationScheduler(GenerationExecutor executor, GenerationProperties p) {
        this.executor = executor;
        int n = Math.max(1, Math.min(8, p.getConcurrency()));
        pool = create(n, "design-generation-");
        saves = create(1, "design-save-");
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

    @PreDestroy
    public void close() {
        pool.shutdown();
        saves.shutdown();
    }
}
