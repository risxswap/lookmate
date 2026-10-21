package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.api.*;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.param.*;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.FileService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
public class FileController {
    private final FileService service;

    @PostMapping("/api/files/upload-intents")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<?> intent(@RequestBody FileUploadParam body, HttpServletRequest r) {
        return response(service.intent(user(r), body), r);
    }

    @GetMapping("/api/files/{id}")
    public ApiResponse<?> get(@PathVariable String id, HttpServletRequest r) {
        return response(service.get(user(r), id), r);
    }

    @PostMapping("/api/files/{id}/complete")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<?> complete(
            @PathVariable String id,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest r) {
        if (body != null && body.length > 0)
            throw new ApiException(400, "VALIDATION_ERROR", "此操作不接受请求正文");
        return response(service.complete(user(r), id), r);
    }

    @PostMapping("/api/files/{id}/access")
    public ApiResponse<?> access(
            @PathVariable String id, @RequestBody FileAccessParam body, HttpServletRequest r) {
        return response(service.access(user(r), id, body.getVariant()), r);
    }

    private static Long user(HttpServletRequest r) {
        return Long.valueOf(((AccountDto) r.getAttribute(AuthGuardFilter.ACCOUNT)).getId());
    }

    private static <T> ApiResponse<T> response(T data, HttpServletRequest r) {
        return new ApiResponse<>(data, (String) r.getAttribute(ApiErrors.REQUEST_ID));
    }
}
