package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.service.FileService;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;

@Component
@EnableScheduling
public class AssetScheduler {
    private final FileService files;
    private final ThreadPoolExecutor cleanup;

    public AssetScheduler(FileService files) {
        this.files = files;
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
        cleanup.shutdown();
    }
}
