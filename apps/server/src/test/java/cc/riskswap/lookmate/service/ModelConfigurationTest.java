package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.config.*;
import cc.riskswap.lookmate.dao.entity.GenerationTaskRow;
import cc.riskswap.lookmate.dao.mapper.*;
import cc.riskswap.lookmate.integration.storage.ObjectStorage;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

class ModelConfigurationTest {
    private GenerationService service(GenerationProperties p) {
        return new GenerationService(
                null,
                null,
                null,
                null,
                null,
                p,
                new AssetProperties(),
                mock(ObjectStorage.class),
                null,
                JsonMapper.builder().build(),
                mock(PlatformTransactionManager.class));
    }

    @Test
    void textEvaluationDoesNotRequireImageProviderConfiguration() {
        var p = new GenerationProperties();
        p.setEnabled(true);
        p.setBudgetsVerified(true);
        p.setPlanApiKey("plan");
        p.setPlanningMaxImages(10);
        p.setMaxInputBytes(100000);
        p.setMaxTextChars(10000);
        p.setImageProvider("");
        p.setImageProtocol("unsupported");
        p.setImageEndpoint("");
        var storage = mock(ObjectStorage.class);
        when(storage.available()).thenReturn(true);
        var service =
                new GenerationService(
                        null,
                        null,
                        null,
                        null,
                        null,
                        p,
                        new AssetProperties(),
                        storage,
                        null,
                        JsonMapper.builder().build(),
                        mock(PlatformTransactionManager.class));
        assertThatCode(() -> service.requireAvailable(true)).doesNotThrowAnyException();
        assertThat(service.credentials(service.configuration(), true))
                .containsEntry("planApiKey", "plan")
                .doesNotContainKey("imageApiKey");
        assertThatThrownBy(() -> service.requireAvailable(false)).hasMessage("设计生成尚未配置或暂不可用");
        p.setPlanProtocol("unsupported");
        assertThatThrownBy(() -> service.requireAvailable(true)).hasMessage("设计生成尚未配置或暂不可用");
    }

    @Test
    void oldSnapshotsKeepMultipartAndNeverReceiveNewEndpointCredentials() {
        var p = new GenerationProperties();
        p.setPlanApiKey("new-plan-key");
        p.setImageApiKey("new-image-key");
        var service = service(p);
        var saved = new HashMap<String, Object>();
        saved.put("planEndpoint", "https://old.example/chat");
        saved.put("planModel", p.getPlanModel());
        saved.put("imageEndpoint", "https://old.example/edits");
        saved.put("imageModel", p.getImageModel());
        assertThatThrownBy(() -> service.credentials(saved)).hasMessage("原模型配置凭据不可用");
        p.getPlanCredentials()
                .put(saved.get("planEndpoint") + "|" + p.getPlanModel(), "old-plan-key");
        p.getImageCredentials()
                .put(saved.get("imageEndpoint") + "|" + p.getImageModel(), "old-image-key");
        var resolved = service.credentials(saved);
        assertThat(resolved)
                .containsEntry("imageProtocol", "openai-edits")
                .containsEntry("planProtocol", "openai-chat")
                .containsEntry("planApiKey", "old-plan-key")
                .containsEntry("imageApiKey", "old-image-key");
        assertThat(saved).doesNotContainKeys("planApiKey", "imageApiKey", "imageProtocol");
    }

    @Test
    void newSnapshotHasProtocolsAndEffectiveSingleImageBudgetWithoutSecrets() {
        var p = new GenerationProperties();
        p.setImageMaxImages(10);
        p.setImageApiKey("secret");
        var service = service(p);
        assertThat(service.configuration())
                .containsEntry("imageProtocol", "siliconflow-images")
                .containsEntry("imageProvider", "siliconflow")
                .containsEntry("imageMaxImages", 1)
                .doesNotContainKeys("planApiKey", "imageApiKey");
        p.setImageProtocol("openai-edits");
        assertThat(service.budgets()).containsEntry("imageMaxImages", 10);
    }

    @Test
    void recognitionSnapshotChangesWithEndpointAndProtocolAndExcludesKey() {
        var p = new RecognitionProperties();
        p.setEnabled(true);
        p.setApiKey("private-value");
        var storage = mock(ObjectStorage.class);
        when(storage.available()).thenReturn(true);
        var availability = new RecognitionAvailability(p, storage, JsonMapper.builder().build());
        assertThat(availability.available()).isTrue();
        String before = availability.configSnapshot();
        assertThat(before).contains("siliconflow", "openai-chat").doesNotContain("private-value");
        p.setEndpoint("https://alternate.example/chat");
        assertThat(availability.configSnapshot()).isNotEqualTo(before);
        p.setProtocol("unsupported");
        assertThat(availability.available()).isFalse();
    }

    @Test
    void singleReferenceProviderRejectsOutfitBeforeDatabaseOrModelAccess() {
        var p = new GenerationProperties();
        p.setEnabled(true);
        p.setBudgetsVerified(true);
        p.setPreviewSecret("x".repeat(32));
        p.setPlanApiKey("plan");
        p.setImageApiKey("image");
        p.setPlanningMaxImages(10);
        p.setImageMaxImages(10);
        p.setMaxInputBytes(100000);
        p.setMaxTextChars(10000);
        var storage = mock(ObjectStorage.class);
        when(storage.available()).thenReturn(true);
        var tasks = mock(GenerationMapper.class);
        var profiles = mock(ProfileMapper.class);
        var engine = mock(GenerationEngine.class);
        var service =
                new GenerationService(
                        tasks,
                        profiles,
                        null,
                        null,
                        null,
                        p,
                        new AssetProperties(),
                        storage,
                        engine,
                        JsonMapper.builder().build(),
                        mock(PlatformTransactionManager.class));
        for (String type : List.of("OUTFIT", "OVERALL")) {
            var input =
                    Map.<String, Object>of(
                            "designType", type, "personFileId", "1", "profileVersion", "1");
            assertThatThrownBy(() -> service.preview(1L, input))
                    .hasMessage("当前生图协议仅支持一张参考图，无法同时保留本人和衣物图片");
            assertThatThrownBy(
                            () ->
                                    service.submit(
                                            1L,
                                            UUID.randomUUID().toString(),
                                            Map.of("input", input)))
                    .hasMessage("当前生图协议仅支持一张参考图，无法同时保留本人和衣物图片");
            var old = new GenerationTaskRow();
            old.setStatus("FAILED");
            old.setInputSnapshot(
                    JsonMapper.builder()
                            .build()
                            .writeValueAsString(
                                    Map.of("schemaVersion", 2, "normalizedRequest", input)));
            when(tasks.lock(1L, 1L)).thenReturn(old);
            when(tasks.result(1L, 1L)).thenReturn(Map.of("prompt", "original"));
            when(tasks.assets(1L, 1L)).thenReturn(List.of());
            for (String mode : List.of("FULL", "IMAGE_ONLY")) {
                assertThatThrownBy(
                                () ->
                                        service.retry(
                                                1L,
                                                "1",
                                                UUID.randomUUID().toString(),
                                                Map.of("mode", mode)))
                        .hasMessage("当前生图协议仅支持一张参考图，无法同时保留本人和衣物图片");
            }
        }
        verifyNoInteractions(engine);
        verify(tasks, never()).insert(any());
    }
}
