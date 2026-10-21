package cc.riskswap.lookmate.common.util;

import java.io.ByteArrayOutputStream;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Enforces both total response bytes and total wall-clock request time. */
public final class BoundedHttp {
    private BoundedHttp() {}

    public static HttpResponse<byte[]> send(
            HttpClient client, HttpRequest request, int maxBytes, int seconds) throws Exception {
        var future = client.sendAsync(request, info -> new LimitedBody(maxBytes));
        try {
            return future.get(seconds, TimeUnit.SECONDS);
        } catch (Exception e) {
            future.cancel(true);
            throw e;
        }
    }

    public static final class BodyTooLargeException extends java.io.IOException {
        BodyTooLargeException() {
            super("Response body limit exceeded");
        }
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final int max;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private Flow.Subscription subscription;

        LimitedBody(int max) {
            this.max = max;
        }

        public CompletionStage<byte[]> getBody() {
            return result;
        }

        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(1);
        }

        public void onNext(List<ByteBuffer> buffers) {
            for (var buffer : buffers) {
                if (buffer.remaining() > max - bytes.size()) {
                    subscription.cancel();
                    result.completeExceptionally(new BodyTooLargeException());
                    return;
                }
                byte[] chunk = new byte[buffer.remaining()];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }

        public void onError(Throwable error) {
            result.completeExceptionally(error);
        }

        public void onComplete() {
            result.complete(bytes.toByteArray());
        }
    }
}
