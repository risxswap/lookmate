package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.integration.ai.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class GenerationEngineTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final GenerationGateway gateway = mock(GenerationGateway.class);
    private final GenerationEngine engine = new GenerationEngine(gateway);

    static Map<String, Object> budgets() {
        return new HashMap<>(
                Map.of(
                        "candidateTarget",
                        24,
                        "planningMaxImages",
                        25,
                        "imageMaxImages",
                        8,
                        "maxInputBytes",
                        1_000_000,
                        "maxTextChars",
                        40_000));
    }

    static Map<String, Object> garment(String id, String category) {
        return new HashMap<>(
                Map.of(
                        "dressId",
                        id,
                        "name",
                        "单品" + id,
                        "categoryCode",
                        category,
                        "categoryName",
                        category,
                        "images",
                        new ArrayList<>(
                                List.of(
                                        new HashMap<>(
                                                Map.of(
                                                        "imageId",
                                                        id + "0",
                                                        "fileId",
                                                        id + "00",
                                                        "features",
                                                        Map.of()))))));
    }

    static Map<String, Object> snapshot() {
        var result = new HashMap<String, Object>();
        result.put("schemaVersion", 3);
        result.put("fixedOutfit", false);
        result.put("outfitInspirationReference", null);
        result.put("designType", "OUTFIT");
        result.put(
                "normalizedRequest",
                Map.of("requiredDressIds", List.of("1"), "requirements", "必须不露腿，日常通勤"));
        result.put("candidateItems", List.of(garment("1", "TOP"), garment("2", "BOTTOM")));
        result.put("effectiveConstraints", List.of(Map.of("id", "NO_MIDRIFF", "text", "不能露腰")));
        result.put("recentOutfits", List.of());
        result.put("budgets", budgets());
        return result;
    }

    static Map<String, Object> valid() {
        return JSON.readValue(
                """
                {"schemaVersion":2,"kind":"READY","plan":{"inspirationAdaptation":null,"title":"通勤搭配","summary":"已有衣物搭配","style":"休闲","occasion":"日常","designReason":"协调","matchLevel":"EXACT","colorAdvice":"素色组合","wearingAdvice":"上衣自然垂下","hairstyle":null,"items":[{"dressId":"1","referenceImageIds":["10"],"role":"TOP","matchReason":"搭配协调","wearingMethod":"正常穿着"},{"dressId":"2","referenceImageIds":["20"],"role":"BOTTOM","matchReason":"搭配协调","wearingMethod":"正常穿着"}],"limitations":[],"interpretations":[],"illustrativeShoes":{"description":"浅色平底示意鞋"},"novelty":null,"imageDirection":{"wearingDetails":"上衣不塞入裤腰","composition":"全身正面"}},"constraintChecks":[{"constraintId":"NO_MIDRIFF","result":"SATISFIED","explanation":"腰部有覆盖"}],"requestConstraints":[],"noMatch":null}
                """,
                Map.class);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> plan(Map<String, Object> output) {
        return (Map<String, Object>) output.get("plan");
    }

    @Test
    void rejectsPreviousSnapshotAndOutputSchemas() {
        var previous = snapshot();
        previous.put("schemaVersion", 2);
        assertThatThrownBy(() -> engine.validate(previous, valid(), Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class)
                .extracting(e -> ((GenerationFailure) e).getCode())
                .isEqualTo("INPUT_SNAPSHOT_INVALID");
        var output = valid();
        output.put("schemaVersion", 1);
        assertThatThrownBy(() -> engine.validate(snapshot(), output, Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class)
                .extracting(e -> ((GenerationFailure) e).getCode())
                .isEqualTo("PLAN_OUTPUT_INVALID");
    }

    @Test
    void nonReferencePlanRequiresExplicitNullAdaptation() {
        var missing = valid();
        plan(missing).remove("inspirationAdaptation");
        assertThatThrownBy(() -> engine.validate(snapshot(), missing, Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class);
        var invented = valid();
        plan(invented)
                .put("inspirationAdaptation", Map.of("borrowedElements", List.of("invented")));
        assertThatThrownBy(() -> engine.validate(snapshot(), invented, Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class);
        assertThat(engine.validate(snapshot(), valid(), Set.of("10", "20")))
                .containsEntry("schemaVersion", 2);
    }

    @Test
    void smallWardrobeIncludesUnknownFeaturesAndMakesIndependentSnapshot() {
        var top = garment("1", "TOP");
        var result =
                engine.selectCandidates(
                        List.of(top, garment("2", "BOTTOM")),
                        List.of("1"),
                        Map.of(),
                        42,
                        budgets());
        top.put("name", "changed");
        assertThat(result).hasSize(2);
        assertThat(result.getFirst().get("name")).isEqualTo("单品1");
    }

    @Test
    void shrinkingImagesKeepsBasicRouteBeforeRequiredAccessory() {
        var budget = budgets();
        budget.put("planningMaxImages", 4);
        var result =
                engine.selectCandidates(
                        List.of(
                                garment("1", "TOP"),
                                garment("2", "BOTTOM"),
                                garment("3", "BAG"),
                                garment("4", "ACCESSORY")),
                        List.of("3"),
                        Map.of(),
                        4,
                        budget);
        assertThat(result.stream().map(i -> i.get("dressId")))
                .containsExactlyInAnyOrder("1", "2", "3");
        budget.put("planningMaxImages", 3);
        assertThatThrownBy(
                        () ->
                                engine.selectCandidates(
                                        List.of(
                                                garment("1", "TOP"),
                                                garment("2", "BOTTOM"),
                                                garment("3", "BAG")),
                                        List.of("3"),
                                        Map.of(),
                                        4,
                                        budget))
                .isInstanceOf(GenerationFailure.class)
                .hasMessage("INPUT_BUDGET_EXCEEDED");
    }

    @Test
    void coatOnlyCandidatesAreNotRejectedByCategory() {
        assertThat(
                        engine.selectCandidates(
                                List.of(garment("1", "COAT")), List.of(), Map.of(), 0, budgets()))
                .hasSize(1);
    }

    @Test
    void requiredItemCannotBeDroppedOrDuplicated() {
        assertThatThrownBy(
                        () ->
                                engine.selectCandidates(
                                        List.of(garment("1", "TOP")),
                                        List.of("9"),
                                        Map.of(),
                                        0,
                                        budgets()))
                .hasMessage("REQUIRED_DRESS_UNAVAILABLE");
        assertThatThrownBy(
                        () ->
                                engine.selectCandidates(
                                        List.of(garment("1", "TOP")),
                                        List.of("1", "1"),
                                        Map.of(),
                                        0,
                                        budgets()))
                .hasMessage("VALIDATION_ERROR");
    }

    @Test
    void seedIsStableAndInputOrderDoesNotControlSelection() {
        var wardrobe = new ArrayList<Map<String, Object>>();
        for (int i = 1; i <= 50; i++)
            wardrobe.add(garment(Integer.toString(i), i % 2 == 0 ? "TOP" : "BOTTOM"));
        var first = engine.selectCandidates(wardrobe, List.of(), Map.of(), 17, budgets());
        Collections.reverse(wardrobe);
        assertThat(engine.selectCandidates(wardrobe, List.of(), Map.of(), 17, budgets()))
                .isEqualTo(first);
        assertThat(engine.selectCandidates(wardrobe, List.of(), Map.of(), 18, budgets()))
                .isNotEqualTo(first);
    }

    @Test
    void inspirationAdaptationIsStrictAndNeverSentToImageModel() {
        var snapshot = snapshot();
        var reference = new OutfitInspirationCatalogService("v999").requireAvailable("test-0");
        snapshot.put("outfitInspirationReference", reference);
        var request = new HashMap<>(GenerationService.map(snapshot.get("normalizedRequest")));
        request.put("outfitInspirationId", "test-0");
        request.put("outfitInspirationVersion", "v999");
        snapshot.put("normalizedRequest", request);
        var output = valid();
        assertThatThrownBy(() -> engine.validate(snapshot, output, Set.of("10", "20")))
                .hasMessage("PLAN_OUTPUT_INVALID");
        plan(output)
                .put(
                        "inspirationAdaptation",
                        Map.of("borrowedElements", List.of("参考借鉴文本"), "differences", List.of()));
        GenerationService.list(plan(output).get("items"))
                .getFirst()
                .put("matchReason", "比较原始参考款但实际不同");
        assertThat(engine.validate(snapshot, output, Set.of("10", "20")))
                .containsEntry("kind", "READY");
        assertThat(engine.imagePrompt(snapshot, output))
                .doesNotContain(
                        "参考借鉴文本", "比较原始参考款", "outfitInspirationReference", "inspirationAdaptation");
        GenerationService.list(plan(output).get("items"))
                .getFirst()
                .put("referenceImageIds", List.of("inspiration:test-0:v999:main"));
        assertThatThrownBy(
                        () ->
                                engine.validate(
                                        snapshot,
                                        output,
                                        Set.of("10", "20", "inspiration:test-0:v999:main")))
                .hasMessage("PLAN_OUTPUT_INVALID");
        GenerationService.list(plan(output).get("items"))
                .getFirst()
                .put("referenceImageIds", List.of("10"));
        plan(output)
                .put(
                        "inspirationAdaptation",
                        Map.of("borrowedElements", List.of(), "differences", List.of()));
        assertThatThrownBy(() -> engine.validate(snapshot, output, Set.of("10", "20")))
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void inspirationBudgetIsReservedBeforeCandidateSelection() {
        var wardrobe = List.of(garment("1", "TOP"), garment("2", "BOTTOM"), garment("3", "BAG"));
        wardrobe.forEach(
                item ->
                        GenerationService.list(item.get("images"))
                                .getFirst()
                                .put("sizeBytes", 100));
        var budget = budgets();
        budget.put("planningMaxImages", 4);
        budget.put("inspirationImageCount", 1);
        budget.put("personImageBytes", 100);
        budget.put("inspirationImageBytes", 100);
        budget.put("maxInputBytes", 400);
        assertThat(engine.selectCandidates(wardrobe, List.of(), Map.of(), 1, budget)).hasSize(2);
        assertThatThrownBy(
                        () -> engine.selectCandidates(wardrobe, List.of("3"), Map.of(), 1, budget))
                .hasMessage("INPUT_BUDGET_EXCEEDED");
    }

    @Test
    void validPlanCallsModelExactlyOnce() {
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenReturn(JSON.writeValueAsString(valid()));
        var output =
                engine.plan(
                        snapshot(),
                        Map.of(),
                        List.of(
                                new GenerationGateway.Image("person:3", "url"),
                                new GenerationGateway.Image("10", "url"),
                                new GenerationGateway.Image("20", "url")));
        assertThat(output.get("kind")).isEqualTo("READY");
        verify(gateway, times(1))
                .plan(anyMap(), contains("Normal occlusion"), anyString(), anyList());
        verifyNoMoreInteractions(gateway);
    }

    @Test
    void duplicateJsonAndUnknownFieldsFailWithoutRepair() {
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenReturn("{\"schemaVersion\":2,\"schemaVersion\":2}");
        assertThatThrownBy(
                        () ->
                                engine.plan(
                                        snapshot(),
                                        Map.of(),
                                        List.of(new GenerationGateway.Image("person:3", "url"))))
                .isInstanceOf(GenerationFailure.class)
                .hasMessage("PLAN_OUTPUT_INVALID");
        verify(gateway, times(1)).plan(anyMap(), anyString(), anyString(), anyList());
        var output = valid();
        plan(output).put("score", 99);
        assertInvalid(output);
    }

    @Test
    void referencesMustHaveActuallyBeenSeenAndBelongToSelectedItem() {
        assertThatThrownBy(() -> engine.validate(snapshot(), valid(), Set.of("10")))
                .hasMessage("PLAN_OUTPUT_INVALID");
        var output = valid();
        var item = (Map<String, Object>) ((List<?>) plan(output).get("items")).getFirst();
        item.put("referenceImageIds", List.of("20"));
        assertInvalid(output);
    }

    @Test
    void missingRequiredOrIncompleteBaseFails() {
        var output = valid();
        ((List<?>) plan(output).get("items")).removeFirst();
        assertInvalid(output);
        output = valid();
        ((Map<String, Object>) ((List<?>) plan(output).get("items")).getLast())
                .put("role", "ACCESSORY");
        assertInvalid(output);
    }

    @Test
    void hardConstraintUnknownOrMissingCannotProduceReady() {
        var output = valid();
        ((Map<String, Object>) ((List<?>) output.get("constraintChecks")).getFirst())
                .put("result", "UNCERTAIN");
        assertInvalid(output);
        output = valid();
        output.put("constraintChecks", List.of());
        assertInvalid(output);
    }

    @Test
    void requestConstraintsRequireRealExcerpt() {
        var output = valid();
        output.put(
                "requestConstraints",
                List.of(
                        Map.of(
                                "id",
                                "r1",
                                "source",
                                "REQUEST_TEXT",
                                "excerpt",
                                "虚构要求",
                                "strength",
                                "SOFT")));
        assertInvalid(output);
    }

    @Test
    void realShoesAndIllustrativeShoesAreMutuallyExclusive() {
        var snap = snapshot();
        snap.put(
                "candidateItems",
                List.of(garment("1", "TOP"), garment("2", "BOTTOM"), garment("3", "SHOE")));
        var output = valid();
        ((List<Object>) plan(output).get("items"))
                .add(
                        Map.of(
                                "dressId",
                                "3",
                                "referenceImageIds",
                                List.of("30"),
                                "role",
                                "SHOES",
                                "matchReason",
                                "协调",
                                "wearingMethod",
                                "正常穿着"));
        assertThatThrownBy(() -> engine.validate(snap, output, Set.of("10", "20", "30")))
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void noMatchDoesNotContainExecutablePlan() {
        var output = new HashMap<>(valid());
        output.put("kind", "NO_MATCH");
        output.put("plan", null);
        output.put(
                "noMatch",
                Map.of(
                        "reasonCode",
                        "INCOMPLETE_OUTFIT",
                        "message",
                        "候选不足",
                        "relatedConstraintIds",
                        List.of()));
        assertThat(engine.validate(snapshot(), output, Set.of("10", "20")).get("kind"))
                .isEqualTo("NO_MATCH");
        assertThatThrownBy(() -> engine.imagePrompt(snapshot(), output))
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void imageBudgetAndModeAreChecked() {
        var snap = snapshot();
        ((Map<String, Object>) snap.get("budgets")).put("imageMaxImages", 2);
        assertThatThrownBy(() -> engine.validate(snap, valid(), Set.of("10", "20")))
                .hasMessage("PLAN_OUTPUT_INVALID");
        snap.put("designType", "OVERALL");
        assertThatThrownBy(() -> engine.validate(snap, valid(), Set.of("10", "20")))
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void requiredTopIsReusedInSmallBudgetRoute() {
        var budget = budgets();
        budget.put("planningMaxImages", 3);
        var result =
                engine.selectCandidates(
                        List.of(garment("1", "TOP"), garment("2", "BOTTOM"), garment("3", "TOP")),
                        List.of("3"),
                        Map.of(),
                        1,
                        budget);
        assertThat(result.stream().map(i -> i.get("dressId"))).containsExactlyInAnyOrder("2", "3");
    }

    @Test
    void hairstyleAllowsNullOutfitAdviceAndPreservesOriginalClothes() {
        var snap = snapshot();
        snap.put("designType", "HAIRSTYLE");
        snap.put("normalizedRequest", Map.of());
        var output = valid();
        var plan = plan(output);
        plan.put("items", List.of());
        plan.put("illustrativeShoes", null);
        plan.put("colorAdvice", null);
        plan.put("wearingAdvice", null);
        plan.put(
                "hairstyle",
                Map.of(
                        "hairstyleName",
                        "短发",
                        "lengthAdvice",
                        "保留长度",
                        "bangsAdvice",
                        "侧分",
                        "partingAdvice",
                        "侧分",
                        "textureAdvice",
                        "自然",
                        "hairColorAdvice",
                        "原色",
                        "careAdvice",
                        "梳理"));
        engine.validate(snap, output, Set.of());
        assertThat(engine.imagePrompt(snap, output))
                .contains("Preserve all original garments")
                .doesNotContain("do not retain unselected original clothes");
    }

    @Test
    void approximateRequiresActualUnmetGoalAndBagCannotServeAsTop() {
        var output = valid();
        plan(output).put("matchLevel", "APPROXIMATE");
        plan(output)
                .put(
                        "limitations",
                        List.of(
                                Map.of(
                                        "code",
                                        "ILLUSTRATIVE_SHOES",
                                        "message",
                                        "示意鞋",
                                        "severity",
                                        "INFO")));
        assertInvalid(output);
        var snap = snapshot();
        snap.put("candidateItems", List.of(garment("1", "BAG"), garment("2", "BOTTOM")));
        assertThatThrownBy(() -> engine.validate(snap, valid(), Set.of("10", "20")))
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void byteBudgetTrimsOptionalItemsButNeverRequiredOrBasicRoute() {
        var wardrobe = List.of(garment("1", "TOP"), garment("2", "BOTTOM"), garment("3", "BAG"));
        for (var item : wardrobe)
            ((Map<String, Object>) ((List<?>) item.get("images")).getFirst()).put("sizeBytes", 100);
        var budget = budgets();
        budget.put("personImageBytes", 100);
        budget.put("maxInputBytes", 300);
        assertThat(
                        engine.selectCandidates(wardrobe, List.of(), Map.of(), 1, budget).stream()
                                .map(i -> i.get("dressId")))
                .containsExactlyInAnyOrder("1", "2");
        assertThatThrownBy(
                        () -> engine.selectCandidates(wardrobe, List.of("3"), Map.of(), 1, budget))
                .hasMessage("INPUT_BUDGET_EXCEEDED");
    }

    private void assertInvalid(Map<String, Object> output) {
        assertThatThrownBy(() -> engine.validate(snapshot(), output, Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class)
                .hasMessage("PLAN_OUTPUT_INVALID");
    }

    @Test
    void fixedEvaluationAllowsSingleTopWithNoPersonAndZeroImageBudget() {
        var snapshot = snapshot();
        snapshot.put("fixedOutfit", true);
        snapshot.put("jobKind", "EVALUATION");
        snapshot.put("candidateItems", List.of(garment("1", "TOP")));
        ((Map<String, Object>) snapshot.get("budgets")).put("imageMaxImages", 0);
        var output = valid();
        var plan = plan(output);
        plan.put("items", List.of(((List<?>) plan.get("items")).getFirst()));
        plan.put("illustrativeShoes", null);
        assertThat(engine.validate(snapshot, output, Set.of("10"))).isSameAs(output);
        when(gateway.plan(anyMap(), anyString(), anyString(), anyList()))
                .thenReturn(JSON.writeValueAsString(output));
        assertThat(
                        engine.plan(
                                snapshot,
                                Map.of(),
                                List.of(
                                        new GenerationGateway.Image(
                                                "10", "https://test.invalid/top"))))
                .containsEntry("kind", "READY");
        verify(gateway)
                .plan(anyMap(), contains("ONLY a written evaluation"), anyString(), anyList());
    }

    @Test
    void fixedCombinationCannotDropOptionalItemsOrInventIllustrativeShoesForEvaluation() {
        var snapshot = snapshot();
        snapshot.put("fixedOutfit", true);
        snapshot.put("jobKind", "EVALUATION");
        snapshot.put(
                "candidateItems",
                List.of(garment("1", "TOP"), garment("2", "BOTTOM"), garment("3", "BAG")));
        var output = valid();
        plan(output).put("illustrativeShoes", null);
        assertThatThrownBy(() -> engine.validate(snapshot, output, Set.of("10", "20", "30")))
                .isInstanceOf(GenerationFailure.class);
        snapshot.put("candidateItems", List.of(garment("1", "TOP"), garment("2", "BOTTOM")));
        plan(output).put("illustrativeShoes", Map.of("description", "虚构鞋"));
        assertThatThrownBy(() -> engine.validate(snapshot, output, Set.of("10", "20")))
                .isInstanceOf(GenerationFailure.class);
    }
}
