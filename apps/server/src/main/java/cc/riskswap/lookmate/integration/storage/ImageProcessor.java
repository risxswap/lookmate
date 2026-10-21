package cc.riskswap.lookmate.integration.storage;

import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.exif.ExifIFD0Directory;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

@Component
public class ImageProcessor {
    public static final int MAX_BYTES = 20 * 1024 * 1024;

    public record Processed(byte[] display, byte[] thumbnail, int width, int height) {}

    public Processed process(byte[] input) throws IOException {
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
                if (reader.getNumImages(true) != 1) throw new InvalidImageException("不支持动态图片");
                BufferedImage decoded = reader.read(0);
                int orientation = 1;
                try {
                    var directory =
                            ImageMetadataReader.readMetadata(new ByteArrayInputStream(input))
                                    .getFirstDirectoryOfType(ExifIFD0Directory.class);
                    if (directory != null
                            && directory.containsTag(ExifIFD0Directory.TAG_ORIENTATION))
                        orientation = directory.getInt(ExifIFD0Directory.TAG_ORIENTATION);
                } catch (Exception e) {
                    throw new InvalidImageException("图片元信息损坏");
                }
                var display = orient(decoded, orientation);
                double scale =
                        Math.min(1, 320.0 / Math.max(display.getWidth(), display.getHeight()));
                var thumb =
                        new BufferedImage(
                                Math.max(1, (int) (display.getWidth() * scale)),
                                Math.max(1, (int) (display.getHeight() * scale)),
                                BufferedImage.TYPE_INT_RGB);
                var g = thumb.createGraphics();
                try {
                    g.setRenderingHint(
                            RenderingHints.KEY_INTERPOLATION,
                            RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                    g.drawImage(display, 0, 0, thumb.getWidth(), thumb.getHeight(), null);
                } finally {
                    g.dispose();
                }
                return new Processed(
                        jpeg(display), jpeg(thumb), display.getWidth(), display.getHeight());
            } finally {
                reader.dispose();
            }
        } catch (InvalidImageException e) {
            throw e;
        } catch (RuntimeException | IOException e) {
            throw new InvalidImageException("图片损坏或无法解码");
        }
    }

    private static byte[] jpeg(BufferedImage image) throws IOException {
        var out = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "jpeg", out)) throw new IOException("JPEG writer unavailable");
        return out.toByteArray();
    }

    private static BufferedImage orient(BufferedImage src, int orientation) {
        boolean swap = orientation >= 5 && orientation <= 8;
        int w = src.getWidth(), h = src.getHeight();
        var out = new BufferedImage(swap ? h : w, swap ? w : h, BufferedImage.TYPE_INT_RGB);
        var g = out.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, out.getWidth(), out.getHeight());
        } finally {
            g.dispose();
        }
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                int dx = x, dy = y;
                switch (orientation) {
                    case 2 -> dx = w - 1 - x;
                    case 3 -> {
                        dx = w - 1 - x;
                        dy = h - 1 - y;
                    }
                    case 4 -> dy = h - 1 - y;
                    case 5 -> {
                        dx = y;
                        dy = x;
                    }
                    case 6 -> {
                        dx = h - 1 - y;
                        dy = x;
                    }
                    case 7 -> {
                        dx = h - 1 - y;
                        dy = w - 1 - x;
                    }
                    case 8 -> {
                        dx = y;
                        dy = w - 1 - x;
                    }
                    default -> {}
                }
                int c = src.getRGB(x, y), a = c >>> 24;
                int r = ((c >>> 16 & 255) * a + 255 * (255 - a)) / 255,
                        b = ((c & 255) * a + 255 * (255 - a)) / 255,
                        green = ((c >>> 8 & 255) * a + 255 * (255 - a)) / 255;
                out.setRGB(dx, dy, (r << 16) | (green << 8) | b);
            }
        return out;
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
