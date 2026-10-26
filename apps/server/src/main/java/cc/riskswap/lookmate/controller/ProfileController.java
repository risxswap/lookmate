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
@RequestMapping("/api/profile")
public class ProfileController {
    private final ProfileService service;

    @GetMapping
    public ApiResponse<ProfileDto> get(HttpServletRequest request) {
        return ApiResponses.ok(service.get(CurrentUser.id(request)), request);
    }

    @PatchMapping(consumes = "application/json")
    public ApiResponse<ProfileDto> patch(@RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.patch(CurrentUser.id(request), ProfileParameters.parse(body)), request);
    }

    @PatchMapping(value = "/preferences", consumes = "application/json")
    public ApiResponse<ProfileDto> preferences(
            @RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.preferences(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @GetMapping("/measurements")
    public ApiResponse<PageDto<MeasurementDto>> measurements(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            HttpServletRequest request) {
        return ApiResponses.ok(
                service.measurements(CurrentUser.id(request), page, pageSize), request);
    }

    @PostMapping(value = "/measurements", consumes = "application/json")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MeasurementSaveDto> createMeasurement(
            @RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.createMeasurement(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @PatchMapping(value = "/current-measurement", consumes = "application/json")
    public ApiResponse<ProfileDto> saveCurrentMeasurement(
            @RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.saveCurrentMeasurement(
                        CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @PutMapping(value = "/current-measurement", consumes = "application/json")
    public ApiResponse<ProfileDto> currentMeasurement(
            @RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.currentMeasurement(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }

    @DeleteMapping(value = "/measurements/{id}", consumes = "application/json")
    public ApiResponse<Void> deleteMeasurement(
            @PathVariable String id, @RequestBody String body, HttpServletRequest request) {
        service.deleteMeasurement(CurrentUser.id(request), id, ProfileParameters.parse(body));
        return ApiResponses.ok(null, request);
    }

    @PutMapping(value = "/default-photos", consumes = "application/json")
    public ApiResponse<ProfileDto> defaultPhotos(
            @RequestBody String body, HttpServletRequest request) {
        return ApiResponses.ok(
                service.defaultPhotos(CurrentUser.id(request), ProfileParameters.parse(body)),
                request);
    }
}
