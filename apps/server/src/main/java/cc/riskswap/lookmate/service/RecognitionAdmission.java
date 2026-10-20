package cc.riskswap.lookmate.service;

import java.util.concurrent.locks.ReentrantLock;
import cc.riskswap.lookmate.config.RecognitionProperties;
import cc.riskswap.lookmate.mapper.DressMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Single-server admission lock. Call under a user lock in a READ_COMMITTED transaction. */
@Service
@RequiredArgsConstructor
public class RecognitionAdmission {
    private final RecognitionProperties properties;
    private final DressMapper mapper;
    private final ReentrantLock lock = new ReentrantLock(true);

    public boolean acquire(Long user) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()
                || !TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new IllegalStateException("Recognition admission requires a transaction");
        }
        lock.lock();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) { lock.unlock(); }
        });
        return mapper.activeRecognitionCount() < Math.max(0, properties.getPendingLimit())
                && mapper.activeRecognitionCountForUser(user) < Math.max(0, properties.getUserPendingLimit());
    }
}
