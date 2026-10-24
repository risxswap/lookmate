package cc.riskswap.lookmate.integration.storage;

import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

/** Validates provider outputs without rewriting their bytes; never runs during upload. */
@Component
public class GeneratedImageValidator {
    public static final int MAX_BYTES = 20 * 1024 * 1024;

    public record Validated(byte[] bytes, String mimeType, int width, int height) {}

    public Validated validate(byte[] input) throws IOException {
        if (input.length == 0 || input.length > MAX_BYTES)
            throw new InvalidImageException("图片超过大小限制");
        rejectAnimation(input);
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(input))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new InvalidImageException("图片内容不是支持的格式");
            var reader = readers.next();
            try {
                String format = reader.getFormatName().toUpperCase(java.util.Locale.ROOT);
                if (!java.util.Set.of("JPEG", "JPG", "PNG", "WEBP").contains(format))
                    throw new InvalidImageException("图片格式不支持");
                reader.setInput(stream, false, false);
                int w = reader.getWidth(0), h = reader.getHeight(0);
                if (w <= 0 || h <= 0 || (long) w * h > 25_000_000)
                    throw new InvalidImageException("图片像素超过限制");
                // JPEG may contain trailing camera data; a second image marker is not animation.
                // APNG and WebP animation is checked by container markers before decoding.
                BufferedImage decoded = reader.read(0);
                if (decoded == null) throw new InvalidImageException("图片损坏或无法解码");
                String mime =
                        switch (format) {
                            case "JPEG", "JPG" -> "image/jpeg";
                            case "PNG" -> "image/png";
                            default -> "image/webp";
                        };
                return new Validated(input, mime, w, h);
            } finally {
                reader.dispose();
            }
        } catch (InvalidImageException e) {
            throw e;
        } catch (RuntimeException | IOException e) {
            throw new InvalidImageException("图片损坏或无法解码");
        }
    }

    private static void rejectAnimation(byte[] b) throws InvalidImageException {
        // APNG and animated WebP can otherwise be silently decoded as their first frame.
        if (b.length >= 8 && b[0] == (byte) 137 && b[1] == 'P') {
            for (int p = 8; p + 12 <= b.length; ) {
                long n =
                        ((long) (b[p] & 255) << 24)
                                | ((long) (b[p + 1] & 255) << 16)
                                | ((long) (b[p + 2] & 255) << 8)
                                | (b[p + 3] & 255);
                String type = new String(b, p + 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
                if (type.equals("acTL")) throw new InvalidImageException("不支持动态图片");
                if (n > b.length - p - 12) throw new InvalidImageException("图片损坏");
                p += (int) n + 12;
            }
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[8] == 'W') {
            for (int p = 12; p + 8 <= b.length; ) {
                long n =
                        (b[p + 4] & 255)
                                | ((long) (b[p + 5] & 255) << 8)
                                | ((long) (b[p + 6] & 255) << 16)
                                | ((long) (b[p + 7] & 255) << 24);
                String type = new String(b, p, 4, java.nio.charset.StandardCharsets.US_ASCII);
                if (type.equals("ANIM")
                        || type.equals("ANMF")
                        || type.equals("VP8X") && p + 8 < b.length && (b[p + 8] & 2) != 0)
                    throw new InvalidImageException("不支持动态图片");
                if (n > b.length - p - 8) throw new InvalidImageException("图片损坏");
                p += (int) n + 8 + (int) (n % 2);
            }
        }
    }
}
