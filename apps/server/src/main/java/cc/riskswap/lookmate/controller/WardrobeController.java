package cc.riskswap.lookmate.controller;

import java.util.*;
import jakarta.servlet.http.HttpServletRequest;
import cc.riskswap.lookmate.api.*;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.security.AuthGuardFilter;
import cc.riskswap.lookmate.service.WardrobeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/dresses")
public class WardrobeController {
    private final WardrobeService wardrobe;
    @GetMapping("/categories") public ApiResponse<List<DressCategoryDto>> categories(HttpServletRequest r) { return response(wardrobe.categories(),r); }
    @GetMapping public ApiResponse<PageDto<DressDto>> list(@RequestParam(required=false) String page,@RequestParam(required=false) String pageSize,@RequestParam(required=false) String categoryId,HttpServletRequest r) { return response(wardrobe.list(user(r),page,pageSize,categoryId),r); }
    @GetMapping("/{id}") public ApiResponse<DressDto> detail(@PathVariable String id,HttpServletRequest r) { return response(wardrobe.detail(user(r),id),r); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED) public ApiResponse<DressDto> create(@RequestBody Map<String,Object> body,HttpServletRequest r) { return response(wardrobe.create(user(r),body),r); }
    @PatchMapping("/{id}") public ApiResponse<DressDto> patch(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest r) { return response(wardrobe.patch(user(r),id,body),r); }
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable String id,@RequestBody(required=false) byte[] body,HttpServletRequest r) { if(body!=null&&body.length>0) throw new ApiException(400,"VALIDATION_ERROR","此操作不接受请求正文"); wardrobe.delete(user(r),id); return response(null,r); }
    @PatchMapping("/{id}/images/{imageId}") public ApiResponse<DressDto> manual(@PathVariable String id,@PathVariable String imageId,@RequestBody Map<String,Object> body,HttpServletRequest r) { return response(wardrobe.manual(user(r),id,imageId,body),r); }
    @PostMapping("/{id}/recognition-retry") @ResponseStatus(HttpStatus.ACCEPTED) public ApiResponse<DressRecognitionDto> retry(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest r) { return response(wardrobe.retry(user(r),id,body),r); }
    private static Long user(HttpServletRequest r) { return Long.valueOf(((AccountDto)r.getAttribute(AuthGuardFilter.ACCOUNT)).getId()); }
    private static <T> ApiResponse<T> response(T data,HttpServletRequest r) { return new ApiResponse<>(data,(String)r.getAttribute(ApiErrors.REQUEST_ID)); }
}
