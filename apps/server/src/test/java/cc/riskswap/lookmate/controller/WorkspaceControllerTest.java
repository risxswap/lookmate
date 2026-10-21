package cc.riskswap.lookmate.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cc.riskswap.lookmate.common.advice.ApiExceptionHandler;
import cc.riskswap.lookmate.common.api.ApiErrors;
import cc.riskswap.lookmate.common.filter.AuthGuardFilter;
import cc.riskswap.lookmate.common.model.dto.AccountDto;
import cc.riskswap.lookmate.service.WorkspaceService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.CannotCreateTransactionException;

class WorkspaceControllerTest {
    @Test
    void transactionConnectionFailureUsesSafeServiceUnavailableResponse() throws Exception {
        var service = mock(WorkspaceService.class);
        when(service.workspace(7L))
                .thenThrow(new CannotCreateTransactionException("PRIVATE_DATABASE_URL"));
        var mvc =
                MockMvcBuilders.standaloneSetup(new WorkspaceController(service))
                        .setControllerAdvice(new ApiExceptionHandler())
                        .build();
        mvc.perform(
                        get("/api/workspace")
                                .requestAttr(
                                        AuthGuardFilter.ACCOUNT, new AccountDto("7", "user", null))
                                .requestAttr(ApiErrors.REQUEST_ID, "test-request"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.requestId").value("test-request"))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "PRIVATE_DATABASE_URL"))));
    }
}
