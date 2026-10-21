package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.api.*;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.param.ProfileParameters;
import cc.riskswap.lookmate.security.CurrentUser;
import cc.riskswap.lookmate.service.ProfileService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/photos")
public class PhotoController {
    private final ProfileService service;

    @GetMapping
    public ApiResponse<PageDto<PhotoDto>> photos(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String photoType,
            HttpServletRequest request) {
        return response(
                service.photos(CurrentUser.id(request), page, pageSize, photoType), request);
    }

    @PostMapping(consumes = "application/json")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<PhotoDto> createPhoto(@RequestBody String body, HttpServletRequest request) {
        return response(
                service.createPhoto(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @DeleteMapping(value = "/{id}", consumes = "application/json")
    public ApiResponse<Void> deletePhoto(
            @PathVariable String id, @RequestBody String body, HttpServletRequest request) {
        service.deletePhoto(CurrentUser.id(request), id, ProfileParameters.parse(body));
        return response(null, request);
    }

    private static <T> ApiResponse<T> response(T data, HttpServletRequest request) {
        return new ApiResponse<>(data, (String) request.getAttribute(ApiErrors.REQUEST_ID));
    }
}
