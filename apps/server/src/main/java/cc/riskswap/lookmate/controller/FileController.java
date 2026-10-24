package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.advice.*;
import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.exception.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.*;
import cc.riskswap.lookmate.common.util.CurrentUser;
import cc.riskswap.lookmate.service.FileService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/files")
public class FileController {
    private final FileService service;

    @PostMapping("/upload-intents")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<?> intent(@RequestBody FileUploadParam body, HttpServletRequest r) {
        return ApiResponses.ok(service.intent(CurrentUser.id(r), body), r);
    }

    @GetMapping("/{id}")
    public ApiResponse<?> get(@PathVariable String id, HttpServletRequest r) {
        return ApiResponses.ok(service.get(CurrentUser.id(r), id), r);
    }

    @PostMapping("/{id}/complete")
    public ApiResponse<?> complete(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0)
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
        return ApiResponses.ok(service.complete(CurrentUser.id(r), id), r);
    }

    @PostMapping("/{id}/access")
    public ApiResponse<?> access(
            @PathVariable String id, @RequestBody FileAccessParam body, HttpServletRequest r) {
        return ApiResponses.ok(service.access(CurrentUser.id(r), id, body.getVariant()), r);
    }
}
