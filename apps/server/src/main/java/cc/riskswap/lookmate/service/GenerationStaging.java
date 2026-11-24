package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.GenerationProperties;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;

final class GenerationStaging {
    private GenerationStaging() {}

    static Path directory(GenerationProperties properties) {
        return Path.of(properties.getStagingDirectory()).toAbsolutePath().normalize();
    }

    static boolean hasSpace(GenerationProperties properties) {
        try {
            Path directory = Files.createDirectories(directory(properties));
            return Files.isWritable(directory)
                    && Files.getFileStore(directory).getUsableSpace()
                            >= properties.getMinFreeBytes();
        } catch (IOException | InvalidPathException e) {
            return false;
        }
    }

    static void writeDurable(Path path, byte[] bytes, int responseLimit) throws IOException {
        if (bytes.length == 0 || bytes.length > responseLimit)
            throw new IOException("Output image exceeds budget");
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        var channel =
                FileChannel.open(
                        temporary,
                        StandardOpenOption.CREATE,
                        StandardOpenOption.TRUNCATE_EXISTING,
                        StandardOpenOption.WRITE,
                        LinkOption.NOFOLLOW_LINKS);
        try {
            try (channel) {
                var buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(
                    temporary,
                    path,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            try {
                Files.deleteIfExists(temporary);
            } catch (IOException cleanupFailure) {
                failure.addSuppressed(cleanupFailure);
            }
            throw failure;
        }
        try (var dir = FileChannel.open(path.getParent(), StandardOpenOption.READ)) {
            dir.force(true);
        }
    }
}
