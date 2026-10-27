import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;

/** 将共享开发配置交给 Flyway，不在命令行参数中传递凭据。 */
public class RunMigration {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        String override = System.getenv("LOOKMATE_DEV_CONFIG");
        Path config = override == null
                ? root.resolve(".env.dev")
                : Path.of(override);
        if (!config.isAbsolute() || !Files.isRegularFile(config)) {
            throw new IllegalArgumentException("请准备共享开发配置，或用 LOOKMATE_DEV_CONFIG 指定现有文件的绝对路径");
        }
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(config)) {
            properties.load(input);
        }
        String url = required(properties, "spring.datasource.url");
        String user = required(properties, "spring.datasource.username");
        String password = properties.getProperty("spring.datasource.password");
        if (password == null) {
            throw new IllegalArgumentException("共享配置缺少 spring.datasource.password（无密码时可留空）");
        }
        ProcessBuilder builder = new ProcessBuilder(
                root.resolve("apps/server/mvnw").toString(), "-B", "-f",
                root.resolve("ops/pom.xml").toString(), "flyway:" + args[1]);
        Map<String, String> environment = builder.environment();
        environment.keySet().removeIf(key -> key.startsWith("FLYWAY_"));
        environment.put("FLYWAY_URL", url);
        environment.put("FLYWAY_USER", user);
        environment.put("FLYWAY_PASSWORD", password);
        environment.put("FLYWAY_CLEAN_DISABLED", "true");
        environment.put("FLYWAY_BASELINE_ON_MIGRATE", "false");
        System.exit(builder.inheritIO().start().waitFor());
    }

    private static String required(Properties properties, String key) {
        String value = properties.getProperty(key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("共享配置缺少 " + key);
        }
        return value;
    }
}
