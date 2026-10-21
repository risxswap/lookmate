package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.RecognitionProperties;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/** Shared provider quota: planning priority, at most three planning grants while recognition waits. */
@Component
public class PlanningSlots {
    private final int capacity;
    private int active;
    private int planners;
    private int recognizers;
    private int planningStreak;

    public PlanningSlots(RecognitionProperties p) {
        capacity = Math.max(1, p.getProviderConcurrency());
    }

    public synchronized boolean acquire(boolean planning, long timeoutMillis)
            throws InterruptedException {
        long until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
        if (planning) planners++;
        else recognizers++;
        try {
            while (true) {
                boolean turn =
                        planning
                                ? (recognizers == 0 || planningStreak < 3)
                                : (planners == 0 || planningStreak >= 3);
                if (active < capacity && turn) {
                    active++;
                    planningStreak = planning ? planningStreak + 1 : 0;
                    return true;
                }
                long left = until - System.nanoTime();
                if (left <= 0) return false;
                TimeUnit.NANOSECONDS.timedWait(this, left);
            }
        } finally {
            if (planning) planners--;
            else recognizers--;
            notifyAll();
        }
    }

    public synchronized void release() {
        active--;
        notifyAll();
    }
}
