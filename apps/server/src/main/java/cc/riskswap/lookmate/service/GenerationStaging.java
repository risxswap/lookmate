package cc.riskswap.lookmate.service;

import cc.riskswap.lookmate.config.GenerationProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;

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
}
