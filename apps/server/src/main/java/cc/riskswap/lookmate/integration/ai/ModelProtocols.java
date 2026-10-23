package cc.riskswap.lookmate.integration.ai;

import java.net.URI;
import java.util.Set;

/** Supported wire protocols; provider labels do not select transport behavior. */
public final class ModelProtocols {
    public static final String CHAT = "openai-chat";
    public static final String EDITS = "openai-edits";
    public static final String SILICONFLOW_IMAGES = "siliconflow-images";

    private ModelProtocols() {}

    public static boolean imageSupported(String protocol) {
        return EDITS.equals(protocol) || SILICONFLOW_IMAGES.equals(protocol);
    }

    public static boolean validEndpoint(String value) {
        try {
            URI uri = URI.create(value);
            return uri.getHost() != null
                    && uri.getUserInfo() == null
                    && uri.getFragment() == null
                    && ("https".equals(uri.getScheme())
                            || ("http".equals(uri.getScheme())
                                    && Set.of("localhost", "127.0.0.1", "[::1]", "::1")
                                            .contains(uri.getHost())));
        } catch (RuntimeException e) {
            return false;
        }
    }
}
