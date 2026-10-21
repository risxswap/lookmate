package cc.riskswap.lookmate.controller;

import cc.riskswap.lookmate.common.advice.*;
import cc.riskswap.lookmate.common.api.*;
import cc.riskswap.lookmate.common.api.ApiResponses;
import cc.riskswap.lookmate.common.exception.*;
import cc.riskswap.lookmate.common.model.dto.*;
import cc.riskswap.lookmate.common.model.param.ProfileParameters;
import cc.riskswap.lookmate.common.util.CurrentUser;
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
        return ApiResponses.ok(
                service.photos(CurrentUser.id(request), page, pageSize, photoType), request);
    }

    @GetMapping("/{id}")
    public ApiResponse<PhotoDto> photo(@PathVariable String id, HttpServletRequest request) {
        return ApiResponses.ok(service.photo(CurrentUser.id(request), id), request);
    }

    @PostMapping(consumes = "application/json")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<PhotoDto> createPhoto(@RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.createPhoto(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @DeleteMapping(value = "/{id}", consumes = "application/json")
    public ApiResponse<Void> deletePhoto(
            @PathVariable String id, @RequestBody String body, HttpServletRequest request) {
        service.deletePhoto(CurrentUser.id(request), id, ProfileParameters.parse(body));
        return ApiResponses.ok(null, request);
    }
}
