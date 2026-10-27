package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.mapper.ProfileMapper;
import cc.riskswap.lookmate.service.ProfileService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest(properties = "lookmate.jobs.enabled=false")
class ProfilePhotoSlotsIntegrationTest {
    private static final long USER = -1201, OTHER = -1202, FILE = 9007199254790000L;
    @Autowired ProfileService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.web.context.WebApplicationContext webContext;
    @Autowired cc.riskswap.lookmate.service.GenerationService generation;
    @MockitoSpyBean ProfileMapper mapper;

    @BeforeEach
    void setup() {
        clean();
        for (long user : new long[] {USER, OTHER})
            jdbc.update(
                    "INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    user,
                    "slots_test_" + -user);
        for (int i = 0; i < 12; i++)
            jdbc.update(
                    "INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,expires_at,created_at,updated_at) VALUES(?,?,'test',?,'TEMP','image/jpeg',100,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    FILE + i,
                    i == 11 ? OTHER : USER,
                    "slots/" + i);
    }

    @AfterEach
    void clean() {
        reset(mapper);
        for (String table : List.of("user_photo", "design_task_asset", "design_task", "file_asset"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)", USER, OTHER);
    }

    private Map<String, Object> input(String slot, int file) {
        return Map.of(
                "version",
                service.get(USER).getVersion(),
                "slot",
                slot,
                "fileId",
                Long.toString(FILE + file));
    }

    private void error(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }

    private Map<String, Object> angleInput(String angle, int file) {
        var body = new HashMap<>(input("SUPPLEMENT", file));
        body.put("angle", angle);
        return body;
    }

    @ParameterizedTest
    @CsvSource({
        "SUPPLEMENT,SIDE_FACE,angles.SIDE_FACE",
        "SUPPLEMENT,BACK_HEAD,angles.BACK_HEAD",
        "SUPPLEMENT,SIDE_BODY,angles.SIDE_BODY",
        "SUPPLEMENT,BACK_BODY,angles.BACK_BODY",
        "PORTRAIT,,portrait",
        "FULL_BODY,,fullBody"
    })
    void httpPhotoSlotsCreateAndReplaceEveryAngle(String slot, String angle, String path)
            throws Exception {
        var mvc =
                org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(
                                webContext)
                        .build();
        var account =
                new cc.riskswap.lookmate.common.model.dto.AccountDto(
                        Long.toString(USER), "slots_test_1201", null);
        jdbc.update("UPDATE `user` SET version=9 WHERE id=?", USER);
        String firstId = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            var body = new HashMap<>(input(slot, attempt));
            if (angle != null) body.put("angle", angle);
            if (angle != null && firstId != null) body.put("replacePhotoId", firstId);
            mvc.perform(
                            post("/api/photos/slots")
                                    .requestAttr(
                                            cc.riskswap.lookmate.common.filter.AuthGuardFilter
                                                    .ACCOUNT,
                                            account)
                                    .contentType("application/json")
                                    .content(
                                            new tools.jackson.databind.json.JsonMapper()
                                                    .writeValueAsString(body)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.version").value(Integer.toString(10 + attempt)));
            mvc.perform(
                            get("/api/photos/slots")
                                    .requestAttr(
                                            cc.riskswap.lookmate.common.filter.AuthGuardFilter
                                                    .ACCOUNT,
                                            account))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.total").value(1))
                    .andExpect(
                            jsonPath("$.data." + path + ".fileId")
                                    .value(Long.toString(FILE + attempt)))
                    .andExpect(
                            jsonPath("$.data." + path + ".photoType")
                                    .value(angle == null ? slot : "REFERENCE"));
            var slots = service.photoSlots(USER);
            var photo =
                    angle != null
                            ? slots.getAngles().get(angle)
                            : "PORTRAIT".equals(slot) ? slots.getPortrait() : slots.getFullBody();
            assertThat(photo.getAngle()).isEqualTo(angle);
            assertThat(photo.getId()).isNotEqualTo(firstId);
            firstId = photo.getId();
        }
    }

    @ParameterizedTest
    @CsvSource({
        "SUPPLEMENT,FRONT_FACE",
        "SUPPLEMENT,side_face",
        "PORTRAIT,SIDE_FACE",
        "FULL_BODY,BACK_BODY"
    })
    void httpPhotoSlotsRejectInvalidAngleWithoutWriting(String slot, String angle)
            throws Exception {
        var mvc =
                org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(
                                webContext)
                        .build();
        var body = new HashMap<>(input(slot, 0));
        body.put("angle", angle);
        mvc.perform(
                        post("/api/photos/slots")
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        new cc.riskswap.lookmate.common.model.dto.AccountDto(
                                                Long.toString(USER), "slots_test_1201", null))
                                .contentType("application/json")
                                .content(
                                        new tools.jackson.databind.json.JsonMapper()
                                                .writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(service.photoSlots(USER).getTotal()).isZero();
        assertThat(service.get(USER).getVersion()).isEqualTo("0");
    }

    @Test
    void fixedAnglesStayInPlaceAndKeepReferenceFilteringCompatible() {
        service.savePhotoSlot(USER, angleInput("SIDE_FACE", 0));
        service.savePhotoSlot(USER, angleInput("BACK_BODY", 1));
        var first = service.photoSlots(USER).getAngles().get("SIDE_FACE");
        assertThat(first.getAngle()).isEqualTo("SIDE_FACE");
        assertThat(first.getPhotoType()).isEqualTo("REFERENCE");
        assertThat(service.photoSlots(USER).getAngles().get("BACK_HEAD")).isNull();
        service.savePhotoSlot(USER, angleInput("SIDE_FACE", 2));
        var replaced = service.photoSlots(USER).getAngles().get("SIDE_FACE");
        assertThat(replaced.getId()).isNotEqualTo(first.getId());
        assertThat(replaced.getFileId()).isEqualTo(Long.toString(FILE + 2));
        assertThat(service.photoSlots(USER).getTotal()).isEqualTo(2);
        assertThat(service.photos(USER, "1", "1", "REFERENCE").getTotal()).isEqualTo(2);
        assertThat(service.photos(USER, "1", "1", "REFERENCE").getItems()).hasSize(1);
        var legacyReplace = new HashMap<>(input("SUPPLEMENT", 3));
        legacyReplace.put("replacePhotoId", replaced.getId());
        service.savePhotoSlot(USER, legacyReplace);
        assertThat(service.photoSlots(USER).getAngles().get("SIDE_FACE").getFileId())
                .isEqualTo(Long.toString(FILE + 3));
        assertThat(service.photoSlots(USER).getAngles().get("BACK_BODY").getFileId())
                .isEqualTo(Long.toString(FILE + 1));
    }

    @Test
    void legacyPhotosAreOnlyClassifiedByExplicitAssignmentWithPermissionAndVersionChecks() {
        var legacy =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE), "photoType", "REFERENCE"));
        var second =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE + 1), "photoType", "PORTRAIT"));
        assertThat(legacy.getAngle()).isNull();
        assertThat(service.photoSlots(USER).getAngles().values()).containsOnlyNulls();
        var assigned =
                service.assignPhotoAngle(
                        USER, legacy.getId(), Map.of("version", "0", "angle", "SIDE_FACE"));
        assertThat(assigned.getVersion()).isEqualTo("1");
        assertThat(service.photoSlots(USER).getAngles().get("SIDE_FACE").getId())
                .isEqualTo(legacy.getId());
        error(
                () ->
                        service.assignPhotoAngle(
                                USER, second.getId(), Map.of("version", "1", "angle", "SIDE_FACE")),
                "PHOTO_ANGLE_OCCUPIED");
        error(
                () ->
                        service.assignPhotoAngle(
                                USER, second.getId(), Map.of("version", "0", "angle", "SIDE_BODY")),
                "VERSION_CONFLICT");
        error(
                () ->
                        service.assignPhotoAngle(
                                OTHER,
                                legacy.getId(),
                                Map.of("version", "0", "angle", "SIDE_BODY")),
                "PHOTO_NOT_FOUND");
        error(
                () ->
                        service.assignPhotoAngle(
                                USER, second.getId(), Map.of("version", "1", "angle", "INVALID")),
                "VALIDATION_ERROR");
        service.savePhotoSlot(USER, input("PORTRAIT", 2));
        error(
                () ->
                        service.assignPhotoAngle(
                                USER,
                                service.get(USER).getDefaultPortraitId(),
                                Map.of("version", "2", "angle", "SIDE_BODY")),
                "VALIDATION_ERROR");
        var mismatch = angleInput("SIDE_FACE", 3);
        mismatch.put("replacePhotoId", second.getId());
        error(() -> service.savePhotoSlot(USER, mismatch), "VALIDATION_ERROR");
        assertThat(service.photo(USER, second.getId()).getAngle()).isNull();
        assertThat(service.get(USER).getVersion()).isEqualTo("2");
    }

    @ParameterizedTest
    @CsvSource({"REFERENCE,SIDE_BODY", "PORTRAIT,BACK_BODY", "FULL_BODY,SIDE_BODY"})
    void fullLibraryCanExplicitlyReplaceUnclassifiedPhoto(String legacyType, String angle) {
        service.savePhotoSlot(USER, input("PORTRAIT", 0));
        service.savePhotoSlot(USER, input("FULL_BODY", 1));
        service.savePhotoSlot(USER, angleInput("SIDE_FACE", 2));
        service.savePhotoSlot(USER, angleInput("BACK_HEAD", 3));
        var legacy =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE + 4), "photoType", legacyType));
        service.createPhoto(
                USER, Map.of("fileId", Long.toString(FILE + 5), "photoType", "REFERENCE"));
        error(() -> service.savePhotoSlot(USER, angleInput(angle, 6)), "PHOTO_LIMIT_REACHED");
        var body = angleInput(angle, 6);
        body.put("replacePhotoId", legacy.getId());
        service.savePhotoSlot(USER, body);
        var slots = service.photoSlots(USER);
        assertThat(slots.getTotal()).isEqualTo(6);
        assertThat(slots.getSupplementTotal()).isEqualTo(4);
        assertThat(slots.getAngles().get(angle).getFileId()).isEqualTo(Long.toString(FILE + 6));
        error(() -> service.photo(USER, legacy.getId()), "PHOTO_NOT_FOUND");
    }

    @Test
    void emptyAngleCannotReplaceClassifiedOrPrimaryOrForeignPhotoAndFailureKeepsLegacy() {
        service.savePhotoSlot(USER, input("PORTRAIT", 0));
        service.savePhotoSlot(USER, angleInput("SIDE_FACE", 1));
        var legacy =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE + 2), "photoType", "FULL_BODY"));
        var foreign =
                service.createPhoto(
                        OTHER,
                        Map.of("fileId", Long.toString(FILE + 11), "photoType", "REFERENCE"));
        var body = angleInput("SIDE_BODY", 3);
        body.put("replacePhotoId", service.get(USER).getDefaultPortraitId());
        error(() -> service.savePhotoSlot(USER, body), "VALIDATION_ERROR");
        body.put("replacePhotoId", service.photoSlots(USER).getAngles().get("SIDE_FACE").getId());
        error(() -> service.savePhotoSlot(USER, body), "VALIDATION_ERROR");
        body.put("replacePhotoId", foreign.getId());
        error(() -> service.savePhotoSlot(USER, body), "PHOTO_NOT_FOUND");
        body.put("replacePhotoId", legacy.getId());
        body.put("fileId", Long.toString(FILE + 11));
        error(() -> service.savePhotoSlot(USER, body), "FILE_NOT_FOUND");
        assertThat(service.photo(USER, legacy.getId()).getFileId())
                .isEqualTo(Long.toString(FILE + 2));
        assertThat(service.photoSlots(USER).getAngles().get("SIDE_BODY")).isNull();
        assertThat(service.get(USER).getVersion()).isEqualTo("2");
    }

    @Test
    void concurrentAngleAssignmentCannotCreateDuplicateSlots() throws Exception {
        var first =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE), "photoType", "REFERENCE"));
        var second =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE + 1), "photoType", "REFERENCE"));
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var results = new ArrayList<Future<Boolean>>();
            for (String id : List.of(first.getId(), second.getId()))
                results.add(
                        pool.submit(
                                () -> {
                                    start.await();
                                    try {
                                        service.assignPhotoAngle(
                                                USER,
                                                id,
                                                Map.of("version", "0", "angle", "BACK_HEAD"));
                                        return true;
                                    } catch (ApiException e) {
                                        assertThat(e.getCode()).isEqualTo("VERSION_CONFLICT");
                                        return false;
                                    }
                                }));
            start.countDown();
            assertThat(
                            (results.get(0).get(20, TimeUnit.SECONDS) ? 1 : 0)
                                    + (results.get(1).get(20, TimeUnit.SECONDS) ? 1 : 0))
                    .isEqualTo(1);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM user_photo WHERE user_id=? AND photo_type='BACK_HEAD'",
                                Long.class,
                                USER))
                .isEqualTo(1);
        assertThat(service.photoSlots(USER).getTotal()).isEqualTo(2);
    }

    @Test
    void mainPhotosAndFourSupplementsAreBoundedAcrossBothCreationEndpoints() {
        service.savePhotoSlot(USER, input("PORTRAIT", 0));
        service.savePhotoSlot(USER, input("FULL_BODY", 1));
        for (int i = 2; i < 6; i++) service.savePhotoSlot(USER, input("SUPPLEMENT", i));
        var slots = service.photoSlots(USER);
        assertThat(slots.getPortrait()).isNotNull();
        assertThat(slots.getFullBody()).isNotNull();
        assertThat(slots.getSupplements()).hasSize(4);
        assertThat(slots.getSupplementTotal()).isEqualTo(4);
        assertThat(slots.getTotal()).isEqualTo(6);
        error(() -> service.savePhotoSlot(USER, input("SUPPLEMENT", 6)), "PHOTO_LIMIT_REACHED");
        error(
                () ->
                        service.createPhoto(
                                USER,
                                Map.of("fileId", Long.toString(FILE + 6), "photoType", "PORTRAIT")),
                "PHOTO_LIMIT_REACHED");
        Map<String, Object> clear = new HashMap<>();
        clear.put("version", "6");
        clear.put("portraitId", null);
        error(() -> service.defaultPhotos(USER, clear), "PHOTO_LIMIT_REACHED");
        assertThat(service.get(USER).getVersion()).isEqualTo("6");
    }

    @Test
    void replacementCreatesNewRecordRetainsHistoryAndRollsBackOnLateFailure() {
        service.savePhotoSlot(USER, input("PORTRAIT", 0));
        String old = service.get(USER).getDefaultPortraitId();
        jdbc.update(
                "INSERT INTO design_task(id,user_id,client_request_id,design_type,status,request_hash,model_config_snapshot,input_snapshot,created_at,updated_at) VALUES(?,?,'slots-history','OUTFIT','FAILED',REPEAT('0',64),'{}','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                FILE,
                USER);
        jdbc.update(
                "INSERT INTO design_task_asset(user_id,task_id,asset_id,role,position,created_at,updated_at) VALUES(?,?,?,'PERSON',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                FILE,
                FILE);
        doReturn(0).when(mapper).update(any());
        error(() -> service.savePhotoSlot(USER, input("PORTRAIT", 1)), "VERSION_CONFLICT");
        assertThat(service.get(USER).getDefaultPortraitId()).isEqualTo(old);
        assertThat(service.photoSlots(USER).getTotal()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status FROM file_asset WHERE id=?", String.class, FILE + 1))
                .isEqualTo("TEMP");
        reset(mapper);
        service.savePhotoSlot(USER, input("PORTRAIT", 1));
        assertThat(service.get(USER).getDefaultPortraitId()).isNotEqualTo(old);
        assertThat(generation.usable(USER, FILE, false).getCleanupAfter()).isNull();
        error(() -> service.photo(USER, old), "PHOTO_NOT_FOUND");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM design_task_asset WHERE user_id=? AND asset_id=?",
                                Long.class,
                                USER,
                                FILE))
                .isEqualTo(1);
    }

    @Test
    void sharedPhotoFileRemainsUsableAfterReplacingAndDeletingAnotherPhoto() {
        service.savePhotoSlot(USER, input("PORTRAIT", 0));
        var shared =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE), "photoType", "REFERENCE"));
        service.savePhotoSlot(USER, input("PORTRAIT", 1));
        assertThat(generation.usable(USER, FILE, false).getCleanupAfter()).isNull();
        var duplicate =
                service.createPhoto(
                        USER, Map.of("fileId", Long.toString(FILE), "photoType", "REFERENCE"));
        service.deletePhoto(
                USER, duplicate.getId(), Map.of("version", service.get(USER).getVersion()));
        assertThat(generation.usable(USER, FILE, false).getCleanupAfter()).isNull();
        service.deletePhoto(
                USER, shared.getId(), Map.of("version", service.get(USER).getVersion()));
        error(() -> generation.usable(USER, FILE, false), "FILE_NOT_USABLE");
    }

    @Test
    void ownershipVersionAndUnknownRetryCannotDuplicateWrites() {
        var request = input("PORTRAIT", 0);
        service.savePhotoSlot(USER, request);
        error(() -> service.savePhotoSlot(USER, request), "VERSION_CONFLICT");
        error(() -> service.savePhotoSlot(USER, input("SUPPLEMENT", 11)), "FILE_NOT_FOUND");
        var invalid = new HashMap<>(input("SUPPLEMENT", 1));
        invalid.put("replacePhotoId", service.get(USER).getDefaultPortraitId());
        error(() -> service.savePhotoSlot(USER, invalid), "VALIDATION_ERROR");
        service.savePhotoSlot(
                OTHER,
                Map.of("version", "0", "slot", "SUPPLEMENT", "fileId", Long.toString(FILE + 11)));
        invalid.put(
                "replacePhotoId", service.photoSlots(OTHER).getSupplements().getFirst().getId());
        error(() -> service.savePhotoSlot(USER, invalid), "PHOTO_NOT_FOUND");
        invalid.remove("replacePhotoId");
        invalid.put("extra", true);
        error(() -> service.savePhotoSlot(USER, invalid), "VALIDATION_ERROR");
        assertThat(service.photoSlots(USER).getTotal()).isEqualTo(1);
    }

    @Test
    void legacyOverflowIsVisibleAndCanBeReplacedWithoutGrowing() {
        for (int i = 0; i < 8; i++)
            jdbc.update(
                    "INSERT INTO user_photo(user_id,asset_id,photo_type,created_at,updated_at) VALUES(?,?,'REFERENCE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    USER,
                    FILE + i);
        var slots = service.photoSlots(USER);
        assertThat(slots.getSupplements()).hasSize(4);
        assertThat(slots.getSupplementTotal()).isEqualTo(8);
        assertThat(service.photos(USER, "2", "3", null).getItems()).hasSize(3);
        error(() -> service.savePhotoSlot(USER, input("SUPPLEMENT", 8)), "PHOTO_LIMIT_REACHED");
        var replacement = new HashMap<>(input("SUPPLEMENT", 8));
        replacement.put("replacePhotoId", slots.getSupplements().getFirst().getId());
        service.savePhotoSlot(USER, replacement);
        assertThat(service.photoSlots(USER).getTotal()).isEqualTo(8);
        assertThat(service.photoSlots(USER).getSupplements().getFirst().getFileId())
                .isEqualTo(Long.toString(FILE + 8));
    }

    @Test
    void concurrentLegacyAndSlotCreationCannotExceedSupplementCapacity() throws Exception {
        for (int i = 0; i < 3; i++)
            service.createPhoto(
                    USER, Map.of("fileId", Long.toString(FILE + i), "photoType", "REFERENCE"));
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a =
                    pool.submit(
                            () -> {
                                start.await();
                                try {
                                    service.createPhoto(
                                            USER,
                                            Map.of(
                                                    "fileId",
                                                    Long.toString(FILE + 3),
                                                    "photoType",
                                                    "REFERENCE"));
                                    return true;
                                } catch (ApiException e) {
                                    assertThat(e.getCode()).isEqualTo("PHOTO_LIMIT_REACHED");
                                    return false;
                                }
                            });
            var b =
                    pool.submit(
                            () -> {
                                start.await();
                                try {
                                    service.savePhotoSlot(
                                            USER,
                                            Map.of(
                                                    "version",
                                                    "0",
                                                    "slot",
                                                    "SUPPLEMENT",
                                                    "fileId",
                                                    Long.toString(FILE + 4)));
                                    return true;
                                } catch (ApiException e) {
                                    assertThat(e.getCode()).isEqualTo("PHOTO_LIMIT_REACHED");
                                    return false;
                                }
                            });
            start.countDown();
            assertThat(
                            (a.get(20, TimeUnit.SECONDS) ? 1 : 0)
                                    + (b.get(20, TimeUnit.SECONDS) ? 1 : 0))
                    .isEqualTo(1);
        }
        assertThat(service.photoSlots(USER).getSupplementTotal()).isEqualTo(4);
    }
}
