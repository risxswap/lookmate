package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.config.RecognitionProperties;
import cc.riskswap.lookmate.service.RecognitionExecutor;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "lookmate.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class RecognitionScheduler {
    private final RecognitionExecutor executor;
    private final ThreadPoolExecutor pool;

    public RecognitionScheduler(RecognitionExecutor executor, RecognitionProperties properties) {
        this.executor = executor;
        int n = Math.max(1, Math.min(4, properties.getConcurrency()));
        pool =
                new ThreadPoolExecutor(
                        n,
                        n,
                        0,
                        TimeUnit.SECONDS,
                        new SynchronousQueue<>(),
                        Thread.ofPlatform().name("dress-recognition-", 0).factory(),
                        new ThreadPoolExecutor.AbortPolicy());
    }

    @Scheduled(fixedDelayString = "${lookmate.recognition.poll-ms:3000}")
    public void dispatch() {
        executor.recover();
        for (var row : executor.pending())
            try {
                pool.execute(() -> executor.execute(row));
            } catch (RejectedExecutionException e) {
                break;
            }
    }

    @PreDestroy
    public void close() {
        pool.shutdown();
    }
}
