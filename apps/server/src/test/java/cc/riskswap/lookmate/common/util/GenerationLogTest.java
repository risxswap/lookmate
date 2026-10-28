package cc.riskswap.lookmate.common.util;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.api.ApiErrors;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.*;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.*;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class GenerationLogTest {
    private final Logger logger = (Logger) LoggerFactory.getLogger(GenerationLog.class);
    private final ListAppender<ILoggingEvent> capture = new ListAppender<>();

    @BeforeEach
    void start() {
        capture.start();
        logger.addAppender(capture);
    }

    @AfterEach
    void stop() {
        logger.detachAppender(capture);
        MDC.clear();
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void restoresTaskContextAfterFailureAndDoesNotLogExceptionContent() {
        MDC.put("generationTaskId", "outer");
        assertThatThrownBy(
                        () ->
                                GenerationLog.task(
                                        42L,
                                        () ->
                                                GenerationLog.operation(
                                                        "test",
                                                        () -> {
                                                            throw new IllegalStateException(
                                                                    "secret-photo-url?token=private");
                                                        })))
                .isInstanceOf(IllegalStateException.class);
        assertThat(MDC.get("generationTaskId")).isEqualTo("outer");
        GenerationLog.info("next_task", "");
        String logs =
                capture.list.stream()
                        .map(ILoggingEvent::getFormattedMessage)
                        .reduce("", (a, b) -> a + b);
        assertThat(logs)
                .contains(
                        "taskId=42",
                        "event=test_failed",
                        "exceptionType=IllegalStateException",
                        "taskId=outer event=next_task")
                .doesNotContain("secret-photo", "private");
        assertThat(capture.list).allSatisfy(e -> assertThat(e.getThrowableProxy()).isNull());
        MDC.remove("generationTaskId");
        GenerationLog.task(43L, () -> GenerationLog.info("done", ""));
        assertThat(MDC.get("generationTaskId")).isNull();
    }

    @Test
    void includesRequestIdBeforeTaskExistsAndSafeRootCauseType() {
        var request = new MockHttpServletRequest();
        request.setAttribute(ApiErrors.REQUEST_ID, "request-123");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        GenerationLog.info("preview_started", "");
        assertThat(capture.list)
                .singleElement()
                .satisfies(
                        e ->
                                assertThat(e.getFormattedMessage())
                                        .contains("taskId=-", "requestId=request-123"));
        assertThat(
                        GenerationLog.causeType(
                                new RuntimeException(
                                        new java.net.http.HttpTimeoutException("private-url"))))
                .isEqualTo("HttpTimeoutException");
    }

    @Test
    void queuedEventIsEmittedOnlyAfterCommitAndNeverOnRollback() {
        var tx =
                new TransactionTemplate(
                        new AbstractPlatformTransactionManager() {
                            @Override
                            protected Object doGetTransaction() {
                                return new Object();
                            }

                            @Override
                            protected void doBegin(
                                    Object transaction, TransactionDefinition definition) {}

                            @Override
                            protected void doCommit(DefaultTransactionStatus status) {}

                            @Override
                            protected void doRollback(DefaultTransactionStatus status) {}
                        });
        tx.executeWithoutResult(
                s -> {
                    GenerationLog.afterCommit(42L, "task_queued", "status=QUEUED");
                    assertThat(capture.list).isEmpty();
                });
        assertThat(capture.list)
                .singleElement()
                .satisfies(
                        e ->
                                assertThat(e.getFormattedMessage())
                                        .contains("taskId=42 event=task_queued"));
        capture.list.clear();
        tx.executeWithoutResult(
                s -> {
                    GenerationLog.afterCommit(43L, "task_queued", "status=QUEUED");
                    s.setRollbackOnly();
                });
        assertThat(capture.list).isEmpty();
    }
}
