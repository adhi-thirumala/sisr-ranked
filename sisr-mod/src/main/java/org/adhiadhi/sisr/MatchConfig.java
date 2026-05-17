package org.adhiadhi.sisr;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import net.minecraft.server.MinecraftServer;

public record MatchConfig(
    String matchId,
    String targetItem,
    Set<UUID> allowedPlayers,
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
        Collections.emptySet(),
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

  private static Set<UUID> parseAllowedPlayers() {
    String value = env("ALLOWED_UUIDS", "");
    if (value.isBlank()) {
      return Collections.emptySet();
    }

    Set<UUID> uuids = new LinkedHashSet<>();
    for (String raw : value.split(",")) {
      UUID uuid = parseUuid(raw.trim());
      if (uuid != null) {
        uuids.add(uuid);
      }
    }
    return Collections.unmodifiableSet(uuids);
  }

  private static UUID parseUuid(String value) {
    if (value.isBlank()) {
      return null;
    }
    try {
      if (value.length() == 32) {
        value = value.substring(0, 8) + "-" + value.substring(8, 12) + "-" +
            value.substring(12, 16) + "-" + value.substring(16, 20) + "-" + value.substring(20);
      }
      return UUID.fromString(value);
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
