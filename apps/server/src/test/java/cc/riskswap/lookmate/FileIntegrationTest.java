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
@SpringBootTest(properties = "lookmate.jobs.enabled=false")
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
        when(storage.signedUrl(anyString(), anyString(), anyLong()))
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
        when(storage.read(anyString(), anyString(), anyInt()))
                .thenReturn(ImageProcessorTest.png(10, 20));
        service.verify(files.find(USER, Long.valueOf(id)));
        var dto = service.get(USER, id);
        assertThat(dto.getStatus()).isEqualTo("TEMP");
        assertThat(dto.getMimeType()).isEqualTo("image/jpeg");
        assertThat(dto.getWidth()).isEqualTo(10);
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
    void invalidContentRejectsAndMissingObjectRetries() throws Exception {
        String id = upload();
        when(storage.read(anyString(), anyString(), anyInt())).thenThrow(new java.io.IOException());
        service.verify(files.find(USER, Long.valueOf(id)));
        assertThat(service.get(USER, id).getStatus()).isEqualTo("VERIFYING");
        assertThat(files.find(USER, Long.valueOf(id)).getVerificationToken()).isNull();
        service.complete(USER, id);
        assertThat(files.find(USER, Long.valueOf(id)).getVerificationLeaseUntil()).isNull();
        doReturn("not image".getBytes()).when(storage).read(anyString(), anyString(), anyInt());
        service.verify(files.find(USER, Long.valueOf(id)));
        assertThat(service.get(USER, id).getStatus()).isEqualTo("REJECTED");
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
