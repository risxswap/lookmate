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
    private final ImageProcessor processor = new ImageProcessor();

    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    @Test
    void normalizesAndThumbnails() throws Exception {
        var r = processor.process(png(640, 320));
        assertThat(r.width()).isEqualTo(640);
        assertThat(r.height()).isEqualTo(320);
        var thumb = ImageIO.read(new ByteArrayInputStream(r.thumbnail()));
        assertThat(thumb.getWidth()).isEqualTo(320);
        assertThat(thumb.getHeight()).isEqualTo(160);
        assertThat(r.display()[0]).isEqualTo((byte) 255);
    }

    @Test
    void rejectsUnsupportedMalformedAndAnimated() throws Exception {
        assertThatThrownBy(() -> processor.process("<svg/>".getBytes()))
                .isInstanceOf(InvalidImageException.class);
        var png = png(2, 2);
        byte[] animated = new byte[png.length + 12];
        System.arraycopy(png, 0, animated, 0, 8);
        System.arraycopy("acTL".getBytes(), 0, animated, 12, 4);
        System.arraycopy(png, 8, animated, 20, png.length - 8);
        assertThatThrownBy(() -> processor.process(animated)).hasMessage("不支持动态图片");
        var webp = "RIFFxxxxxxxxWEBP".getBytes();
        assertThatThrownBy(() -> processor.process(webp)).isInstanceOf(InvalidImageException.class);
        assertThatThrownBy(() -> processor.process(new byte[ImageProcessor.MAX_BYTES + 1]))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void acceptsStaticWebpAndRejectsAnimatedWebp() throws Exception {
        var still =
                processor.process(
                        java.util.Base64.getDecoder()
                                .decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQvJKVsf+BiOh/AAA="));
        assertThat(still.width()).isEqualTo(2);
        assertThat(still.height()).isEqualTo(3);
        assertThatThrownBy(
                        () ->
                                processor.process(
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
        assertThatThrownBy(() -> processor.process(image)).hasMessage("图片像素超过限制");
    }

    @Test
    void appliesExifOrientationAndDropsMetadata() throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(30, 20, BufferedImage.TYPE_INT_RGB), "jpeg", out);
        byte[] original = out.toByteArray();
        // EXIF little-endian IFD0 orientation = 6 (90 degrees clockwise).
        byte[] exif = {
            (byte) 255,
            (byte) 225,
            0,
            34,
            69,
            120,
            105,
            102,
            0,
            0,
            73,
            73,
            42,
            0,
            8,
            0,
            0,
            0,
            1,
            0,
            18,
            1,
            3,
            0,
            1,
            0,
            0,
            0,
            6,
            0,
            0,
            0,
            0,
            0,
            0,
            0
        };
        var annotated = new ByteArrayOutputStream();
        annotated.write(original, 0, 2);
        annotated.write(exif);
        annotated.write(original, 2, original.length - 2);
        var result = processor.process(annotated.toByteArray());
        assertThat(result.width()).isEqualTo(20);
        assertThat(result.height()).isEqualTo(30);
        var metadata =
                com.drew.imaging.ImageMetadataReader.readMetadata(
                        new ByteArrayInputStream(result.display()));
        assertThat(metadata.getFirstDirectoryOfType(com.drew.metadata.exif.ExifIFD0Directory.class))
                .isNull();
    }
}
