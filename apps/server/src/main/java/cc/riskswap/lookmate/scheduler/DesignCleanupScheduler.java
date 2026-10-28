package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.service.DesignLifecycleService;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DesignCleanupScheduler {
    private final DesignLifecycleService lifecycle;

    @Scheduled(fixedDelayString = "${lookmate.generation.cleanup-ms:3000}")
    public void cleanup() {
        lifecycle.cleanup();
    }
}
