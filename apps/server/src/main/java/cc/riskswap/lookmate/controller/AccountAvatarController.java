package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.common.model.param.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.AccountAvatarService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/profile/avatar")
@RequiredArgsConstructor
public class AccountAvatarController {
    private final AccountAvatarService service;

    @PutMapping
    public ApiResponse<?> save(@RequestBody String body, HttpServletRequest r) {
        var p = WechatParameters.parse(body, "fileId");
        if (!p.has("fileId")) throw new ApiException(400, "VALIDATION_ERROR", "请提供头像文件");
        Long id =
                p.get("fileId").isNull()
                        ? null
                        : RecordParameters.id(WechatParameters.text(p, "fileId", 32));
        return ApiResponses.ok(service.save(CurrentUser.id(r), id), r);
    }
}
