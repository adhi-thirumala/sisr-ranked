package org.adhiadhi.sisr;

import com.mojang.util.UndashedUuid;
import java.util.Arrays;
import java.util.UUID;
import net.minecraft.server.MinecraftServer;

public record MatchConfig(
    String matchId,
    String targetItem,
    UUID[] allowedPlayers,
    String apiBase,
    String apiToken,
    String serverAddress,
    int timeoutTicks,
    int pregenRadius,
    boolean shutdownOnEnd) {

  private static final int DEFAULT_TIMEOUT_SECONDS = 15 * 60;

  public static MatchConfig manual(MinecraftServer server, String targetItem) {
    return new MatchConfig(
        "manual-" + server.getTickCount(),
        targetItem,
        new UUID[0],
        "",
        "",
        "",
        envInt("SISR_MATCH_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS) * 20,
        0,
        false);
  }

  public static MatchConfig fromEnvironment() {
    String targetItem = env("TARGET_ITEM", "");
    if (targetItem.isBlank()) {
      return null;
    }

    String matchId = env("MATCH_ID", "env-" + System.currentTimeMillis());
    String apiBase = env("API_BASE", env("SISR_API_BASE", ""));
    String apiToken = env("API_TOKEN", env("SISR_API_TOKEN", ""));
    String serverAddress = env("SERVER_ADDRESS", env("SISR_SERVER_ADDRESS", ""));
    int timeoutSeconds = envInt("MATCH_TIMEOUT_SECONDS", envInt("SISR_MATCH_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS));
    int pregenRadius = envInt("PREGEN_RADIUS", envInt("SISR_PREGEN_RADIUS", 12));
    return new MatchConfig(matchId, targetItem, parseAllowedPlayers(), apiBase, apiToken, serverAddress,
        timeoutSeconds * 20, pregenRadius, true);
  }

  public MatchConfig withTargetItem(String normalizedTargetItem) {
    return new MatchConfig(matchId, normalizedTargetItem, allowedPlayers, apiBase, apiToken, serverAddress,
        timeoutTicks, pregenRadius, shutdownOnEnd);
  }

  private static UUID[] parseAllowedPlayers() {
    String value = env("ALLOWED_UUIDS", "");
    if (value.isBlank()) {
      return new UUID[0];
    }

    String[] rawUuids = value.split(",");
    UUID[] uuids = new UUID[rawUuids.length];
    int count = 0;
    for (String raw : rawUuids) {
      UUID uuid = parseUuid(raw.trim());
      if (uuid != null) {
        uuids[count++] = uuid;
      }
    }
    return Arrays.copyOf(uuids, count);
  }

  private static UUID parseUuid(String value) {
    if (value.isBlank()) {
      return null;
    }
    try {
      return UndashedUuid.fromStringLenient(value);
    } catch (IllegalArgumentException ignored) {
      Sisr.LOGGER.warn("Ignoring invalid ALLOWED_UUIDS entry: {}", value);
      return null;
    }
  }

  private static int envInt(String name, int fallback) {
    try {
      String value = env(name, "");
      return value.isBlank() ? fallback : Integer.parseInt(value);
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }

  private static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null ? fallback : value.trim();
  }
}
