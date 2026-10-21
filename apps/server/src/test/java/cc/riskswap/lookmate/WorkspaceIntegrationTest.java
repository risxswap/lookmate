package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.dto.TaskSummaryDto;
import cc.riskswap.lookmate.service.WorkspaceService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@EnabledIfEnvironmentVariable(named = "LOOKMATE_INTEGRATION", matches = "true")
@SpringBootTest
@Transactional
class WorkspaceIntegrationTest {
    private static final long OWNER = -701L;
    private static final long OTHER = -702L;
    private static final long BASE = 9007199254741000L;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkspaceService workspace;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private org.mybatis.spring.SqlSessionTemplate sqlSession;

    @Test
    void emptyAccountHasNoTask() {
        var result = workspace.workspace(OWNER);
        assertThat(result.getActiveTask()).isNull();
        assertThat(result.getRecentTasks()).isEmpty();
    }

    @Test
    void filtersStatesOwnershipAndHiddenRowsWithStableLimits() {
        List<String> active = List.of("QUEUED", "PLANNING", "GENERATING", "SAVING");
        for (int i = 0; i < active.size(); i++) {
            task(BASE + i, OWNER, active.get(i), false);
            assertThat(workspace.workspace(OWNER).getActiveTask().getStatus())
                    .isEqualTo(active.get(i));
        }
        List<String> terminal = List.of("SUCCEEDED", "FAILED", "UNKNOWN");
        for (int i = 10; i < 18; i++) task(BASE + i, OWNER, terminal.get(i % 3), false);
        task(BASE + 30, OWNER, "SAVING", true);
        task(BASE + 31, OWNER, "SUCCEEDED", true);
        task(BASE + 32, OTHER, "SAVING", false);
        task(BASE + 33, OTHER, "SUCCEEDED", false);
        var result = workspace.workspace(OWNER);
        assertThat(result.getActiveTask().getId()).isEqualTo(Long.toString(BASE + 3));
        assertThat(result.getRecentTasks())
                .extracting(TaskSummaryDto::getId)
                .containsExactly(
                        Long.toString(BASE + 17),
                        Long.toString(BASE + 16),
                        Long.toString(BASE + 15),
                        Long.toString(BASE + 14),
                        Long.toString(BASE + 13),
                        Long.toString(BASE + 12));
        assertThat(result.getRecentTasks())
                .extracting(TaskSummaryDto::getStatus)
                .containsAll(terminal);
        jdbc.update(
                "UPDATE design_task SET created_at = '2027-01-01 00:00:00' WHERE id = ?",
                BASE + 10);
        sqlSession.clearCache();
        assertThat(workspace.workspace(OWNER).getRecentTasks().getFirst().getId())
                .isEqualTo(Long.toString(BASE + 10));
    }

    @Test
    void detailKeepsSnapshotTextIdsUtcAndExplicitPublicFields() throws Exception {
        task(BASE, OWNER, "SAVING", false);
        result(BASE, BASE, OWNER);
        item(BASE + 2, OWNER, BASE, 2, "后项");
        item(BASE + 1, OWNER, BASE, 1, "首项");
        item(BASE + 3, OWNER, BASE, 2, "同序后项");
        item(BASE + 4, OTHER, BASE, 0, "他人单品");
        jdbc.update(
                """
                INSERT INTO design_result_hairstyle
                (id, user_id, result_id, hairstyle_name, length_advice, bangs_advice, parting_advice,
                texture_advice, hair_color_advice, care_advice, created_at, updated_at)
                VALUES (?, ?, ?, '发型', '长度', '刘海', '分缝', '卷直', '发色', '打理', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
                """,
                BASE,
                OWNER,
                BASE);
        var detail = workspace.detail(OWNER, Long.toString(BASE));
        assertThat(detail.getId()).isEqualTo("9007199254741000");
        assertThat(detail.getCreatedAt()).isEqualTo("2026-10-20T01:02:03.123Z");
        assertThat(detail.getActions()).containsExactly("VIEW");
        assertThat(detail.getStatus()).isEqualTo("SAVING");
        assertThat(detail.getResult().getDesignReason()).isEqualTo("设计理由");
        assertThat(detail.getResult().getHairstyle().getCareAdvice()).isEqualTo("打理");
        assertThat(detail.getResult().getItems())
                .extracting(i -> i.getDressName())
                .containsExactly("首项", "后项", "同序后项");
        assertThat(detail.getResult().getItems().getFirst().getDressId())
                .isEqualTo(Long.toString(BASE + 1));
        String body = json.writeValueAsString(detail);
        assertThat(body)
                .doesNotContain(
                        "PRIVATE_SENTINEL", "inputSnapshot", "imagePrompt", "userId", "leaseUntil");
        assertThat(json.readTree(body).propertyNames())
                .containsExactlyInAnyOrder(
                        "id",
                        "designType",
                        "status",
                        "createdAt",
                        "updatedAt",
                        "title",
                        "summary",
                        "errorCode",
                        "errorMessage",
                        "actions",
                        "result",
                        "resultId",
                        "favoriteId");
        jdbc.update("UPDATE design_result_hairstyle SET user_id = ? WHERE id = ?", OTHER, BASE);
        sqlSession.clearCache();
        assertThat(workspace.detail(OWNER, Long.toString(BASE)).getResult().getHairstyle())
                .isNull();
    }

    @Test
    void inaccessibleRecordsAreIndistinguishableAndForeignResultsAreExcluded() {
        task(BASE, OWNER, "FAILED", false);
        task(BASE + 1, OWNER, "UNKNOWN", true);
        task(BASE + 2, OTHER, "SUCCEEDED", false);
        result(BASE, BASE, OTHER);
        assertThat(workspace.detail(OWNER, Long.toString(BASE)).getResult()).isNull();
        assertThat(workspace.workspace(OWNER).getRecentTasks().getFirst().getTitle()).isNull();
        assertThat(workspace.detail(OWNER, Long.toString(BASE)).getErrorMessage())
                .isEqualTo("安全提示");
        for (long id : new long[] {BASE + 1, BASE + 2, Long.MAX_VALUE}) {
            assertThatThrownBy(() -> workspace.detail(OWNER, Long.toString(id)))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            error -> {
                                assertThat(error.getStatus()).isEqualTo(404);
                                assertThat(error.getCode()).isEqualTo("DESIGN_NOT_FOUND");
                            });
        }
    }

    private void task(long id, long user, String state, boolean hidden) {
        jdbc.update(
                """
                INSERT INTO design_task (id,user_id,design_type,status,client_request_id,request_hash,input_snapshot,
                model_config_snapshot,result_url_ciphertext,attempt_token,hidden_at,error_code,error_message,created_at,updated_at)
                VALUES (?,?,'OUTFIT',?,?,REPEAT('a',64),'{"secret":"PRIVATE_SENTINEL"}','{}',
                'PRIVATE_SENTINEL','PRIVATE_SENTINEL',?,'SAFE_ERROR','安全提示','2026-10-20 01:02:03.123','2026-10-20 01:02:03.123')
                """,
                id,
                user,
                state,
                Long.toString(id),
                hidden ? "2026-10-20 02:00:00" : null);
        // JDBC fixtures bypass MyBatis; invalidate its transaction-local read cache.
        sqlSession.clearCache();
    }

    private void result(long id, long task, long user) {
        jdbc.update(
                """
                INSERT INTO design_result (id,user_id,task_id,title,summary,style,occasion,design_reason,image_prompt,
                plan_provenance,created_at,updated_at) VALUES (?,?,?,'标题','概述','风格','场景','设计理由',
                'PRIVATE_SENTINEL','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
                """,
                id,
                user,
                task);
    }

    private void item(long id, long user, long result, int order, String name) {
        jdbc.update(
                """
                INSERT INTO design_result_item (id,user_id,result_id,dress_id,dress_name,category_name,match_reason,
                wearing_method,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,'上衣','搭配理由','穿法',?,
                UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
                """,
                id,
                user,
                result,
                id,
                name,
                order);
    }
}
