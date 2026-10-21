package cc.riskswap.lookmate.common.model.param;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class PersonalAttributesTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T16:00:00Z"), ZoneOffset.UTC);

    private Map<String, Object> parse(String json) {
        return ProfileParameters.parse(json);
    }

    private Map<String, Object> patch(String json) {
        return PreferenceParameters.patch(parse(json));
    }

    private void invalid(Runnable call) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("VALIDATION_ERROR"));
    }

    @Test
    void strictDatesAndShanghaiMidnight() {
        for (String date : List.of("1000-01-01", "2000-02-29", "2026-10-21"))
            assertThat(ProfileParameters.birthDate(date, clock)).isEqualTo(LocalDate.parse(date));
        for (Object date :
                List.of(
                        "0999-12-31",
                        "2026-10-22",
                        "2026-02-29",
                        "1900-02-29",
                        "2026-2-01",
                        "2026-01-01T00:00:00Z",
                        "",
                        42,
                        true)) invalid(() -> ProfileParameters.birthDate(date, clock));
        assertThat(ProfileParameters.birthDate(null, clock)).isNull();
        invalid(
                () ->
                        ProfileParameters.birthDate(
                                "2026-10-21", Clock.offset(clock, Duration.ofMillis(-1))));
        assertThat(ProfileParameters.gender(null, false)).isNull();
        for (Object gender : List.of("female", "OTHER", 1))
            invalid(() -> ProfileParameters.gender(gender, true));
        invalid(() -> ProfileParameters.gender(null, true));
    }

    @Test
    void tagsNormalizeBeforeDeduplicatingAndRetainOrder() {
        var result =
                patch(
                        """
                {"version":"0","interests":[{"type":"CUSTOM","text":" 徒步　"},{"type":"PRESET","code":"HIKING"},{"type":"CUSTOM","text":" é "},{"type":"CUSTOM","text":"é"},{"type":"CUSTOM","text":"É"}]}
                """);
        assertThat((List<?>) result.get("interests")).hasSize(3);
        assertThat(result.get("interests"))
                .isEqualTo(
                        List.of(
                                Map.of("type", "PRESET", "code", "HIKING"),
                                Map.of("type", "CUSTOM", "text", "é"),
                                Map.of("type", "CUSTOM", "text", "É")));
        assertThat(patch("{\"version\":\"0\",\"outfitNote\":\"  a\\nb  \"}").get("outfitNote"))
                .isEqualTo("a\nb");
    }

    @Test
    void codePointLimitsNotUtf16AndNoSilentTruncation() {
        var tag = Map.of("type", "CUSTOM", "text", "😀".repeat(20));
        assertThat(PreferenceParameters.patch(Map.of("interests", List.of(tag))))
                .containsKey("interests");
        invalid(
                () ->
                        PreferenceParameters.patch(
                                Map.of(
                                        "interests",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "CUSTOM",
                                                        "text",
                                                        "😀".repeat(21))))));
        assertThat(PreferenceParameters.patch(Map.of("hairNote", "😀".repeat(500))))
                .containsEntry("hairNote", "😀".repeat(500));
        invalid(() -> PreferenceParameters.patch(Map.of("hairNote", "😀".repeat(501))));
        assertThat(PreferenceParameters.patch(Map.of("interests", Collections.nCopies(20, tag))))
                .containsKey("interests");
        invalid(
                () ->
                        PreferenceParameters.patch(
                                Map.of("interests", Collections.nCopies(21, tag))));
    }

    @Test
    void rejectsMalformedNestedAndUnknownFields() {
        for (String json :
                List.of(
                        "{}",
                        "{\"version\":\"0\"}",
                        "{\"extra\":null}",
                        "{\"fits\":{}}",
                        "{\"fits\":[null]}",
                        "{\"fits\":[1]}",
                        "{\"fits\":[\"UNKNOWN\"]}",
                        "{\"interests\":[{\"type\":\"PRESET\",\"code\":\"徒步\"}]}",
                        "{\"interests\":[{\"type\":\"CUSTOM\",\"text\":\" \"}]}",
                        "{\"interests\":[{\"type\":\"CUSTOM\",\"text\":\"test\",\"code\":\"HIKING\"}]}",
                        "{\"groomingEffort\":\"\"}",
                        "{\"hairNote\":12}")) invalid(() -> patch(json));
    }

    @Test
    void allPresetAndEnumCodesRoundTrip() {
        var sets =
                Map.of(
                        "interests",
                        "HIKING,CAMPING,CYCLING,RUNNING,FITNESS,TRAVEL,PHOTOGRAPHY,MUSIC,READING,ART",
                        "styles",
                        "MINIMAL,CASUAL,BUSINESS,SPORTY,OUTDOOR,RETRO,STREET,ELEGANT,SWEET,ANDROGYNOUS",
                        "preferredColors",
                        "BLACK,WHITE,GRAY,BEIGE,BROWN,RED,ORANGE,YELLOW,GREEN,BLUE,PURPLE,PINK",
                        "avoidedColors",
                        "BLACK,WHITE,GRAY,BEIGE,BROWN,RED,ORANGE,YELLOW,GREEN,BLUE,PURPLE,PINK");
        for (var entry : sets.entrySet()) {
            var tags =
                    Arrays.stream(entry.getValue().split(","))
                            .map(code -> Map.of("type", "PRESET", "code", code))
                            .toList();
            var merged = PreferenceParameters.values(null);
            merged.putAll(PreferenceParameters.patch(Map.of(entry.getKey(), tags)));
            assertThat(
                            PreferenceParameters.values(PreferenceParameters.row(1L, merged))
                                    .get(entry.getKey()))
                    .isEqualTo(tags);
        }
        for (var entry :
                Map.of(
                                "fits",
                                List.of("LOOSE", "REGULAR", "SLIM"),
                                "hairLengths",
                                List.of("SHORT", "MEDIUM", "LONG"),
                                "restrictions",
                                List.of("NO_HIGH_HEELS", "NO_MIDRIFF", "NO_TIGHT", "NO_SHORTENING"))
                        .entrySet())
            assertThat(PreferenceParameters.patch(Map.of(entry.getKey(), entry.getValue())))
                    .containsEntry(entry.getKey(), entry.getValue());
        for (String field : List.of("dyeAcceptance", "permAcceptance"))
            for (String code : List.of("ACCEPT", "REJECT"))
                assertThat(PreferenceParameters.patch(Map.of(field, code)))
                        .containsEntry(field, code);
        for (String code : List.of("LOW", "MEDIUM", "HIGH"))
            assertThat(PreferenceParameters.patch(Map.of("groomingEffort", code)))
                    .containsEntry("groomingEffort", code);
    }

    @Test
    void clearAndMergedConflicts() {
        var merged = PreferenceParameters.values(null);
        merged.putAll(patch("{\"preferredColors\":[{\"type\":\"PRESET\",\"code\":\"BLUE\"}]}"));
        merged.putAll(patch("{\"avoidedColors\":[{\"type\":\"CUSTOM\",\"text\":\" 蓝 \"}]}"));
        invalid(() -> PreferenceParameters.validateMerged(merged));
        merged.putAll(
                patch(
                        "{\"avoidedColors\":null,\"fits\":[\"SLIM\"],\"restrictions\":[\"NO_TIGHT\"]}"));
        invalid(() -> PreferenceParameters.validateMerged(merged));
        merged.putAll(
                patch(
                        "{\"fits\":[],\"restrictions\":[\"NO_SHORTENING\"],\"hairLengths\":[\"SHORT\"],\"outfitNote\":\"　 \"}"));
        PreferenceParameters.validateMerged(merged);
        assertThat(PreferenceParameters.values(PreferenceParameters.row(1L, merged)))
                .isEqualTo(merged);
        assertThat(merged).hasSize(13).containsEntry("outfitNote", null);
    }
}
