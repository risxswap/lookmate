package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.util.GenerationLog;
import cc.riskswap.lookmate.config.*;
import cc.riskswap.lookmate.dao.entity.GenerationTaskRow;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.ai.GenerationGateway;
import cc.riskswap.lookmate.integration.storage.*;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.nio.file.Path;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.*;
import tools.jackson.databind.ObjectMapper;

class GenerationExecutorLogTest {
    @TempDir Path directory;
    private final GenerationMapper tasks = mock(GenerationMapper.class);
    private final FileMapper files = mock(FileMapper.class);
    private final Logger logger = (Logger) LoggerFactory.getLogger(GenerationLog.class);
    private final ListAppender<ILoggingEvent> capture = new ListAppender<>();
    private GenerationExecutor executor;
    private GenerationTaskRow row;

    @BeforeEach
    void setup() {
        capture.start();
        logger.addAppender(capture);
        var properties = new GenerationProperties();
        properties.setStagingDirectory(directory.toString());
        var manager =
                new AbstractPlatformTransactionManager() {
                    @Override
                    protected Object doGetTransaction() {
                        return new Object();
                    }

                    @Override
                    protected void doBegin(Object transaction, TransactionDefinition definition) {}

                    @Override
                    protected void doCommit(DefaultTransactionStatus status) {}

                    @Override
                    protected void doRollback(DefaultTransactionStatus status) {}
                };
        executor =
                new GenerationExecutor(
                        tasks,
                        files,
                        mock(GenerationService.class),
                        mock(GenerationEngine.class),
                        mock(GenerationGateway.class),
                        mock(ObjectStorage.class),
                        mock(GeneratedImageValidator.class),
                        properties,
                        new AssetProperties(),
                        mock(PlanningSlots.class),
                        new ObjectMapper(),
                        manager,
                        new HairstyleCatalogService());
        row = new GenerationTaskRow();
        row.setId(123L);
        row.setUserId(1L);
        row.setStatus("SAVING");
        row.setResumeStage("IMAGE");
    }

    @AfterEach
    void cleanup() {
        logger.detachAppender(capture);
        MDC.clear();
    }

    @Test
    void claimFailureIsCorrelatedAndDoesNotLeakDatabaseError() {
        when(files.lockUser(1L)).thenThrow(new IllegalStateException("secret-db-credentials"));
        assertThatThrownBy(() -> executor.execute(row)).isInstanceOf(IllegalStateException.class);
        assertThat(logs())
                .contains(
                        "taskId=123",
                        "event=task_execution_failed",
                        "exceptionType=IllegalStateException")
                .doesNotContain("secret-db-credentials", "task_claimed");
        assertThat(MDC.get("generationTaskId")).isNull();
    }

    @Test
    void missingStagedResultLogsCommittedFailureAndReleasesContext() {
        when(tasks.lock(1L, 123L)).thenReturn(row);
        when(tasks.claim(eq(123L), eq("SAVING"), eq("SAVING"), anyString(), anyInt()))
                .thenReturn(1);
        executor.execute(row);
        assertThat(logs())
                .contains(
                        "event=task_claimed",
                        "event=save_resumed",
                        "event=save_started",
                        "event=task_finished",
                        "status=FAILED stage=SAVE code=RESULT_SAVE_FAILED",
                        "event=execution_released");
        assertThat(MDC.get("generationTaskId")).isNull();
    }

    @Test
    void lostOwnershipDoesNotLogTerminalSuccessOrFailure() {
        when(tasks.lock(1L, 123L)).thenReturn(row).thenReturn(null);
        when(tasks.claim(eq(123L), eq("SAVING"), eq("SAVING"), anyString(), anyInt()))
                .thenReturn(1);
        executor.execute(row);
        assertThat(logs())
                .contains("event=task_ownership_lost")
                .doesNotContain("event=task_finished");
    }

    private String logs() {
        return capture.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .reduce("", (a, b) -> a + b);
    }
}
