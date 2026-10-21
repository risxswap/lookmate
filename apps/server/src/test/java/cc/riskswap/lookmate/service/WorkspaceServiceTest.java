package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.mapper.DesignQueryMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class WorkspaceServiceTest {
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(
            strings = {
                "0",
                "-1",
                "+1",
                "01",
                "1.0",
                "1e2",
                " 1",
                "9223372036854775808",
                "１２",
                "1 OR 1=1"
            })
    void rejectsInvalidIdsBeforeQuery(String id) {
        var mapper = mock(DesignQueryMapper.class);
        assertThatThrownBy(
                        () ->
                                new WorkspaceService(
                                                mapper,
                                                org.mockito.Mockito.mock(
                                                        cc.riskswap.lookmate.service
                                                                .GenerationService.class),
                                                org.mockito.Mockito.mock(
                                                        cc.riskswap.lookmate.dao.mapper
                                                                .GenerationMapper.class))
                                        .detail(1L, id))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error -> {
                            org.assertj.core.api.Assertions.assertThat(error.getStatus())
                                    .isEqualTo(400);
                            org.assertj.core.api.Assertions.assertThat(error.getCode())
                                    .isEqualTo("INVALID_REQUEST");
                        });
        verifyNoInteractions(mapper);
    }
}
