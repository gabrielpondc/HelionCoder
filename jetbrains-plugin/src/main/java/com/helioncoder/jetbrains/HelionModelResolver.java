package com.helioncoder.jetbrains;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class HelionModelResolver {
    private final Project project;
    private volatile List<ModelCandidate> cachedModels;

    public HelionModelResolver(@NotNull Project project) {
        this.project = project;
    }

    public record ModelCandidate(String id, String label, String source, String description) {
    }

    public void invalidate() {
        cachedModels = null;
    }

    public @NotNull List<ModelCandidate> listModels(boolean refreshApi) {
        if (!refreshApi) {
            List<ModelCandidate> cached = cachedModels;
            if (cached != null) {
                return cached;
            }
        }


        List<ModelCandidate> models = new ArrayList<>();
        DefaultModelInfo defaultModel = defaultModelInfo();
        models.add(new ModelCandidate(
            "default",
            "命令行默认：" + defaultModel.id(),
            defaultModel.source(),
            "不传 --model，让 HelionCoder CLI 按当前配置解析默认模型。"
        ));

        if (refreshApi) {
            models.addAll(fetchApiModels());
        }
        addConfiguredModels(models);
        addEnvironmentModels(models);
        addFileModels(models);

        List<ModelCandidate> deduped = dedupe(models);
        String selected = HelionSettings.model();
        if (!selected.isBlank() && deduped.stream().noneMatch(model -> model.id().equalsIgnoreCase(selected))) {
            List<ModelCandidate> withSelected = new ArrayList<>();
            withSelected.add(new ModelCandidate(selected, selected, "当前选择", "当前 JetBrains 插件选择的模型。"));
            withSelected.addAll(deduped);
            deduped = List.copyOf(withSelected);
        }
        cachedModels = deduped;
        return deduped;
    }

    private void addConfiguredModels(@NotNull List<ModelCandidate> models) {
        addModel(models, HelionSettings.model(), "JetBrains 设置");
    }

    private void addEnvironmentModels(@NotNull List<ModelCandidate> models) {
        for (String key : List.of(
            "OPENAI_MODEL",
            "OPENAI_SMALL_MODEL",
            "OPENAI_MM_MODEL",
            "OPENAI_MULTIMODAL_MODEL",
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_SMALL_FAST_MODEL"
        )) {
            addModel(models, System.getenv(key), "环境变量 " + key);
        }
    }

    private void addFileModels(@NotNull List<ModelCandidate> models) {
        for (Path file : configFileCandidates()) {
            JsonObject data = readJson(file);
            if (data == null) {
                continue;
            }
            collectModelsFromObject(data, shortPath(file), models);
        }
    }

    private @NotNull List<ModelCandidate> fetchApiModels() {
        EndpointConfig endpoint = endpointConfig();
        if (endpoint.apiKey() == null) {
            return List.of();
        }

        try {
            String url = modelsUrl(endpoint.baseUrl() == null ? "https://api.openai.com/v1" : endpoint.baseUrl());
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + endpoint.apiKey())
                .header("Accept", "application/json")
                .GET()
                .build();
            HttpResponse<String> response = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build()
                .send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return List.of();
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            JsonArray rawModels = parsed.isJsonArray()
                ? parsed.getAsJsonArray()
                : parsed.isJsonObject() && parsed.getAsJsonObject().has("data") && parsed.getAsJsonObject().get("data").isJsonArray()
                    ? parsed.getAsJsonObject().getAsJsonArray("data")
                    : null;
            if (rawModels == null) {
                return List.of();
            }

            List<String> ids = new ArrayList<>();
            for (JsonElement item : rawModels) {
                String id = null;
                if (item.isJsonPrimitive()) {
                    id = item.getAsString();
                } else if (item.isJsonObject() && item.getAsJsonObject().has("id")) {
                    id = string(item.getAsJsonObject(), "id");
                }
                if (id != null && !id.isBlank()) {
                    ids.add(id.trim());
                }
            }
            ids.sort(String::compareTo);
            String source = URI.create(url).getHost();
            List<ModelCandidate> result = new ArrayList<>();
            for (String id : ids) {
                result.add(new ModelCandidate(id, id, source, "从 OpenAI 兼容 /models 端点检测到。"));
            }
            return result;
        } catch (IOException | InterruptedException | URISyntaxException | RuntimeException error) {
            if (error instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return List.of();
        }
    }

    private @NotNull EndpointConfig endpointConfig() {
        String fileApiKey = null;
        String fileBaseUrl = null;
        for (Path file : configFileCandidates()) {
            JsonObject data = readJson(file);
            if (data == null) {
                continue;
            }
            JsonObject openai = object(data, "openai");
            fileApiKey = firstString(fileApiKey, string(data, "openaiApiKey"), string(data, "primaryApiKey"), string(data, "apiKey"), string(data, "api_key"), string(openai, "apiKey"), string(openai, "api_key"), string(openai, "token"));
            fileBaseUrl = firstString(fileBaseUrl, string(data, "openaiBaseUrl"), string(data, "openaiModelOptionsCacheBaseUrl"), string(data, "baseUrl"), string(data, "baseURL"), string(data, "apiBaseUrl"), string(openai, "baseUrl"), string(openai, "baseURL"), string(openai, "apiBaseUrl"));
        }

        return new EndpointConfig(
            firstString(System.getenv("OPENAI_API_KEY"), fileApiKey, System.getenv("ANTHROPIC_API_KEY")),
            firstString(System.getenv("OPENAI_BASE_URL"), fileBaseUrl, System.getenv("ANTHROPIC_BASE_URL"))
        );
    }

    private @NotNull DefaultModelInfo defaultModelInfo() {
        String anthropic = firstString(System.getenv("ANTHROPIC_MODEL"));
        if (anthropic != null) {
            return new DefaultModelInfo(anthropic, "环境变量 ANTHROPIC_MODEL");
        }

        for (Path file : configFileCandidates()) {
            JsonObject data = readJson(file);
            String model = data == null ? null : firstString(string(data, "model"));
            if (model != null) {
                return new DefaultModelInfo(model, shortPath(file));
            }
        }

        String openai = firstString(System.getenv("OPENAI_MODEL"));
        if (openai != null) {
            return new DefaultModelInfo(openai, "环境变量 OPENAI_MODEL");
        }

        for (Path file : configFileCandidates()) {
            JsonObject data = readJson(file);
            if (data == null) {
                continue;
            }
            JsonObject openaiConfig = object(data, "openai");
            String configured = firstString(string(data, "openaiModel"), string(openaiConfig, "model"));
            if (configured != null) {
                return new DefaultModelInfo(configured, shortPath(file));
            }
        }

        return new DefaultModelInfo("gpt-5.4", "内置默认");
    }

    private @NotNull List<Path> configFileCandidates() {
        String home = System.getProperty("user.home");
        String configHome = firstString(System.getenv("HELIONCODER_CONFIG_DIR"), Paths.get(home, ".helioncoder").toString());
        List<Path> roots = new ArrayList<>();
        roots.add(Paths.get(configHome));

        String basePath = project.getBasePath();
        List<Path> workspaceRoots = new ArrayList<>();
        if (basePath != null) {
            workspaceRoots.add(Paths.get(basePath));
        }

        List<Path> files = new ArrayList<>();
        for (Path root : roots) {
            files.add(root.resolve("config.json"));
            files.add(root.resolve("settings.json"));
            files.add(root.resolve("settings.local.json"));
            files.add(root.resolve(".config.json"));
        }
        for (Path root : workspaceRoots) {
            files.add(root.resolve(".helioncoder").resolve("settings.json"));
            files.add(root.resolve(".helioncoder").resolve("settings.local.json"));
            files.add(root.resolve(".helion-models.json"));
        }
        return files;
    }

    private static void collectModelsFromObject(
        @NotNull JsonObject data,
        @NotNull String source,
        @NotNull List<ModelCandidate> models
    ) {
        addModel(models, string(data, "model"), source);
        addModel(models, string(data, "openaiModel"), source);
        addModel(models, string(data, "openaiSmallModel"), source);
        addModel(models, string(data, "openaiMultimodalModel"), source);
        addArrayModels(models, array(data, "openaiModelOptionsCache"), source + " /v1/models 缓存");
        addArrayModels(models, array(data, "availableModels"), source + " 可用模型");
        addArrayModels(models, array(data, "models"), source + " 模型");

        JsonObject openai = object(data, "openai");
        if (openai != null) {
            addModel(models, string(openai, "model"), source + " OpenAI 配置");
            addModel(models, string(openai, "smallModel"), source + " OpenAI 配置");
            addArrayModels(models, array(openai, "models"), source + " OpenAI 模型");
        }

        JsonObject overrides = object(data, "modelOverrides");
        if (overrides != null) {
            for (Map.Entry<String, JsonElement> entry : overrides.entrySet()) {
                if (entry.getValue().isJsonPrimitive()) {
                    addModel(models, entry.getValue().getAsString(), source + " 模型覆盖");
                }
            }
        }
    }

    private static void addArrayModels(@NotNull List<ModelCandidate> models, @Nullable JsonArray array, @NotNull String source) {
        if (array == null) {
            return;
        }
        for (JsonElement item : array) {
            if (item.isJsonPrimitive()) {
                addModel(models, item.getAsString(), source);
            } else if (item.isJsonObject()) {
                addModel(models, string(item.getAsJsonObject(), "id"), source);
            }
        }
    }

    private static void addModel(@NotNull List<ModelCandidate> models, @Nullable String value, @NotNull String source) {
        String id = value == null ? "" : value.trim();
        if (!id.isEmpty()) {
            models.add(new ModelCandidate(id, id, source, null));
        }
    }

    private static @NotNull List<ModelCandidate> dedupe(@NotNull List<ModelCandidate> models) {
        Map<String, ModelCandidate> seen = new LinkedHashMap<>();
        for (ModelCandidate model : models) {
            seen.putIfAbsent(model.id().toLowerCase(Locale.ROOT), model);
        }
        return List.copyOf(seen.values());
    }

    private static @Nullable JsonObject readJson(@NotNull Path file) {
        try {
            if (!Files.isRegularFile(file)) {
                return null;
            }
            String raw = Files.readString(file, StandardCharsets.UTF_8).trim();
            if (raw.isEmpty()) {
                return new JsonObject();
            }
            JsonElement parsed = JsonParser.parseString(raw);
            return parsed.isJsonObject() ? parsed.getAsJsonObject() : null;
        } catch (IOException | RuntimeException ignored) {
            return null;
        }
    }

    private static @NotNull String modelsUrl(@NotNull String baseUrl) throws URISyntaxException {
        URI uri = new URI(baseUrl);
        String path = uri.getPath() == null ? "" : uri.getPath().replaceAll("/+$", "");
        for (String suffix : List.of("/responses", "/models", "/chat/completions", "/completions")) {
            if (path.endsWith(suffix)) {
                path = path.substring(0, path.length() - suffix.length());
                break;
            }
        }
        path = path.endsWith("/v1") ? path + "/models" : (path + "/v1/models").replaceAll("/{2,}", "/");
        return new URI(uri.getScheme(), uri.getUserInfo(), uri.getHost(), uri.getPort(), path, null, null).toString();
    }

    private static @Nullable JsonObject object(@Nullable JsonObject object, @NotNull String key) {
        return object != null && object.has(key) && object.get(key).isJsonObject() ? object.getAsJsonObject(key) : null;
    }

    private static @Nullable JsonArray array(@Nullable JsonObject object, @NotNull String key) {
        return object != null && object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : null;
    }

    private static @Nullable String string(@Nullable JsonObject object, @NotNull String key) {
        if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) {
            return null;
        }
        try {
            return object.get(key).getAsString();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static @Nullable String firstString(@Nullable String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }

    private static @NotNull String shortPath(@NotNull Path file) {
        String home = System.getProperty("user.home");
        String value = file.toString();
        return value.startsWith(home) ? "~" + value.substring(home.length()) : value;
    }

    private record EndpointConfig(@Nullable String apiKey, @Nullable String baseUrl) {
    }

    private record DefaultModelInfo(@NotNull String id, @NotNull String source) {
    }
}
