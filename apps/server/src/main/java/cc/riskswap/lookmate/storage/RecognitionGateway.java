package cc.riskswap.lookmate.storage;

import java.util.List;
import java.util.Map;

public interface RecognitionGateway {
    record Image(String imageId, String url) {}

    record Result(String requestId, Map<String, Map<String, Object>> features) {}

    Result recognize(String model, List<Image> images) throws Exception;
}
