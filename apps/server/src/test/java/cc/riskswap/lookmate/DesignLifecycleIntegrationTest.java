package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.service.DesignLifecycleService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(
        named = "LOOKMATE_INTEGRATION",
        matches = "true")
class DesignLifecycleIntegrationTest extends GenerationIntegrationTest {
    @Autowired DesignLifecycleService lifecycle;
    @Autowired org.springframework.web.context.WebApplicationContext webContext;

    @Override
    void clean() {
        for (String table :
                java.util.List.of(
                        "favorite_folder_item", "design_favorite", "favorite_folder", "outfit"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id IN (?,?)", USER, OTHER);
        super.clean();
    }

    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    cc.riskswap.lookmate.dao.mapper.DesignLifecycleMapper lifecycleMapper;

    @Autowired cc.riskswap.lookmate.dao.mapper.FileMapper files;

    @Test
    void deletionRollsBackAndRetainsIndependentReferences() {
        long id = task(submit(UUID.randomUUID().toString()));
        run(id);
        Long result =
                jdbc.queryForObject("SELECT id FROM design_result WHERE task_id=?", Long.class, id);
        jdbc.update(
                "INSERT INTO design_favorite(user_id,result_id,created_at,updated_at) VALUES(?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                result);
        jdbc.update(
                "INSERT INTO favorite_folder(user_id,name,created_at,updated_at) VALUES(?,'folder',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER);
        jdbc.update(
                "INSERT INTO favorite_folder_item(user_id,favorite_folder_id,design_favorite_id,created_at,updated_at) SELECT ?,fo.id,fa.id,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM favorite_folder fo JOIN design_favorite fa ON fo.user_id=fa.user_id WHERE fa.result_id=?",
                USER,
                result);
        Long output = Long.valueOf(workspace.detail(USER, "" + id).getOutputFileId());
        jdbc.update(
                "INSERT INTO outfit(user_id,name,source_design_id,source_output_file_id,created_at,updated_at) VALUES(?,'kept',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                USER,
                id,
                output);
        org.mockito.Mockito.doThrow(new IllegalStateException("injected rollback"))
                .when(lifecycleMapper)
                .task(USER, id);
        try {
            assertThatThrownBy(() -> lifecycle.remove(USER, "" + id, false))
                    .hasMessageContaining("injected");
            assertThat(mapper.get(USER, id)).isNotNull();
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT COUNT(*) FROM design_favorite WHERE result_id=?",
                                    Integer.class,
                                    result))
                    .isEqualTo(1);
        } finally {
            org.mockito.Mockito.reset(lifecycleMapper);
        }
        lifecycle.remove(USER, "" + id, false);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM design_favorite WHERE result_id=?",
                                Integer.class,
                                result))
                .isZero();
        assertThat(files.directReferences(output)).isPositive();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM favorite_folder_item WHERE user_id=?",
                                Integer.class,
                                USER))
                .isZero();
        jdbc.update("DELETE FROM outfit WHERE user_id=?", USER);
    }

    @Test
    void deleteProtectsStateAndOwnershipAndPreservesFiles() {
        long id = task(submit(UUID.randomUUID().toString()));
        assertThatThrownBy(() -> lifecycle.remove(OTHER, "" + id, false))
                .hasMessageContaining("不存在");
        assertThatThrownBy(() -> lifecycle.remove(USER, "" + id, false))
                .hasMessageContaining("当前状态");
        jdbc.update("UPDATE design_task SET status='FAILED' WHERE id=?", id);
        lifecycle.remove(USER, "" + id, false);
        assertThat(mapper.get(USER, id)).isNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM design_task_asset WHERE task_id=?",
                                Integer.class,
                                id))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM file_asset WHERE id=?", Integer.class, FILE))
                .isEqualTo(1);
    }

    @Test
    void hidingKeepsDeadlineAndPurgesOnlyAfterExpiry() {
        long id = task(submit(UUID.randomUUID().toString()));
        jdbc.update("UPDATE design_task SET status='UNKNOWN' WHERE id=?", id);
        lifecycle.remove(USER, "" + id, true);
        var deadline =
                jdbc.queryForObject(
                        "SELECT purge_after FROM design_task WHERE id=?",
                        java.sql.Timestamp.class,
                        id);
        lifecycle.remove(USER, "" + id, true);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT purge_after FROM design_task WHERE id=?",
                                java.sql.Timestamp.class,
                                id))
                .isEqualTo(deadline);
        assertThatThrownBy(() -> workspace.detail(USER, "" + id));
        lifecycle.cleanup();
        assertThat(mapper.get(USER, id)).isNotNull();
        jdbc.update(
                "UPDATE design_task SET purge_after=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
                id);
        lifecycle.cleanup();
        assertThat(mapper.get(USER, id)).isNull();
    }

    @Test
    void confirmedHiddenTaskPurgesAndRetryRetainsItsSnapshot() {
        long id = task(submit(UUID.randomUUID().toString()));
        jdbc.update("UPDATE design_task SET status='FAILED' WHERE id=?", id);
        mapper.release(USER, id);
        long retry =
                task(
                        service.retry(
                                USER,
                                "" + id,
                                UUID.randomUUID().toString(),
                                java.util.Map.of("mode", "FULL")));
        var snapshot = mapper.get(USER, retry).getInputSnapshot();
        long assetCount =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM design_task_asset WHERE task_id=?",
                        Long.class,
                        retry);
        jdbc.update("UPDATE design_task SET status='UNKNOWN' WHERE id=?", id);
        lifecycle.remove(USER, "" + id, true);
        jdbc.update("UPDATE design_task SET status='FAILED' WHERE id=?", id);
        lifecycle.cleanup();
        assertThat(mapper.get(USER, id)).isNull();
        assertThat(mapper.get(USER, retry).getInputSnapshot()).isEqualTo(snapshot);
        assertThat(mapper.get(USER, retry).getRetrySourceId()).isEqualTo(id);
        assertThat(mapper.get(USER, retry).getRetryOfTaskId()).isNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM design_task_asset WHERE task_id=?",
                                Long.class,
                                retry))
                .isEqualTo(assetCount);
    }

    @Test
    void mvcReturnsLifecycleContract() throws Exception {
        var mvc =
                org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(
                                webContext)
                        .build();
        var account = new cc.riskswap.lookmate.common.model.dto.AccountDto("" + USER, "test", null);
        long id = task(submit(UUID.randomUUID().toString()));
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/designs/" + id)
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isConflict());
        jdbc.update("UPDATE design_task SET status='FAILED' WHERE id=?", id);
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/designs/" + id)
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isOk())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                                        "$.data")
                                .doesNotExist());
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/designs/" + id)
                                .requestAttr(
                                        cc.riskswap.lookmate.common.filter.AuthGuardFilter.ACCOUNT,
                                        account))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isNotFound());
    }
}
