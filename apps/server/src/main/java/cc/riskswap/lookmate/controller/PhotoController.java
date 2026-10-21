package cc.riskswap.lookmate.controller;

import jakarta.servlet.http.HttpServletRequest;
import cc.riskswap.lookmate.api.*;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.param.ProfileParameters;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.ProfileService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/photos")
public class PhotoController {
    private final ProfileService service;
    @GetMapping
    public ApiResponse<PageDto<PhotoDto>> photos(@RequestParam(required=false) String page,@RequestParam(required=false) String pageSize,@RequestParam(required=false) String photoType,HttpServletRequest request) {
        return response(service.photos(user(request),page,pageSize,photoType),request);
    }
    @PostMapping(consumes="application/json") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<PhotoDto> createPhoto(@RequestBody String body,HttpServletRequest request) { return response(service.createPhoto(user(request),ProfileParameters.parse(body)),request); }
    @DeleteMapping(value="/{id}",consumes="application/json")
    public ApiResponse<Void> deletePhoto(@PathVariable String id,@RequestBody String body,HttpServletRequest request) {
        service.deletePhoto(user(request),id,ProfileParameters.parse(body)); return response(null,request);
    }

    private static Long user(HttpServletRequest request) { return Long.valueOf(((AccountDto)request.getAttribute(AuthGuardFilter.ACCOUNT)).getId()); }
    private static <T> ApiResponse<T> response(T data,HttpServletRequest request) { return new ApiResponse<>(data,(String)request.getAttribute(ApiErrors.REQUEST_ID)); }
}
