package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.FileUploadParam;
import cc.riskswap.lookmate.config.AssetProperties;
import cc.riskswap.lookmate.dao.mapper.FileMapper;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import cc.riskswap.lookmate.service.FileService;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest
@org.springframework.test.context.bean.override.mockito.MockitoBean(
        types = {
            cc.riskswap.lookmate.scheduler.AssetScheduler.class,
            cc.riskswap.lookmate.scheduler.RecognitionScheduler.class,
            cc.riskswap.lookmate.scheduler.GenerationScheduler.class
        })
class FileIntegrationTest {
    static final long USER = -911, OTHER = -912;
    @Autowired FileService service;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean FileMapper files;
    @Autowired JdbcTemplate db;
    @Autowired AssetProperties properties;
    @MockitoBean ObjectStorage storage;

    @BeforeEach
    void setup() {
        clean();
        properties.setPendingLimit(100);
        properties.setUserPendingLimit(20);
        for (long id : new long[] {USER, OTHER})
            db.update(
                    "INSERT INTO user(id,username,password_hash,created_at,updated_at) VALUES(?,?,'test',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    id,
                    "filetest" + -id);
        doAnswer(
                        inv ->
                                db
                                        .queryForList(
                                                "SELECT id FROM file_asset WHERE user_id=? AND (status='DELETING' OR expires_at<UTC_TIMESTAMP(3) OR cleanup_after<=UTC_TIMESTAMP(3))",
                                                Long.class,
                                                USER)
                                        .stream()
                                        .map(id -> files.find(USER, id))
                                        .toList())
                .when(files)
                .garbage();
        when(storage.available()).thenReturn(true);
        when(storage.bucket()).thenReturn("test");
        when(storage.uploadUrl()).thenReturn("https://upload.example");
        when(storage.uploadToken(anyString(), anyLong(), anyLong())).thenReturn("scoped-token");
        when(storage.thumbnailUrl(anyString(), anyString(), anyLong()))
                .thenReturn("https://private.example/signed");
    }

    @AfterEach
    void clean() {
        db.update("DELETE FROM dress_recognition WHERE user_id IN (?,?)", USER, OTHER);
        db.update("DELETE FROM user_photo WHERE user_id IN (?,?)", USER, OTHER);
        db.update("DELETE FROM file_asset WHERE user_id IN (?,?)", USER, OTHER);
        db.update("DELETE FROM user WHERE id IN (?,?)", USER, OTHER);
    }

    private String upload() {
        var p = new FileUploadParam();
        p.setOriginalName("shirt.png");
        p.setSizeBytes(100L);
        p.setMimeType("image/png");
        return (String) service.intent(USER, p).get("fileId");
    }

    @Test
    void verifiesActualBytesAndScopesAccess() throws Exception {
        String id = upload();
        when(storage.stat(anyString(), anyString()))
                .thenReturn(new ObjectStorage.Metadata(100, "image/png"));
        var dto = service.complete(USER, id);
        assertThat(dto.getStatus()).isEqualTo("TEMP");
        assertThat(dto.getMimeType()).isEqualTo("image/png");
        assertThat(dto.getWidth()).isNull();
        assertThat(files.find(USER, Long.valueOf(id)).getStorageKey())
                .isEqualTo(files.find(USER, Long.valueOf(id)).getOriginalKey());
        verify(storage, never()).read(anyString(), anyString(), anyInt());
        verify(storage, never()).put(anyString(), anyString(), any(), anyString());
        assertThat(service.access(USER, id, "THUMBNAIL")).containsKey("url");
        assertThatThrownBy(() -> service.access(OTHER, id, "DISPLAY"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("FILE_NOT_FOUND"));
        db.update(
                "UPDATE file_asset SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                id);
        assertThatThrownBy(() -> service.access(USER, id, "DISPLAY"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("FILE_NOT_USABLE"));
    }

    @Test
    void invalidMetadataAndMissingObjectCanRetry() throws Exception {
        String id = upload();
        when(storage.stat(anyString(), anyString())).thenReturn(null);
        assertThatThrownBy(() -> service.complete(USER, id))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("UPLOAD_NOT_COMPLETE"));
        when(storage.stat(anyString(), anyString()))
                .thenReturn(new ObjectStorage.Metadata(100, "text/plain"));
        assertThatThrownBy(() -> service.complete(USER, id))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("VALIDATION_ERROR"));
        assertThat(service.get(USER, id).getStatus()).isEqualTo("UPLOADING");
        when(storage.stat(anyString(), anyString()))
                .thenReturn(new ObjectStorage.Metadata(100, "image/jpeg"));
        assertThat(service.complete(USER, id).getStatus()).isEqualTo("TEMP");
    }

    @Test
    void legacyDerivativesRemainTrackedAndNullLeaseCanBeCleaned() throws Exception {
        String id = upload();
        db.update(
                "UPDATE file_asset SET status='VERIFYING',storage_key='legacy/display',thumbnail_key='legacy/thumb',verification_lease_until=NULL WHERE id=?",
                id);
        when(storage.stat(anyString(), anyString()))
                .thenReturn(new ObjectStorage.Metadata(100, "image/jpeg"));
        service.complete(USER, id);
        var row = files.find(USER, Long.valueOf(id));
        assertThat(row.getStorageKey()).isEqualTo(row.getOriginalKey());
        assertThat(row.getThumbnailKey()).isNull();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM file_asset WHERE user_id=? AND status='DELETING' AND storage_key='legacy/display' AND thumbnail_key='legacy/thumb'",
                                Long.class,
                                USER))
                .isEqualTo(1L);
        service.complete(USER, id);
        service.cleanup();
        verify(storage).delete("test", "legacy/display");
        verify(storage).delete("test", "legacy/thumb");
        verify(storage, never()).delete("test", row.getOriginalKey());
    }

    @Test
    void cleanupPreservesReferencesAndRetriesDeletion() throws Exception {
        String id = upload();
        db.update(
                "UPDATE file_asset SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                id);
        db.update(
                "INSERT INTO user_photo(user_id,asset_id,photo_type,created_at,updated_at) VALUES(?,?,'REFERENCE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                id);
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id))).isNotNull();
        verify(storage, never()).delete(anyString(), anyString());
        db.update("DELETE FROM user_photo WHERE user_id=?", USER);
        doThrow(new java.io.IOException()).when(storage).delete(anyString(), anyString());
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id)).getStatus()).isEqualTo("DELETING");
        doNothing().when(storage).delete(anyString(), anyString());
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id))).isNull();
    }

    @Test
    void cleanupRespectsUnknownSnapshotAndRecognitionAssets() {
        String id = upload();
        db.update(
                "UPDATE file_asset SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                id);
        db.update(
                "INSERT INTO dress_recognition(user_id,dress_id,image_revision,attempt_no,status,input_snapshot,holds_input_assets,config_snapshot,created_at,updated_at) VALUES(?,999,1,1,'UNKNOWN',?,1,'{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                "{\"schemaVersion\":1,\"images\":[{\"assetId\":\"" + id + "\"}]}");
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id))).isNotNull();
        db.update(
                "UPDATE dress_recognition SET input_snapshot='{\"schemaVersion\":99,\"images\":[]}' WHERE user_id=?",
                USER);
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id))).isNotNull();
        db.update("UPDATE dress_recognition SET holds_input_assets=0 WHERE user_id=?", USER);
        service.cleanup();
        assertThat(files.find(USER, Long.valueOf(id))).isNull();
    }

    @Test
    void rejectsUnconfiguredAndPerUserCapacity() {
        when(storage.available()).thenReturn(false);
        assertThatThrownBy(this::upload)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(503));
        when(storage.available()).thenReturn(true);
        properties.setUserPendingLimit(1);
        upload();
        assertThatThrownBy(this::upload)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(429));
    }
}
