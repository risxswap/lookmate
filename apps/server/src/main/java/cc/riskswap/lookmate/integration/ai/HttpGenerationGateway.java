package cc.riskswap.lookmate.integration.ai;

import cc.riskswap.lookmate.common.util.BoundedHttp;
import java.io.ByteArrayOutputStream;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Configurable vision chat and image transports; never retries a model POST. */
@Component
public class HttpGenerationGateway implements GenerationGateway {
    private static final JsonMapper JSON =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();
    private final HttpClient http =
            HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();

    public String plan(
            Map<String, Object> config,
            String systemPrompt,
            String userPrompt,
            List<Image> images) {
        if (!ModelProtocols.CHAT.equals(config.getOrDefault("planProtocol", ModelProtocols.CHAT)))
            throw fail("GENERATION_UNAVAILABLE", false);
        URI endpoint = endpoint(config, "planEndpoint");
        int seconds = positive(config, "timeoutSeconds");
        checkImages(config, images, "planningMaxImages");
        if (systemPrompt.codePointCount(0, systemPrompt.length())
                        + userPrompt.codePointCount(0, userPrompt.length())
                > positive(config, "maxTextChars")) throw fail("INPUT_BUDGET_EXCEEDED", false);
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", userPrompt));
        for (var image : images) {
            checkedUrl(image.getUrl(), endpoint);
            content.add(Map.of("type", "text", "text", "imageId=" + image.getImageId()));
            content.add(Map.of("type", "image_url", "image_url", Map.of("url", image.getUrl())));
        }
        byte[] payload =
                JSON.writeValueAsBytes(
                        Map.of(
                                "model",
                                setting(config, "planModel"),
                                "messages",
                                List.of(
                                        Map.of("role", "system", "content", systemPrompt),
                                        Map.of("role", "user", "content", content)),
                                "response_format",
                                Map.of("type", "json_object"),
                                "stream",
                                false));
        if (payload.length > positive(config, "maxInputBytes"))
            throw fail("INPUT_BUDGET_EXCEEDED", false);
        var request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(Duration.ofSeconds(seconds))
                        .header("Authorization", "Bearer " + setting(config, "planApiKey"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .build();
        var response =
                send(
                        request,
                        positive(config, "maxResponseBytes"),
                        seconds,
                        "PLAN_PROVIDER_FAILED",
                        true);
        try {
            var choices = JSON.readTree(response.body()).path("choices");
            if (!choices.isArray()
                    || choices.size() != 1
                    || !"stop".equals(choices.path(0).path("finish_reason").asText()))
                throw fail("PLAN_OUTPUT_INVALID", false);
            var message = choices.path(0).path("message").path("content");
            if (!message.isString() || message.asText().isBlank())
                throw fail("PLAN_OUTPUT_INVALID", false);
            return message.asText();
        } catch (GenerationFailure e) {
            throw e;
        } catch (RuntimeException e) {
            throw fail("PLAN_OUTPUT_INVALID", false);
        }
    }

    public byte[] generate(Map<String, Object> config, String prompt, List<Image> images) {
        URI endpoint = endpoint(config, "imageEndpoint");
        int seconds = positive(config, "timeoutSeconds");
        int maxInput = positive(config, "maxInputBytes");
        int maxResponse = positive(config, "maxResponseBytes");
        checkImages(config, images, "imageMaxImages");
        if (prompt.codePointCount(0, prompt.length()) > positive(config, "maxTextChars"))
            throw fail("INPUT_BUDGET_EXCEEDED", false);
        String protocol =
                String.valueOf(config.getOrDefault("imageProtocol", ModelProtocols.EDITS));
        if (!ModelProtocols.imageSupported(protocol)) throw fail("GENERATION_UNAVAILABLE", false);
        // Validate credentials before downloading inputs or making a model request.
        setting(config, "imageApiKey");
        if (ModelProtocols.SILICONFLOW_IMAGES.equals(protocol)) {
            return generateSiliconFlow(
                    config, prompt, images, endpoint, seconds, maxInput, maxResponse);
        }
        String boundary = "lookmate-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        field(body, boundary, "model", setting(config, "imageModel"));
        StringBuilder bindings = new StringBuilder("\nReference image order (IDs are labels):\n");
        for (int i = 0; i < images.size(); i++)
            bindings.append(i + 1).append(": ").append(images.get(i).getImageId()).append('\n');
        field(body, boundary, "prompt", prompt + bindings);
        field(body, boundary, "n", "1");
        if (!(config.get("imageParameters") instanceof Map<?, ?> parameters))
            throw fail("GENERATION_UNAVAILABLE", false);
        Set<String> allowed =
                Set.of(
                        "size",
                        "quality",
                        "background",
                        "output_format",
                        "output_compression",
                        "input_fidelity",
                        "response_format");
        for (var entry : parameters.entrySet()) {
            if (!(entry.getKey() instanceof String key)
                    || !allowed.contains(key)
                    || !(entry.getValue() instanceof String || entry.getValue() instanceof Number))
                throw fail("GENERATION_UNAVAILABLE", false);
            field(body, boundary, key, entry.getValue().toString());
        }
        for (var image : images) {
            int remaining = maxInput - body.size();
            if (remaining <= 0) throw fail("INPUT_BUDGET_EXCEEDED", false);
            var download =
                    HttpRequest.newBuilder(checkedUrl(image.getUrl(), endpoint))
                            .timeout(Duration.ofSeconds(seconds))
                            .GET()
                            .build();
            byte[] bytes =
                    send(download, remaining, seconds, "IMAGE_INPUT_UNAVAILABLE", false).body();
            String mime = imageMime(bytes);
            write(
                    body,
                    "--"
                            + boundary
                            + "\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference."
                            + mime.substring(6)
                            + "\"\r\nContent-Type: "
                            + mime
                            + "\r\n\r\n");
            body.writeBytes(bytes);
            write(body, "\r\n");
            if (body.size() > maxInput) throw fail("INPUT_BUDGET_EXCEEDED", false);
        }
        write(body, "--" + boundary + "--\r\n");
        if (body.size() > maxInput) throw fail("INPUT_BUDGET_EXCEEDED", false);
        var request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(Duration.ofSeconds(seconds))
                        .header("Authorization", "Bearer " + setting(config, "imageApiKey"))
                        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                        .build();
        var response = send(request, maxResponse, seconds, "IMAGE_PROVIDER_FAILED", true);
        return imageResult(response.body(), "data", endpoint, seconds, maxResponse);
    }

    private byte[] generateSiliconFlow(
            Map<String, Object> config,
            String prompt,
            List<Image> images,
            URI endpoint,
            int seconds,
            int maxInput,
            int maxResponse) {
        // This protocol exposes exactly one reference image. Never truncate a clothing list.
        if (images.size() != 1) throw fail("INPUT_BUDGET_EXCEEDED", false);
        var payload = new LinkedHashMap<String, Object>();
        payload.put("model", setting(config, "imageModel"));
        payload.put("prompt", prompt);
        payload.put("image", checkedUrl(images.getFirst().getUrl(), endpoint).toString());
        if (!(config.get("imageParameters") instanceof Map<?, ?> parameters))
            throw fail("GENERATION_UNAVAILABLE", false);
        for (var entry : parameters.entrySet()) {
            if (!(entry.getKey() instanceof String key)
                    || !Set.of("image_size", "num_inference_steps", "guidance_scale").contains(key))
                throw fail("GENERATION_UNAVAILABLE", false);
            Object value = entry.getValue();
            try {
                if (key.equals("image_size")) {
                    if (!(value instanceof String size) || !size.matches("[1-9][0-9]*x[1-9][0-9]*"))
                        throw new IllegalArgumentException();
                    payload.put(key, value);
                } else if (key.equals("num_inference_steps")) {
                    int steps = Integer.parseInt(value.toString());
                    if (steps < 1 || steps > 100) throw new IllegalArgumentException();
                    payload.put(key, steps);
                } else {
                    double scale = Double.parseDouble(value.toString());
                    if (!Double.isFinite(scale) || scale < 0 || scale > 20)
                        throw new IllegalArgumentException();
                    payload.put(key, scale);
                }
            } catch (RuntimeException e) {
                throw fail("GENERATION_UNAVAILABLE", false);
            }
        }
        byte[] bytes = JSON.writeValueAsBytes(payload);
        if (bytes.length > maxInput) throw fail("INPUT_BUDGET_EXCEEDED", false);
        var request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(Duration.ofSeconds(seconds))
                        .header("Authorization", "Bearer " + setting(config, "imageApiKey"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
                        .build();
        var response = send(request, maxResponse, seconds, "IMAGE_PROVIDER_FAILED", true);
        return imageResult(response.body(), "images", endpoint, seconds, maxResponse);
    }

    private byte[] imageResult(
            byte[] response, String field, URI endpoint, int seconds, int maxResponse) {
        try {
            var data = JSON.readTree(response).path(field);

            if (!data.isArray() || data.size() != 1) throw fail("EXTERNAL_RESULT_UNKNOWN", true);
            var result = data.path(0);
            byte[] bytes;
            if (result.path("b64_json").isString())
                bytes = Base64.getDecoder().decode(result.path("b64_json").asText());
            else if (result.path("url").isString()) {
                var download =
                        HttpRequest.newBuilder(checkedUrl(result.path("url").asText(), endpoint))
                                .timeout(Duration.ofSeconds(seconds))
                                .GET()
                                .build();
                // Generation already happened: retrieval failure must not allow another POST.
                bytes =
                        send(download, maxResponse, seconds, "EXTERNAL_RESULT_UNKNOWN", true)
                                .body();
            } else throw fail("EXTERNAL_RESULT_UNKNOWN", true);
            if (bytes.length > maxResponse) throw fail("EXTERNAL_RESULT_UNKNOWN", true);
            imageMime(bytes);
            return bytes;
        } catch (RuntimeException e) {
            throw fail("EXTERNAL_RESULT_UNKNOWN", true);
        }
    }

    private HttpResponse<byte[]> send(
            HttpRequest request,
            int maxBytes,
            int seconds,
            String rejectedCode,
            boolean ambiguous) {
        try {
            var response = BoundedHttp.send(http, request, maxBytes, seconds);
            if (response.statusCode() >= 200 && response.statusCode() < 300) return response;
            boolean unknown =
                    ambiguous && (response.statusCode() >= 500 || response.statusCode() == 408);
            throw fail(unknown ? "EXTERNAL_RESULT_UNKNOWN" : rejectedCode, unknown);
        } catch (GenerationFailure e) {
            throw e;
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            if ("PLAN_PROVIDER_FAILED".equals(rejectedCode)) {
                for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                    if (cause instanceof BoundedHttp.BodyTooLargeException)
                        throw fail("PLAN_OUTPUT_INVALID", false);
                }
            }
            throw fail(ambiguous ? "EXTERNAL_RESULT_UNKNOWN" : rejectedCode, ambiguous);
        }
    }

    private static void checkImages(Map<String, Object> config, List<Image> images, String limit) {
        if (images == null || images.isEmpty() || images.size() > positive(config, limit))
            throw fail("INPUT_BUDGET_EXCEEDED", false);
        Set<String> ids = new HashSet<>();
        for (var image : images)
            if (image == null
                    || image.getImageId() == null
                    || image.getImageId().contains("\n")
                    || image.getImageId().contains("\r")
                    || !ids.add(image.getImageId())) throw fail("INPUT_BUDGET_EXCEEDED", false);
    }

    private static URI endpoint(Map<String, Object> config, String key) {
        try {
            URI uri = URI.create(setting(config, key));
            if (uri.getHost() == null
                    || uri.getUserInfo() != null
                    || uri.getFragment() != null
                    || !("https".equals(uri.getScheme())
                            || ("http".equals(uri.getScheme()) && loopback(uri.getHost()))))
                throw fail("GENERATION_UNAVAILABLE", false);
            return uri;
        } catch (IllegalArgumentException e) {
            throw fail("GENERATION_UNAVAILABLE", false);
        }
    }

    private static URI checkedUrl(String value, URI endpoint) {
        try {
            URI uri = URI.create(value);
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null)
                throw fail("IMAGE_INPUT_UNAVAILABLE", false);
            // Local fake providers may only use their exact origin; remote suppliers cannot fetch
            // private hosts.
            if ("http".equals(endpoint.getScheme())
                    && loopback(endpoint.getHost())
                    && Objects.equals(uri.getHost(), endpoint.getHost())
                    && uri.getPort() == endpoint.getPort()
                    && "http".equals(uri.getScheme())) return uri;
            if (!"https".equals(uri.getScheme())) throw fail("IMAGE_INPUT_UNAVAILABLE", false);
            for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                byte[] bytes = address.getAddress();
                if (address.isAnyLocalAddress()
                        || address.isLoopbackAddress()
                        || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress()
                        || address.isMulticastAddress()
                        || (bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc))
                    throw fail("IMAGE_INPUT_UNAVAILABLE", false);
            }
            return uri;
        } catch (Exception e) {
            throw fail("IMAGE_INPUT_UNAVAILABLE", false);
        }
    }

    private static boolean loopback(String host) {
        return Set.of("localhost", "127.0.0.1", "[::1]", "::1").contains(host);
    }

    private static String imageMime(byte[] bytes) {
        if (bytes.length >= 8
                && bytes[0] == (byte) 0x89
                && bytes[1] == 'P'
                && bytes[2] == 'N'
                && bytes[3] == 'G') return "image/png";
        if (bytes.length >= 3
                && bytes[0] == (byte) 0xff
                && bytes[1] == (byte) 0xd8
                && bytes[2] == (byte) 0xff) return "image/jpeg";
        if (bytes.length >= 12
                && new String(bytes, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
                && new String(bytes, 8, 4, StandardCharsets.US_ASCII).equals("WEBP"))
            return "image/webp";
        throw fail("IMAGE_INPUT_UNAVAILABLE", false);
    }

    private static void field(
            ByteArrayOutputStream out, String boundary, String key, String value) {
        write(
                out,
                "--"
                        + boundary
                        + "\r\nContent-Disposition: form-data; name=\""
                        + key
                        + "\"\r\n\r\n"
                        + value
                        + "\r\n");
    }

    private static void write(ByteArrayOutputStream out, String value) {
        out.writeBytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private static int positive(Map<String, Object> config, String key) {
        if (!(config.get(key) instanceof Number n)
                || n.longValue() < 1
                || n.longValue() > Integer.MAX_VALUE) throw fail("GENERATION_UNAVAILABLE", false);
        return ((Number) config.get(key)).intValue();
    }

    private static String setting(Map<String, Object> config, String key) {
        if (!(config.get(key) instanceof String text) || text.isBlank())
            throw fail("GENERATION_UNAVAILABLE", false);
        return (String) config.get(key);
    }

    private static GenerationFailure fail(String code, boolean uncertain) {
        return new GenerationFailure(code, uncertain);
    }
}
