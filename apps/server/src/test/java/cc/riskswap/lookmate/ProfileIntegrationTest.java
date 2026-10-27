package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.ProfileParameters;
import cc.riskswap.lookmate.dao.mapper.ProfileMapper;
import cc.riskswap.lookmate.service.ProfileService;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(properties = "lookmate.jobs.enabled=false")
class ProfileIntegrationTest {
    private static final long USER = -1101, OTHER = -1102, FILE = 9007199254780000L;
    @Autowired ProfileService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.web.context.WebApplicationContext webContext;
    @MockitoSpyBean ProfileMapper mapper;
    @Autowired cc.riskswap.lookmate.service.FileService fileService;

    @org.springframework.test.context.bean.override.mockito.MockitoBean
    cc.riskswap.lookmate.integration.storage.ObjectStorage storage;

    @BeforeEach
    void setup() {
        clean();
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "profile_test_" + -user);
        for (int i = 0; i < 5; i++)
            jdbc.update(
                    "INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,width,height,expires_at,created_at,updated_at) VALUES(?,?,'test',?,'TEMP','image/jpeg',100,10,10,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    FILE + i,
                    i == 4 ? OTHER : USER,
                    "profile/" + i);
    }

    @AfterEach
    void clean() {
        reset(mapper);
        for (String table :
                List.of(
                        "user_preference",
                        "user_photo",
                        "body_measurement",
                        "design_task_asset",
                        "design_task",
                        "file_asset"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    private void error(Runnable op, String code) {
        assertThatThrownBy(op::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    private Map<String, Object> body(String json) {
        return ProfileParameters.parse(json);
    }

    private long count(String table) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM "
                        + table
                        + " WHERE user_id=?"
                        + (table.equals("body_measurement") ? " AND record_kind='HISTORY'" : ""),
                Long.class,
                USER);
    }

    @Test
    void nameNullOmissionUnicodeAndVersionBounds() {
        assertThat(service.get(USER).getCurrentMeasurement()).isNull();
        var profile = service.patch(USER, Map.of("version", "0", "displayName", "　 名称 \n"));
        assertThat(profile.getDisplayName()).isEqualTo("名称");
        assertThat(profile.getVersion()).isEqualTo("1");
        assertThat(service.patch(USER, Map.of("version", "1")).getDisplayName()).isEqualTo("名称");
        assertThat(
                        service.patch(USER, body("{\"version\":\"2\",\"displayName\":null}"))
                                .getDisplayName())
                .isNull();
        assertThat(
                        service.patch(USER, Map.of("version", "3", "displayName", "😀".repeat(64)))
                                .getDisplayName())
                .isEqualTo("😀".repeat(64));
        for (Object value : List.of("", " ", "😀".repeat(65), 12, false))
            error(
                    () -> service.patch(USER, Map.of("version", "4", "displayName", value)),
                    "VALIDATION_ERROR");
        for (Object value : List.of(4, "-1", "9223372036854775808", true))
            error(() -> service.patch(USER, Map.of("version", value)), "VALIDATION_ERROR");
        error(() -> service.patch(USER, Map.of()), "VALIDATION_ERROR");
        error(
                () -> service.patch(USER, Map.of("version", "4", "username", "changed")),
                "VALIDATION_ERROR");
        error(() -> service.patch(USER, Map.of("version", "3")), "VERSION_CONFLICT");
        jdbc.update("UPDATE `user` SET version=? WHERE id=?", Long.MAX_VALUE, USER);
        error(
                () -> service.patch(USER, Map.of("version", Long.toString(Long.MAX_VALUE))),
                "VERSION_CONFLICT");
    }

    @Test
    void allMeasurementsPersistPreciselyAndHistoryIsImmutable() throws Exception {
        var input = new HashMap<String, Object>();
        input.put("version", "0");
        input.put("gender", "FEMALE");
        for (String field : ProfileParameters.MEASUREMENTS)
            input.put(field, new BigDecimal("123.45"));
        var first = service.createMeasurement(USER, input);
        for (String field : ProfileParameters.MEASUREMENTS)
            assertThat(
                            (BigDecimal)
                                    first.getMeasurement()
                                            .getClass()
                                            .getMethod(
                                                    "get"
                                                            + Character.toUpperCase(field.charAt(0))
                                                            + field.substring(1))
                                            .invoke(first.getMeasurement()))
                    .isEqualByComparingTo("123.45");
        var second = service.createMeasurement(USER, Map.of("gender", "FEMALE", "version", "1"));
        assertThat(second.getMeasurement().getHeight()).isNull();
        assertThat(service.measurements(USER, "1", "1").getItems())
                .extracting(i -> i.getId())
                .containsExactly(second.getMeasurement().getId());
        assertThat(service.measurements(USER, "2", "1").getItems().getFirst().getCurrent())
                .isFalse();
        var switched =
                service.currentMeasurement(
                        USER,
                        Map.of("version", "2", "measurementId", first.getMeasurement().getId()));
        assertThat(switched.getCurrentMeasurement().getHeight()).isEqualByComparingTo("123.45");
        service.deleteMeasurement(USER, second.getMeasurement().getId(), Map.of("version", "3"));
        assertThat(service.get(USER).getCurrentMeasurementId())
                .isEqualTo(switched.getCurrentMeasurementId());
        service.deleteMeasurement(USER, first.getMeasurement().getId(), Map.of("version", "4"));
        assertThat(service.get(USER).getCurrentMeasurement().getHeight())
                .isEqualByComparingTo("123.45");
        assertThat(count("body_measurement")).isZero();
        assertThat(service.measurements(USER, "2147483647", "100").getItems()).isEmpty();
        error(() -> service.measurements(USER, "0", "100"), "INVALID_REQUEST");
        error(() -> service.measurements(USER, "1", "101"), "INVALID_REQUEST");
    }

    @Test
    void currentEditsKeepHistoryIndependentAndRespectVersionAndRollback() {
        var first =
                service.saveCurrentMeasurement(
                        USER, Map.of("version", "0", "gender", "FEMALE", "waist", 68));
        String currentId = first.getCurrentMeasurementId();
        assertThat(service.measurements(USER, null, null).getTotal()).isZero();
        var history =
                service.createMeasurement(
                        USER, Map.of("version", "1", "gender", "FEMALE", "waist", 68));
        String historyId = history.getMeasurement().getId();
        assertThat(historyId).isNotEqualTo(currentId);
        var edited =
                service.saveCurrentMeasurement(
                        USER, Map.of("version", "2", "gender", "MALE", "waist", 69));
        assertThat(edited.getCurrentMeasurementId()).isEqualTo(currentId);
        assertThat(edited.getCurrentMeasurement().getWaist()).isEqualByComparingTo("69");
        assertThat(service.measurements(USER, null, null).getItems().getFirst().getWaist())
                .isEqualByComparingTo("68");
        error(
                () ->
                        service.saveCurrentMeasurement(
                                USER, Map.of("version", "2", "gender", "FEMALE", "waist", 70)),
                "VERSION_CONFLICT");
        error(
                () -> service.deleteMeasurement(USER, currentId, Map.of("version", "3")),
                "MEASUREMENT_NOT_FOUND");
        error(
                () ->
                        service.currentMeasurement(
                                OTHER, Map.of("version", "0", "measurementId", currentId)),
                "MEASUREMENT_NOT_FOUND");
        doReturn(0).when(mapper).update(any());
        error(
                () ->
                        service.saveCurrentMeasurement(
                                USER, Map.of("version", "3", "gender", "FEMALE", "waist", 70)),
                "VERSION_CONFLICT");
        assertThat(service.get(USER).getCurrentMeasurement().getWaist()).isEqualByComparingTo("69");
        assertThat(service.get(USER).getGender()).isEqualTo("MALE");
        reset(mapper);
        service.currentMeasurement(USER, Map.of("version", "3", "measurementId", historyId));
        service.saveCurrentMeasurement(
                USER, Map.of("version", "4", "gender", "FEMALE", "waist", 71));
        assertThat(service.measurements(USER, null, null).getItems().getFirst().getWaist())
                .isEqualByComparingTo("68");
        service.currentMeasurement(USER, body("{\"version\":\"5\",\"measurementId\":null}"));
        assertThat(service.get(USER).getCurrentMeasurement()).isNull();
        assertThat(service.measurements(USER, null, null).getTotal()).isEqualTo(1);
        service.saveCurrentMeasurement(USER, Map.of("version", "6", "gender", "FEMALE"));
        assertThat(service.get(USER).getCurrentMeasurement().getWaist()).isNull();
        assertThat(service.measurements(USER, null, null).getTotal()).isEqualTo(1);
        service.deleteMeasurement(USER, historyId, Map.of("version", "7"));
        assertThat(service.get(USER).getCurrentMeasurement()).isNotNull();
    }

    @Test
    void strictMeasurementValuesAndCrossAccountAccess() {
        for (Object value :
                List.of(
                        "12",
                        false,
                        new BigDecimal("0"),
                        new BigDecimal("-1"),
                        new BigDecimal("10000"),
                        new BigDecimal("1.001")))
            error(
                    () ->
                            service.createMeasurement(
                                    USER,
                                    Map.of("gender", "FEMALE", "version", "0", "height", value)),
                    "VALIDATION_ERROR");
        var result =
                service.createMeasurement(
                        USER,
                        body(
                                "{\"gender\":\"MALE\",\"version\":\"0\",\"height\":9999.99,\"weight\":0.01}"));
        assertThat(result.getMeasurement().getHeight()).isEqualByComparingTo("9999.99");
        String id = result.getMeasurement().getId();
        error(
                () ->
                        service.currentMeasurement(
                                OTHER, Map.of("version", "0", "measurementId", id)),
                "MEASUREMENT_NOT_FOUND");
        error(
                () -> service.deleteMeasurement(OTHER, id, Map.of("version", "0")),
                "MEASUREMENT_NOT_FOUND");
        assertThat(service.measurements(OTHER, null, null).getItems()).isEmpty();
        error(() -> service.currentMeasurement(USER, Map.of("version", "1")), "VALIDATION_ERROR");
        service.currentMeasurement(USER, body("{\"version\":\"1\",\"measurementId\":null}"));
        assertThat(service.get(USER).getCurrentMeasurementId()).isNull();
        assertThat(count("body_measurement")).isEqualTo(1);
    }

    @Test
    void personalAttributesPartialPatchesAndPreferencesRoundTrip() {
        assertThat(service.get(USER).getGender()).isNull();
        assertThat(service.get(USER).getBirthDate()).isNull();
        assertThat(service.get(USER).getPreferences()).isNull();
        var basic =
                service.patch(
                        USER,
                        body(
                                "{\"version\":\"0\",\"gender\":\"MALE\",\"birthDate\":\"2000-02-29\"}"));
        assertThat(basic.getBirthDate()).isEqualTo("2000-02-29");
        var pref =
                service.preferences(
                        USER,
                        body(
                                "{\"version\":\"1\",\"interests\":[{\"type\":\"CUSTOM\",\"text\":\" 徒步 \"}],\"preferredColors\":[{\"type\":\"PRESET\",\"code\":\"BLUE\"}],\"outfitNote\":\"hello\"}"));
        assertThat(pref.getPreferences()).hasSize(13).containsEntry("outfitNote", "hello");
        assertThat(pref.getGender()).isEqualTo("MALE");
        assertThat(pref.getBirthDate()).isEqualTo("2000-02-29");
        error(
                () ->
                        service.preferences(
                                USER,
                                body(
                                        "{\"version\":\"2\",\"avoidedColors\":[{\"type\":\"CUSTOM\",\"text\":\"蓝\"}]}")),
                "VALIDATION_ERROR");
        assertThat(service.get(USER).getVersion()).isEqualTo("2");
        var cleared =
                service.preferences(
                        USER, body("{\"version\":\"2\",\"interests\":null,\"outfitNote\":null}"));
        assertThat(cleared.getPreferences())
                .containsEntry("interests", List.of())
                .containsEntry("outfitNote", null);
        assertThat((List<?>) cleared.getPreferences().get("preferredColors")).hasSize(1);
        assertThat(count("user_preference")).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT interests IS NULL FROM user_preference WHERE user_id=?",
                                Boolean.class,
                                USER))
                .isTrue();
        assertThat(service.get(OTHER).getPreferences()).isNull();
        var nullBasic =
                service.patch(USER, body("{\"version\":\"3\",\"gender\":null,\"birthDate\":null}"));
        assertThat(nullBasic.getGender()).isNull();
        assertThat(nullBasic.getBirthDate()).isNull();
    }

    @Test
    void emptyFirstPreferenceSaveAndLateRollback() {
        doReturn(0).when(mapper).update(any());
        error(
                () -> service.preferences(USER, body("{\"version\":\"0\",\"fits\":[]}")),
                "VERSION_CONFLICT");
        assertThat(count("user_preference")).isZero();
        assertThat(service.get(USER).getVersion()).isEqualTo("0");
        reset(mapper);
        var first = service.preferences(USER, body("{\"version\":\"0\",\"fits\":null}"));
        assertThat(first.getPreferences()).hasSize(13).containsEntry("fits", List.of());
        assertThat(first.getVersion()).isEqualTo("1");
        doReturn(0).when(mapper).update(any());
        error(
                () -> service.preferences(USER, body("{\"version\":\"1\",\"fits\":[\"SLIM\"]}")),
                "VERSION_CONFLICT");
        assertThat(service.get(USER).getPreferences()).containsEntry("fits", List.of());
    }

    @Test
    void measurementGenderAndLostResponseRetryAreAtomic() {
        error(() -> service.createMeasurement(USER, Map.of("version", "0")), "VALIDATION_ERROR");
        doReturn(0).when(mapper).update(any());
        error(
                () -> service.createMeasurement(USER, Map.of("version", "0", "gender", "MALE")),
                "VERSION_CONFLICT");
        assertThat(service.get(USER).getGender()).isNull();
        assertThat(count("body_measurement")).isZero();
        reset(mapper);
        var request = Map.<String, Object>of("version", "0", "gender", "FEMALE", "height", 160);
        service.createMeasurement(USER, request);
        error(() -> service.createMeasurement(USER, request), "VERSION_CONFLICT");
        assertThat(count("body_measurement")).isEqualTo(1);
        assertThat(service.get(USER).getGender()).isEqualTo("FEMALE");
        service.createMeasurement(USER, Map.of("version", "1", "gender", "FEMALE", "height", 160));
        assertThat(count("body_measurement")).isEqualTo(2);
    }

    @Test
    void concurrentFirstPreferenceSaveCreatesOneRow() throws Exception {
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var jobs = new ArrayList<Future<Boolean>>();
            for (int i = 0; i < 2; i++)
                jobs.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        service.preferences(
                                                USER,
                                                Map.of("version", "0", "fits", List.of("REGULAR")));
                                        return true;
                                    } catch (ApiException e) {
                                        assertThat(e.getCode()).isEqualTo("VERSION_CONFLICT");
                                        return false;
                                    }
                                }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int success = 0;
            for (var job : jobs) if (job.get(20, TimeUnit.SECONDS)) success++;
            assertThat(success).isEqualTo(1);
        }
        assertThat(count("user_preference")).isEqualTo(1);
        assertThat(service.get(USER).getVersion()).isEqualTo("1");
    }

    @Test
    void photosValidateFilesAndDefaultsClearOnDelete() {
        var portrait =
                service.createPhoto(USER, Map.of("fileId", "" + FILE, "photoType", "PORTRAIT"));
        assertThat(portrait.getFileId()).isEqualTo("9007199254780000");
        assertThat(service.get(USER).getVersion()).isEqualTo("0");
        var file = jdbc.queryForMap("SELECT status,expires_at FROM file_asset WHERE id=?", FILE);
        assertThat(file).containsEntry("status", "READY").containsEntry("expires_at", null);
        var full =
                service.createPhoto(
                        USER, Map.of("fileId", "" + (FILE + 1), "photoType", "FULL_BODY"));
        error(
                () ->
                        service.defaultPhotos(
                                USER, Map.of("version", "0", "portraitId", full.getId())),
                "VALIDATION_ERROR");
        var profile =
                service.defaultPhotos(
                        USER,
                        Map.of(
                                "version",
                                "0",
                                "portraitId",
                                portrait.getId(),
                                "fullBodyId",
                                full.getId()));
        assertThat(profile.getDefaultPortraitId()).isEqualTo(portrait.getId());
        profile = service.defaultPhotos(USER, body("{\"version\":\"1\",\"fullBodyId\":null}"));
        assertThat(profile.getDefaultPortraitId()).isEqualTo(portrait.getId());
        assertThat(profile.getDefaultFullBodyId()).isNull();
        assertThat(service.photos(USER, null, null, "PORTRAIT").getTotal()).isEqualTo(1);
        assertThat(service.photos(OTHER, null, null, null).getItems()).isEmpty();
        error(
                () ->
                        service.defaultPhotos(
                                OTHER, Map.of("version", "0", "portraitId", portrait.getId())),
                "PHOTO_NOT_FOUND");
        error(
                () -> service.deletePhoto(OTHER, portrait.getId(), Map.of("version", "0")),
                "PHOTO_NOT_FOUND");
        service.deletePhoto(USER, portrait.getId(), Map.of("version", "2"));
        assertThat(service.get(USER).getDefaultPortraitId()).isNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_after IS NOT NULL FROM file_asset WHERE id=?",
                                Boolean.class,
                                FILE))
                .isTrue();
        error(
                () ->
                        service.createPhoto(
                                USER, Map.of("fileId", "" + FILE, "photoType", "PORTRAIT")),
                "FILE_NOT_USABLE");
        error(
                () ->
                        service.createPhoto(
                                USER, Map.of("fileId", "" + (FILE + 4), "photoType", "PORTRAIT")),
                "FILE_NOT_FOUND");
        jdbc.update(
                "UPDATE file_asset SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                FILE + 2);
        error(
                () ->
                        service.createPhoto(
                                USER, Map.of("fileId", "" + (FILE + 2), "photoType", "REFERENCE")),
                "FILE_NOT_USABLE");
        jdbc.update("UPDATE file_asset SET size_bytes=0 WHERE id=?", FILE + 3);
        error(
                () ->
                        service.createPhoto(
                                USER, Map.of("fileId", "" + (FILE + 3), "photoType", "REFERENCE")),
                "FILE_NOT_USABLE");
    }

    @Test
    void savesRawPhotoWithUnknownDimensions() {
        jdbc.update("UPDATE file_asset SET width=NULL,height=NULL WHERE id=?", FILE);
        var photo = service.createPhoto(USER, Map.of("fileId", "" + FILE, "photoType", "PORTRAIT"));
        assertThat(photo.getFileId()).isEqualTo(Long.toString(FILE));
        assertThat(service.photos(USER, null, null, "PORTRAIT").getItems()).hasSize(1);
        assertThat(
                        jdbc.queryForMap(
                                "SELECT status,width,height,expires_at FROM file_asset WHERE id=?",
                                FILE))
                .containsEntry("status", "READY")
                .containsEntry("width", null)
                .containsEntry("height", null)
                .containsEntry("expires_at", null);
    }

    @Test
    void lateFailureRollsBackMeasurementAndPhotoDeletePreservesSnapshots() {
        doReturn(0).when(mapper).update(any());
        error(
                () ->
                        service.createMeasurement(
                                USER, Map.of("gender", "FEMALE", "version", "0", "height", 180)),
                "VERSION_CONFLICT");
        assertThat(count("body_measurement")).isZero();
        assertThat(service.get(USER).getVersion()).isEqualTo("0");
        reset(mapper);
        var photo = service.createPhoto(USER, Map.of("fileId", "" + FILE, "photoType", "PORTRAIT"));
        service.defaultPhotos(USER, Map.of("version", "0", "portraitId", photo.getId()));
        jdbc.update(
                "INSERT INTO design_task(id,user_id,client_request_id,design_type,status,request_hash,model_config_snapshot,input_snapshot,created_at,updated_at) VALUES(?,?,'profile-history','OUTFIT','FAILED',REPEAT('0',64),'{}','{\"height\":180}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                FILE,
                USER);
        jdbc.update(
                "INSERT INTO design_task_asset(user_id,task_id,asset_id,role,position,created_at,updated_at) VALUES(?,?,?,'PERSON',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                FILE,
                FILE);
        doReturn(0).when(mapper).update(any());
        error(
                () -> service.deletePhoto(USER, photo.getId(), Map.of("version", "1")),
                "VERSION_CONFLICT");
        assertThat(count("user_photo")).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_after IS NULL FROM file_asset WHERE id=?",
                                Boolean.class,
                                FILE))
                .isTrue();
        reset(mapper);
        service.deletePhoto(USER, photo.getId(), Map.of("version", "1"));
        assertThat(count("design_task_asset")).isEqualTo(1);
        var historical =
                service.createMeasurement(
                        USER, Map.of("gender", "FEMALE", "version", "2", "height", 180));
        var newest =
                service.createMeasurement(
                        USER, Map.of("gender", "FEMALE", "version", "3", "height", 181));
        service.currentMeasurement(
                USER, Map.of("version", "4", "measurementId", historical.getMeasurement().getId()));
        service.deleteMeasurement(
                USER, historical.getMeasurement().getId(), Map.of("version", "5"));
        assertThat(service.get(USER).getCurrentMeasurement().getHeight())
                .isEqualByComparingTo("180");
        service.saveCurrentMeasurement(
                USER, Map.of("version", "6", "gender", "FEMALE", "height", 182));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT JSON_EXTRACT(input_snapshot,'$.height') FROM design_task WHERE id=?",
                                String.class,
                                FILE))
                .isEqualTo("180");
    }

    @Test
    void cleanupKeepsOtherPhotosAndHistoricalAssets() throws Exception {
        when(storage.available()).thenReturn(true);
        var first = service.createPhoto(USER, Map.of("fileId", "" + FILE, "photoType", "PORTRAIT"));
        var second =
                service.createPhoto(USER, Map.of("fileId", "" + FILE, "photoType", "REFERENCE"));
        service.deletePhoto(USER, first.getId(), Map.of("version", "0"));
        fileService.cleanup();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status FROM file_asset WHERE id=?", String.class, FILE))
                .isEqualTo("READY");
        verify(storage, never()).delete(any(), any());
        jdbc.update(
                "INSERT INTO design_task(id,user_id,client_request_id,design_type,status,request_hash,model_config_snapshot,input_snapshot,created_at,updated_at) VALUES(?,?,'profile-cleanup','OUTFIT','FAILED',REPEAT('0',64),'{}','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                FILE,
                USER);
        jdbc.update(
                "INSERT INTO design_task_asset(user_id,task_id,asset_id,role,position,created_at,updated_at) VALUES(?,?,?,'PERSON',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                FILE,
                FILE);
        service.deletePhoto(USER, second.getId(), Map.of("version", "1"));
        fileService.cleanup();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status FROM file_asset WHERE id=?", String.class, FILE))
                .isEqualTo("READY");
        verify(storage, never()).delete(any(), any());
        jdbc.update("DELETE FROM design_task_asset WHERE user_id=?", USER);
        // Simulate the last task reference removal scheduling its now-unreferenced file.
        jdbc.update("UPDATE file_asset SET cleanup_after=UTC_TIMESTAMP(3) WHERE id=?", FILE);
        fileService.cleanup();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM file_asset WHERE id=?", Long.class, FILE))
                .isZero();
    }

    @Test
    void concurrentVersionsOnlyOneCommits() throws Exception {
        var ready = new CountDownLatch(4);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(4)) {
            var jobs = new ArrayList<Future<Boolean>>();
            for (int i = 0; i < 4; i++)
                jobs.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        service.createMeasurement(
                                                USER,
                                                Map.of(
                                                        "gender", "FEMALE", "version", "0",
                                                        "height", 180));
                                        return true;
                                    } catch (ApiException e) {
                                        assertThat(e.getCode()).isEqualTo("VERSION_CONFLICT");
                                        return false;
                                    }
                                }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int success = 0;
            for (var job : jobs) if (job.get(20, TimeUnit.SECONDS)) success++;
            assertThat(success).isEqualTo(1);
        }
        assertThat(count("body_measurement")).isEqualTo(1);
        assertThat(service.get(USER).getVersion()).isEqualTo("1");
    }

    @Test
    void httpExactDecimalTypesAndJsonShape() throws Exception {
        var mvc =
                org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(
                                webContext)
                        .build();
        var account =
                new cc.riskswap.lookmate.common.model.dto.AccountDto(
                        Long.toString(USER), "profile_test_1101", null);
        for (String raw :
                List.of(
                        "[]",
                        "null",
                        "true",
                        "{} {}",
                        "{\"version\":0}",
                        "{\"version\":\"0\",\"height\":true}",
                        "{\"version\":\"0\",\"height\":\"1\"}",
                        "{\"version\":\"0\",\"height\":1.00000000000000001}",
                        "{\"version\":\"0\",\"height\":9999.990000000000001}",
                        "{\"version\":\"0\",\"extra\":null}"))
            mvc.perform(
                            post("/api/profile/measurements")
                                    .requestAttr(
                                            cc.riskswap.lookmate.common.filter.AuthGuardFilter
                                                    .ACCOUNT,
                                            account)
                                    .contentType("application/json")
                                    .content(
                                            raw.startsWith("{\"version\":\"0\"")
                                                    ? raw.replace(
                                                            "{\"version\":",
                                                            "{\"gender\":\"FEMALE\",\"version\":")
                                                    : raw))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(
                        post("/api/profile/measurements")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account)
                                .contentType("application/json")
                                .content(
                                        "{\"gender\":\"FEMALE\",\"version\":\"0\",\"height\":170.12}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.profile.version").value("1"))
                .andExpect(jsonPath("$.data.measurement.height").value(170.12));
        mvc.perform(
                        patch("/api/profile/current-measurement")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account)
                                .contentType("application/json")
                                .content(
                                        "{\"gender\":\"FEMALE\",\"version\":\"1\",\"height\":171.25}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value("2"))
                .andExpect(jsonPath("$.data.currentMeasurement.height").value(171.25));
        mvc.perform(
                        patch("/api/profile/current-measurement")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account)
                                .contentType("application/json")
                                .content(
                                        "{\"gender\":\"FEMALE\",\"version\":\"2\",\"recordKind\":\"HISTORY\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(service.measurements(USER, null, null).getTotal()).isEqualTo(1);
        assertThat(service.measurements(USER, null, null).getItems().getFirst().getHeight())
                .isEqualByComparingTo("170.12");
    }
}
