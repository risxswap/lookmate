package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.config.GenerationProperties;
import cc.riskswap.lookmate.dao.entity.GenerationTaskRow;
import cc.riskswap.lookmate.dao.mapper.GenerationMapper;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class GenerationStagingCleanupTest {
    @TempDir Path directory;
    final GenerationProperties properties = new GenerationProperties();
    final AssetProperties assets = new AssetProperties();
    final GenerationMapper tasks = mock(GenerationMapper.class);
    final GenerationExecutor executor = mock(GenerationExecutor.class);
    final GenerationStagingCleanup cleanup =
            new GenerationStagingCleanup(properties, assets, tasks, executor);

    @BeforeEach
    void start() {
        properties.setStagingDirectory(directory.toString());
    }

    @AfterEach
    void close() {
        cleanup.close();
    }

    @Test
    void failedPublicationRemovesItsTemporaryFileOnly() throws IOException {
        Path target = Files.createDirectory(directory.resolve("1-2.image"));
        Path nested = Files.createFile(target.resolve("keep"));
        assertThatIOException()
                .isThrownBy(() -> GenerationStaging.writeDurable(target, new byte[16], 16));
        assertThat(directory.resolve("1-2.image.tmp")).doesNotExist();
        assertThat(nested).exists();

        Path link = Files.createSymbolicLink(directory.resolve("1-3.image.tmp"), nested);
        assertThatIOException()
                .isThrownBy(
                        () ->
                                GenerationStaging.writeDurable(
                                        directory.resolve("1-3.image"), new byte[16], 16));
        assertThat(Files.isSymbolicLink(link)).isTrue();
        assertThat(Files.size(nested)).isZero();
    }

    @Test
    void sweepOnlyDeletesAgedTerminalAndOrphanFiles() throws IOException {
        List<GenerationTaskRow> rows = new ArrayList<>();
        var statuses =
                List.of(
                        "SUCCEEDED",
                        "FAILED",
                        "QUEUED",
                        "PLANNING",
                        "GENERATING",
                        "SAVING",
                        "UNKNOWN",
                        "FUTURE");
        for (int i = 0; i < statuses.size(); i++) {
            rows.add(task(i + 1L, 1L, statuses.get(i)));
            old("1-" + (i + 1) + ".image");
        }
        rows.add(task(9L, 2L, "SUCCEEDED"));
        old("1-9.image");
        rows.add(task(10L, 1L, "SUCCEEDED"));
        rows.getLast().setAttemptToken("still-owned");
        old("1-10.image.tmp");
        rows.add(task(11L, 1L, "SUCCEEDED"));
        when(executor.isRunning(11L)).thenReturn(true);
        old("1-11.image");
        old("1-12.image.tmp");
        old("1-13.image");
        Path unrelated = old("report");
        Path link = Files.createSymbolicLink(directory.resolve("1-14.image"), unrelated);
        Files.createDirectory(directory.resolve("1-15.image"));
        Files.createFile(directory.resolve("1-16.image.tmp"));
        old("1-9999999999999999999.image");
        when(tasks.stagingTasks(anySet())).thenReturn(rows);

        cleanup.sweep();

        for (String name : List.of("1-1.image", "1-2.image", "1-12.image.tmp", "1-13.image"))
            assertThat(directory.resolve(name)).doesNotExist();
        for (String name :
                List.of(
                        "1-3.image",
                        "1-4.image",
                        "1-5.image",
                        "1-6.image",
                        "1-7.image",
                        "1-8.image",
                        "1-9.image",
                        "1-10.image.tmp",
                        "1-11.image",
                        "report",
                        "1-15.image",
                        "1-16.image.tmp",
                        "1-9999999999999999999.image"))
            assertThat(directory.resolve(name)).exists();
        assertThat(Files.isSymbolicLink(link)).isTrue();
        verify(tasks).stagingTasks(Set.of(1L, 2L, 3L, 4L, 5L, 6L, 7L, 8L, 9L, 10L, 11L, 12L, 13L));
    }

    @Test
    void boundedScansAdvancePastUnrelatedEntriesAndRetryAfterDatabaseFailure() throws IOException {
        properties.setStagingCleanupBatchSize(2);
        List<Path> orphaned = new ArrayList<>();
        for (int id = 1; id <= 12; id++) {
            old("keep-" + id);
            orphaned.add(old("1-" + id + ".image"));
        }
        when(tasks.stagingTasks(anySet()))
                .thenAnswer(
                        call -> {
                            assertThat(call.<Set<Long>>getArgument(0)).hasSizeLessThanOrEqualTo(2);
                            throw new IllegalStateException("unavailable");
                        });
        assets.setMaintenance(true);
        cleanup.sweep();
        verifyNoInteractions(tasks);
        assets.setMaintenance(false);
        for (int i = 0; i < 13; i++) {
            try {
                cleanup.sweep();
            } catch (IllegalStateException unavailable) {
                assertThat(unavailable).hasMessage("unavailable");
            }
        }
        assertThat(orphaned).allMatch(Files::exists);
        doReturn(List.of()).when(tasks).stagingTasks(anySet());
        for (int i = 0; i < 26; i++) cleanup.sweep();
        assertThat(orphaned).noneMatch(Files::exists);
        assertThat(directory.resolve("keep-1")).exists();
    }

    private Path old(String name) throws IOException {
        Path path = Files.createFile(directory.resolve(name));
        return Files.setLastModifiedTime(
                path, FileTime.from(Instant.now().minus(Duration.ofDays(2))));
    }

    private GenerationTaskRow task(long id, long user, String status) {
        var row = new GenerationTaskRow();
        row.setId(id);
        row.setUserId(user);
        row.setStatus(status);
        return row;
    }
}
