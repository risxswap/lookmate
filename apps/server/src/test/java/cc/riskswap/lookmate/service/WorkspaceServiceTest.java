package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.mapper.DesignQueryMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class WorkspaceServiceTest {
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"0", "-1", "+1", "01", "1.0", "1e2", " 1", "9223372036854775808", "１２", "1 OR 1=1"})
    void rejectsInvalidIdsBeforeQuery(String id) {
        var mapper = mock(DesignQueryMapper.class);
        assertThatThrownBy(() -> new WorkspaceService(mapper).detail(1L, id))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    org.assertj.core.api.Assertions.assertThat(error.getStatus()).isEqualTo(400);
                    org.assertj.core.api.Assertions.assertThat(error.getCode()).isEqualTo("INVALID_REQUEST");
                });
        verifyNoInteractions(mapper);
    }
}
