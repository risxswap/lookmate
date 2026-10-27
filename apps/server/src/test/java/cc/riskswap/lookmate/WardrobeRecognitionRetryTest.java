package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.DressMapper;
import cc.riskswap.lookmate.service.*;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

class WardrobeRecognitionRetryTest {
    private final DressMapper mapper = mock(DressMapper.class);
    private final RecognitionAvailability availability = mock(RecognitionAvailability.class);
    private final RecognitionAdmission admission = mock(RecognitionAdmission.class);
    private final WardrobeService service =
            new WardrobeService(mapper, availability, admission, JsonMapper.builder().build());
    private DressRecognitionRow latest;

    @BeforeEach
    void setup() {
        var dress = new DressRow();
        dress.setId(2L);
        dress.setUserId(1L);
        dress.setCategoryId(3L);
        dress.setImageRevision(1L);
        dress.setSeasonMask(0);
        dress.setName("外套");
        when(mapper.lockUser(1L)).thenReturn(1L);
        when(mapper.lockDress(1L, 2L)).thenReturn(2L);
        when(mapper.dress(1L, 2L)).thenReturn(dress);
        var image = new DressImageRow();
        image.setId(6L);
        image.setAssetId(7L);
        image.setSortOrder(0);
        image.setManualFeatures("{\"pattern\":\"人工图案\"}");
        when(mapper.images(1L, List.of(2L))).thenReturn(List.of(image));
        var file = new DressFileRow();
        file.setStatus("READY");
        file.setMimeType("image/jpeg");
        file.setSizeBytes(100L);
        when(mapper.file(1L, 7L)).thenReturn(file);
        latest = recognition(4L, "SUCCEEDED", 1);
        when(mapper.recognition(1L, 2L, 1L)).thenReturn(latest);
        when(availability.available()).thenReturn(true);
        when(availability.configSnapshot()).thenReturn("{}");
        when(admission.acquire(1L)).thenReturn(true);
    }

    @ParameterizedTest
    @ValueSource(strings = {"SUCCEEDED", "FAILED"})
    void terminalResultCanCreateIndependentPendingAttempt(String status) {
        latest.setStatus(status);
        var next = recognition(5L, "PENDING", 2);
        when(mapper.recognition(1L, 2L, 1L)).thenReturn(latest, next);
        var result = service.retry(1L, "2", Map.of("recognitionId", "4"));
        assertThat(result.getId()).isEqualTo("5");
        assertThat(result.getStatus()).isEqualTo("PENDING");
        verify(mapper)
                .createRecognition(
                        eq(1L),
                        eq(2L),
                        eq(1L),
                        eq(2),
                        eq("PENDING"),
                        anyString(),
                        eq("{}"),
                        eq(1),
                        isNull(),
                        isNull());
        verify(mapper, never()).manual(anyLong(), anyLong(), anyLong(), anyString());
        verify(mapper, never()).deleteRecognitions(anyLong(), anyLong());
    }

    @ParameterizedTest
    @ValueSource(strings = {"PENDING", "RUNNING", "SUPERSEDED"})
    void activeOrSupersededTaskCannotRetry(String status) {
        latest.setStatus(status);
        assertCode(
                () -> service.retry(1L, "2", Map.of("recognitionId", "4")),
                "RECOGNITION_NOT_RETRYABLE");
        verifyNoInteractions(admission);
    }

    @Test
    void staleIdAndOtherOwnerAreRejected() {
        assertCode(
                () -> service.retry(1L, "2", Map.of("recognitionId", "3")),
                "RECOGNITION_NOT_RETRYABLE");
        when(mapper.lockUser(9L)).thenReturn(9L);
        assertCode(() -> service.retry(9L, "2", Map.of("recognitionId", "4")), "DRESS_NOT_FOUND");
        verifyNoInteractions(admission);
    }

    @Test
    void unknownRequiresExplicitConfirmation() {
        latest.setStatus("UNKNOWN");
        assertCode(
                () -> service.retry(1L, "2", Map.of("recognitionId", "4")),
                "UNKNOWN_CONFIRMATION_REQUIRED");
        service.retry(1L, "2", Map.of("recognitionId", "4", "confirmUnknown", true));
        verify(admission).acquire(1L);
    }

    @Test
    void successfulRetryStillRequiresAvailableServiceAndCapacity() {
        when(availability.available()).thenReturn(false);
        assertCode(
                () -> service.retry(1L, "2", Map.of("recognitionId", "4")),
                "RECOGNITION_UNAVAILABLE");
        verifyNoInteractions(admission);
        when(availability.available()).thenReturn(true);
        when(admission.acquire(1L)).thenReturn(false);
        assertCode(
                () -> service.retry(1L, "2", Map.of("recognitionId", "4")),
                "RECOGNITION_CAPACITY_EXCEEDED");
        verify(mapper, never())
                .createRecognition(
                        anyLong(),
                        anyLong(),
                        anyLong(),
                        anyInt(),
                        anyString(),
                        anyString(),
                        anyString(),
                        anyInt(),
                        any(),
                        any());
    }

    @Test
    void successfulRetryStillChecksInputFiles() {
        when(mapper.file(1L, 7L)).thenReturn(null);
        assertCode(() -> service.retry(1L, "2", Map.of("recognitionId", "4")), "FILE_NOT_FOUND");
        verifyNoInteractions(admission);
        verify(mapper, never()).supersede(anyLong(), anyLong());
    }

    private static DressRecognitionRow recognition(long id, String status, int attempt) {
        var row = new DressRecognitionRow();
        row.setId(id);
        row.setDressId(2L);
        row.setImageRevision(1L);
        row.setAttemptNo(attempt);
        row.setStatus(status);
        row.setCreatedAt(java.time.LocalDateTime.of(2026, 10, 27, 0, 0));
        row.setUpdatedAt(row.getCreatedAt());
        return row;
    }

    private static void assertCode(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }
}
