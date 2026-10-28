package cc.riskswap.lookmate.common.util;

import java.util.LinkedHashMap;
import java.util.Map;

/** Resolves new-task framing without changing legacy task snapshots. */
public final class ImageComposition {
    private ImageComposition() {}

    public static Map<String, Object> configure(
            Map<String, Object> base, Map<String, String> sizes, String type) {
        var result = new LinkedHashMap<>(base);
        var parameters = new LinkedHashMap<String, Object>();
        if (base.get("imageParameters") instanceof Map<?, ?> original)
            original.forEach((key, value) -> parameters.put((String) key, value));
        String protocol = String.valueOf(base.get("imageProtocol"));
        String key = "siliconflow-images".equals(protocol) ? "image_size" : "size";
        String size = sizes.get(type);
        if ((size == null || size.isBlank())
                && "siliconflow-images".equals(protocol)
                && "Kwai-Kolors/Kolors".equals(base.get("imageModel")))
            size = "HAIRSTYLE".equals(type) ? "1024x1024" : "768x1024";
        if (!parameters.containsKey(key) && size != null && !size.isBlank())
            parameters.put(key, size);
        result.put("imageParameters", parameters);
        result.put("compositionType", type);
        return result;
    }

    public static Map<String, Object> retry(
            Map<String, Object> current, Map<String, Object> previous) {
        if (!previous.containsKey("compositionType")) return current;
        var result = new LinkedHashMap<>(current);
        result.put("compositionType", previous.get("compositionType"));
        // Preserve dimensions only when the current protocol/model still accepts the same
        // parameters.
        if (java.util.Objects.equals(current.get("imageEndpoint"), previous.get("imageEndpoint"))
                && java.util.Objects.equals(
                        current.get("imageProtocol"), previous.get("imageProtocol"))
                && java.util.Objects.equals(
                        current.get("imageModel"), previous.get("imageModel"))) {
            var parameters = new LinkedHashMap<String, Object>();
            if (current.get("imageParameters") instanceof Map<?, ?> values)
                values.forEach((key, value) -> parameters.put((String) key, value));
            String key =
                    "siliconflow-images".equals(current.get("imageProtocol"))
                            ? "image_size"
                            : "size";
            parameters.remove(key);
            if (previous.get("imageParameters") instanceof Map<?, ?> values
                    && values.containsKey(key)) parameters.put(key, values.get(key));
            result.put("imageParameters", parameters);
        }
        return result;
    }

    public static String prompt(Map<String, Object> config) {
        if (!config.containsKey("compositionType")) return "";
        return "HAIRSTYLE".equals(config.get("compositionType"))
                ? "\nFrame a head-and-shoulders portrait showing the complete hairstyle and hair edges without cropping."
                : "\nFrame the complete person from head to shoes, with all outfit details visible; do not crop head or feet.";
    }
}
