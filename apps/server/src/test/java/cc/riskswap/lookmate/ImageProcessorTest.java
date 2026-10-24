package cc.riskswap.lookmate;

import static org.assertj.core.api.Assertions.*;

import cc.riskswap.lookmate.common.util.*;
import cc.riskswap.lookmate.integration.ai.*;
import cc.riskswap.lookmate.integration.storage.*;
import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class ImageProcessorTest {
    private final GeneratedImageValidator processor = new GeneratedImageValidator();

    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    @Test
    void acceptsJpegWithTrailingImageData() throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(40, 20, BufferedImage.TYPE_INT_RGB), "jpeg", out);
        // Camera files can have an extra image marker after the main JPEG ends.
        out.write(new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9});
        var result = processor.validate(out.toByteArray());
        assertThat(result.width()).isEqualTo(40);
        assertThat(result.height()).isEqualTo(20);
        assertThat(ImageIO.read(new ByteArrayInputStream(result.bytes()))).isNotNull();
        assertThat(result.bytes()).containsExactly(out.toByteArray());
    }

    @Test
    void retainsOriginalTransparentPngBytes() throws Exception {
        var source = new BufferedImage(640, 320, BufferedImage.TYPE_INT_ARGB);
        var out = new ByteArrayOutputStream();
        ImageIO.write(source, "png", out);
        var original = out.toByteArray();
        var result = processor.validate(original);
        assertThat(result.bytes()).containsExactly(original);
        assertThat(result.mimeType()).isEqualTo("image/png");
        assertThat(result.width()).isEqualTo(640);
        assertThat(
                        ImageIO.read(new ByteArrayInputStream(result.bytes()))
                                .getColorModel()
                                .hasAlpha())
                .isTrue();
    }

    @Test
    void rejectsBrokenJpeg() {
        assertThatThrownBy(
                        () ->
                                processor.validate(
                                        new byte[] {
                                            (byte) 255, (byte) 216, (byte) 255, (byte) 217
                                        }))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void rejectsUnsupportedMalformedAndAnimated() throws Exception {
        assertThatThrownBy(() -> processor.validate("<svg/>".getBytes()))
                .isInstanceOf(InvalidImageException.class);
        var png = png(2, 2);
        byte[] animated = new byte[png.length + 12];
        System.arraycopy(png, 0, animated, 0, 8);
        System.arraycopy("acTL".getBytes(), 0, animated, 12, 4);
        System.arraycopy(png, 8, animated, 20, png.length - 8);
        assertThatThrownBy(() -> processor.validate(animated)).hasMessage("不支持动态图片");
        var webp = "RIFFxxxxxxxxWEBP".getBytes();
        assertThatThrownBy(() -> processor.validate(webp))
                .isInstanceOf(InvalidImageException.class);
        assertThatThrownBy(
                        () -> processor.validate(new byte[GeneratedImageValidator.MAX_BYTES + 1]))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void acceptsStaticWebpAndRejectsAnimatedWebp() throws Exception {
        var still =
                processor.validate(
                        java.util.Base64.getDecoder()
                                .decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQvJKVsf+BiOh/AAA="));
        assertThat(still.width()).isEqualTo(2);
        assertThat(still.height()).isEqualTo(3);
        assertThatThrownBy(
                        () ->
                                processor.validate(
                                        java.util.Base64.getDecoder()
                                                .decode(
                                                        "UklGRrYAAABXRUJQVlA4WAoAAAACAAAAAQAAAgAAQU5JTQYAAAAAAAAAAABBTk1GPAAAAAAAAAAAAAEAAAIAAGQAAAJWUDggJAAAADABAJ0BKgIAAwABQCYlAACMMAD+4uC/61ytWlW/9eqWuTcAAEFOTUZGAAAAAAAAAAAAAQAAAgAAZAAAAFZQOCAuAAAANAEAnQEqAgADAAAAJiWgAANwAP7xTa//rb8c/mupv//3jP//uM//+4z/5EAAAA==")))
                .hasMessage("不支持动态图片");
    }

    @Test
    void rejectsPixelBombBeforeDecoding() throws Exception {
        byte[] image = png(2, 2);
        var buffer = java.nio.ByteBuffer.wrap(image);
        buffer.putInt(16, 100000);
        buffer.putInt(20, 100000);
        var crc = new java.util.zip.CRC32();
        crc.update(image, 12, 17);
        buffer.putInt(29, (int) crc.getValue());
        assertThatThrownBy(() -> processor.validate(image)).hasMessage("图片像素超过限制");
    }
}
