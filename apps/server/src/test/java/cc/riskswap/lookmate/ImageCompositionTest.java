package cc.riskswap.lookmate;

import static org.junit.jupiter.api.Assertions.*;

import cc.riskswap.lookmate.common.util.ImageComposition;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ImageCompositionTest {
    private Map<String, Object> base(Map<String, Object> p) {
        return Map.of(
                "imageEndpoint",
                "https://provider.example/images",
                "imageProtocol",
                "openai-edits",
                "imageModel",
                "gpt-image-2",
                "imageParameters",
                p);
    }

    @Test
    void configuredSizesAndIsolation() {
        var b = base(Map.of());
        var h = ImageComposition.configure(b, Map.of("HAIRSTYLE", "1024x1024"), "HAIRSTYLE");
        var o = ImageComposition.configure(b, Map.of("OUTFIT", "768x1024"), "OUTFIT");
        assertEquals("1024x1024", ((Map<?, ?>) h.get("imageParameters")).get("size"));
        assertEquals("768x1024", ((Map<?, ?>) o.get("imageParameters")).get("size"));
        assertTrue(ImageComposition.prompt(o).contains("head to shoes"));
        assertFalse(b.containsKey("compositionType"));
        assertTrue(((Map<?, ?>) b.get("imageParameters")).isEmpty());
    }

    @Test
    void explicitAndCustomModels() {
        var h =
                ImageComposition.configure(
                        base(Map.of("size", "960x1280")),
                        Map.of("HAIRSTYLE", "512x512"),
                        "HAIRSTYLE");
        assertEquals("960x1280", ((Map<?, ?>) h.get("imageParameters")).get("size"));
        var other =
                Map.<String, Object>of(
                        "imageProtocol",
                        "openai-edits",
                        "imageModel",
                        "custom",
                        "imageParameters",
                        Map.of());
        assertTrue(
                ((Map<?, ?>)
                                ImageComposition.configure(other, Map.of(), "OUTFIT")
                                        .get("imageParameters"))
                        .isEmpty());
        assertEquals(
                "1024x1536",
                ((Map<?, ?>)
                                ImageComposition.configure(
                                                other, Map.of("OUTFIT", "1024x1536"), "OUTFIT")
                                        .get("imageParameters"))
                        .get("size"));
    }

    @Test
    void retryPreservesAcceptedFraming() {
        var c = base(Map.of("size", "960x1280"));
        assertSame(c, ImageComposition.retry(c, base(Map.of())));
        var h =
                ImageComposition.configure(
                        base(Map.of()), Map.of("HAIRSTYLE", "1024x1024"), "HAIRSTYLE");
        var r = ImageComposition.retry(c, h);
        assertEquals("1024x1024", ((Map<?, ?>) r.get("imageParameters")).get("size"));
        assertEquals("", ImageComposition.prompt(c));
        assertTrue(ImageComposition.prompt(r).contains("head-and-shoulders"));
    }

    @Test
    void changedEndpointUsesCurrentSize() {
        var old =
                new java.util.LinkedHashMap<>(
                        ImageComposition.configure(
                                base(Map.of()), Map.of("HAIRSTYLE", "1024x1024"), "HAIRSTYLE"));
        old.put("imageEndpoint", "https://old.example/images");
        var current = new java.util.LinkedHashMap<>(base(Map.of("size", "960x1280")));
        current.put("imageEndpoint", "https://new.example/images");
        var retried = ImageComposition.retry(current, old);
        assertEquals("960x1280", ((Map<?, ?>) retried.get("imageParameters")).get("size"));
        assertEquals("HAIRSTYLE", retried.get("compositionType"));
    }

    @Test
    void changedModelUsesCurrentSize() {
        var previous =
                ImageComposition.configure(
                        base(Map.of()), Map.of("HAIRSTYLE", "1024x1024"), "HAIRSTYLE");
        var current = new java.util.LinkedHashMap<>(base(Map.of("size", "960x1280")));
        current.put("imageModel", "another-model");
        assertEquals(
                "960x1280",
                ((Map<?, ?>) ImageComposition.retry(current, previous).get("imageParameters"))
                        .get("size"));
    }
}
