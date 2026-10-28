package cc.riskswap.lookmate.common.util;

import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.integration.ai.GenerationFailure;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** Only pass diagnostic identifiers and counts, never user content or exception messages. */
public final class GenerationLog {
    private static final Logger LOG = LoggerFactory.getLogger(GenerationLog.class);
    private static final String TASK = "generationTaskId";

    private GenerationLog() {}

    public static long started() {
        return System.nanoTime();
    }

    public static long elapsed(long started) {
        return (System.nanoTime() - started) / 1_000_000;
    }

    public static String label(Object value) {
        if (!(value instanceof String text)
                || text.length() > 120
                || !text.matches("[A-Za-z0-9_.:/-]+")
                || text.startsWith("sk-")) return "unavailable";
        return text;
    }

    public static void info(String event, String details, Object... args) {
        LOG.info("generation taskId={} event={} requestId={} " + details, arguments(event, args));
    }

    public static void warn(String event, String details, Object... args) {
        LOG.warn("generation taskId={} event={} requestId={} " + details, arguments(event, args));
    }

    private static Object[] arguments(String event, Object[] args) {
        Object[] values = new Object[args.length + 3];
        values[0] = MDC.get(TASK) == null ? "-" : MDC.get(TASK);
        values[1] = event;
        var request = RequestContextHolder.getRequestAttributes();
        values[2] =
                request instanceof ServletRequestAttributes attributes
                        ? label(attributes.getRequest().getAttribute(ApiErrors.REQUEST_ID))
                        : "-";
        System.arraycopy(args, 0, values, 3, args.length);
        return values;
    }

    public static <T> T operation(String event, Supplier<T> action) {
        long start = started();
        info(event + "_started", "");
        try {
            T result = action.get();
            info(event + "_returned", "elapsedMs={}", elapsed(start));
            return result;
        } catch (RuntimeException e) {
            failure(event, e, start);
            throw e;
        }
    }

    public static String causeType(Throwable error) {
        Throwable cause = error;
        for (int depth = 0;
                depth < 16 && cause.getCause() != null && cause.getCause() != cause;
                depth++) cause = cause.getCause();
        return cause.getClass().getSimpleName();
    }

    public static void failure(String event, Exception error, long start) {
        String code =
                error instanceof GenerationFailure f
                        ? f.getCode()
                        : error instanceof ApiException e ? e.getCode() : "UNEXPECTED_ERROR";
        warn(
                event + "_failed",
                "code={} exceptionType={} uncertain={} elapsedMs={}",
                label(code),
                error.getClass().getSimpleName(),
                error instanceof GenerationFailure f && f.isUncertain(),
                elapsed(start));
    }

    public static void task(Long taskId, Runnable action) {
        String previous = MDC.get(TASK);
        MDC.put(TASK, String.valueOf(taskId));
        try {
            action.run();
        } finally {
            if (previous == null) MDC.remove(TASK);
            else MDC.put(TASK, previous);
        }
    }

    public static void afterCommit(Long taskId, String event, String details, Object... args) {
        Runnable record = () -> task(taskId, () -> info(event, details, args));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            record.run();
                        }
                    });
        } else record.run();
    }
}
