package cc.riskswap.lookmate.scheduler;

import cc.riskswap.lookmate.dao.mapper.AuthTicketMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class AuthTicketCleanupScheduler {
    private final AuthTicketMapper tickets;

    @Scheduled(fixedDelay = 3600000)
    public void cleanup() {
        tickets.cleanup();
    }
}
