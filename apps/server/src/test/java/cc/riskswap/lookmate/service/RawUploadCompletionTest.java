package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.dao.entity.FileAssetRow;
import cc.riskswap.lookmate.dao.mapper.FileMapper;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.io.IOException;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

class RawUploadCompletionTest {
    private final FileMapper files = mock(FileMapper.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    private final FileService service =
            new FileService(files, storage, new AssetProperties(), transactions, new JsonMapper());

    @BeforeEach
    void available() {
        when(storage.available()).thenReturn(true);
    }

    @Test
    void registersOriginalUsingMetadataWithoutDownloadingOrWritingImages() throws Exception {
        var row = pending();
        when(files.lock(7L, 31L)).thenReturn(row);
        when(files.complete(row)).thenReturn(1);
        when(storage.stat("bucket", "original/31"))
                .thenAnswer(
                        invocation -> {
                            verifyNoInteractions(transactions);
                            return new ObjectStorage.Metadata(123456L, "image/png");
                        });
        Instant expiry = row.getExpiresAt();
        var result = service.complete(7L, "31");
        assertThat(result.getStatus()).isEqualTo("TEMP");
        assertThat(result.getMimeType()).isEqualTo("image/png");
        assertThat(result.getSizeBytes()).isEqualTo(123456L);
        assertThat(result.getWidth()).isNull();
        assertThat(result.getHeight()).isNull();
        assertThat(row.getStorageKey()).isEqualTo("original/31");
        assertThat(row.getExpiresAt()).isEqualTo(expiry);
        verify(storage, never()).read(any(), any(), anyInt());
        verify(storage, never()).put(any(), any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TEMP", "READY"})
    void repeatedCompletionReturnsExistingAssetWithoutStorageIo(String status) throws Exception {
        var row = pending();
        row.setStatus(status);
        assertThat(service.complete(7L, "31").getStatus()).isEqualTo(status);
        verify(storage, never()).stat(any(), any());
        verify(files, never()).complete(any());
        verifyNoInteractions(transactions);
    }

    @Test
    void otherUsersAssetIsNotFoundBeforeStorageAccess() throws Exception {
        assertApiError(404, "FILE_NOT_FOUND");
        verify(files).find(7L, 31L);
        verify(storage, never()).stat(any(), any());
    }

    @Test
    void expiredIntentCannotBeCompleted() throws Exception {
        var row = pending();
        row.setExpiresAt(row.getDbNow());
        assertApiError(409, "FILE_NOT_USABLE");
        verify(storage, never()).stat(any(), any());
    }

    @Test
    void missingObjectCanBeRetriedWithoutChangingState() {
        var row = pending();
        assertApiError(409, "UPLOAD_NOT_COMPLETE");
        assertThat(row.getStatus()).isEqualTo("UPLOADING");
        verify(files, never()).complete(any());
    }

    @ParameterizedTest
    @CsvSource({"0,image/jpeg", "20971521,image/jpeg", "100,text/plain"})
    void rejectsInvalidStorageReportedSizeOrMime(long bytes, String mime) throws Exception {
        pending();
        when(storage.stat("bucket", "original/31"))
                .thenReturn(new ObjectStorage.Metadata(bytes, mime));
        assertApiError(400, "VALIDATION_ERROR");
        verify(files, never()).complete(any());
    }

    @Test
    void rejectsMissingStorageMime() throws Exception {
        pending();
        when(storage.stat("bucket", "original/31"))
                .thenReturn(new ObjectStorage.Metadata(100, null));
        assertApiError(400, "VALIDATION_ERROR");
        verify(files, never()).complete(any());
    }

    @Test
    void storageFailureRemainsRetryable() throws Exception {
        var row = pending();
        when(storage.stat("bucket", "original/31")).thenThrow(new IOException("unavailable"));
        assertApiError(503, "STORAGE_UNAVAILABLE");
        assertThat(row.getStatus()).isEqualTo("UPLOADING");
        verify(files, never()).complete(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"DELETING", "EXPIRED", "REMOVED", "CLEANUP"})
    void rechecksStateAfterStorageRequestAndNeverRevivesCleanup(String state) throws Exception {
        pending();
        var current = asset();
        switch (state) {
            case "DELETING" -> current.setStatus("DELETING");
            case "EXPIRED" -> current.setExpiresAt(current.getDbNow());
            case "CLEANUP" -> current.setCleanupAfter(current.getDbNow());
            case "REMOVED" -> current = null;
            default -> throw new IllegalArgumentException(state);
        }
        when(files.lock(7L, 31L)).thenReturn(current);
        when(storage.stat("bucket", "original/31"))
                .thenReturn(new ObjectStorage.Metadata(100, "image/jpeg"));
        boolean missing = state.equals("DELETING") || state.equals("REMOVED");
        assertApiError(missing ? 404 : 409, missing ? "FILE_NOT_FOUND" : "FILE_NOT_USABLE");
        verify(files, never()).complete(any());
    }

    @Test
    void competingCompletionReturnsAlreadyCompletedAssetWithoutOverwritingIt() throws Exception {
        pending();
        var current = asset();
        current.setStatus("READY");
        current.setMimeType("image/webp");
        current.setSizeBytes(250L);
        when(files.lock(7L, 31L)).thenReturn(current);
        when(storage.stat("bucket", "original/31"))
                .thenReturn(new ObjectStorage.Metadata(100, "image/jpeg"));
        var result = service.complete(7L, "31");
        assertThat(result.getStatus()).isEqualTo("READY");
        assertThat(result.getMimeType()).isEqualTo("image/webp");
        assertThat(result.getSizeBytes()).isEqualTo(250L);
        verify(files, never()).complete(any());
    }

    @Test
    void conditionalWriteFailureDoesNotReportSuccess() throws Exception {
        var row = pending();
        when(files.lock(7L, 31L)).thenReturn(row);
        when(storage.stat("bucket", "original/31"))
                .thenReturn(new ObjectStorage.Metadata(100, "image/jpeg"));
        assertApiError(409, "FILE_NOT_USABLE");
    }

    private void assertApiError(int status, String code) {
        assertThatThrownBy(() -> service.complete(7L, "31"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error -> {
                            assertThat(error.getStatus()).isEqualTo(status);
                            assertThat(error.getCode()).isEqualTo(code);
                        });
    }

    private FileAssetRow pending() {
        var row = asset();
        when(files.find(7L, 31L)).thenReturn(row);
        return row;
    }

    private static FileAssetRow asset() {
        var row = new FileAssetRow();
        row.setId(31L);
        row.setUserId(7L);
        row.setBucket("bucket");
        row.setOriginalKey("original/31");
        row.setStorageKey("legacy/display/31");
        row.setStatus("UPLOADING");
        row.setDbNow(Instant.parse("2026-10-23T00:00:00Z"));
        row.setExpiresAt(row.getDbNow().plusSeconds(600));
        return row;
    }
}
