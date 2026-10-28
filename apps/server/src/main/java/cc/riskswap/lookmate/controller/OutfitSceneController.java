package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.OutfitService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/outfit-scenes")
public class OutfitSceneController {
    private final OutfitService service;

    @GetMapping
    public ApiResponse<PageDto<Map<String, String>>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest r) {
        return ApiResponses.ok(service.sceneOptions(CurrentUser.id(r), page, pageSize), r);
    }
}
