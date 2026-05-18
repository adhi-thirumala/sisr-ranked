package org.adhiadhi.sisr;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import com.mojang.util.UndashedUuid;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.BossEvent;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.chunk.status.ChunkStatus;

public final class MatchGame {
  private static final int RESULT_TICKS = 10 * 20;
  private static final Gson GSON = new Gson();
  private static final HttpClient HTTP = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(2))
      .build();

  private final Set<UUID> claimsInFlight = ConcurrentHashMap.newKeySet();
  private MatchConfig config;
  private Item targetItem;
  private ServerBossEvent bossBar;
  private int startedTick;
  private int endingTicks = -1;
  private boolean checkedEnvironment;

  public boolean isRunning() {
    return config != null;
  }

  public boolean start(MinecraftServer server, MatchConfig rawConfig) {
    Identifier itemId = normalizeItemId(rawConfig.targetItem());
    if (itemId == null || !BuiltInRegistries.ITEM.containsKey(itemId) || "air".equals(itemId.getPath())) {
      return false;
    }

    clear();
    config = rawConfig.withTargetItem(itemId.toString());
    targetItem = BuiltInRegistries.ITEM.getValue(itemId);
    startedTick = server.getTickCount();
    endingTicks = -1;
    bossBar = new ServerBossEvent(UUID.randomUUID(), title("Current Item: " + config.targetItem()),
        BossEvent.BossBarColor.BLUE, BossEvent.BossBarOverlay.PROGRESS);
    bossBar.setProgress(1.0f);

    pregenerateSpawn(server, config.pregenRadius());
    notifyReady();
    broadcast(server, "Random Item Race started. Current Item: " + config.targetItem());
    Sisr.LOGGER.info("Started match {} for {}", config.matchId(), config.targetItem());
    for (ServerPlayer player : server.getPlayerList().getPlayers()) {
      onPlayerJoin(player);
    }
    return true;
  }

  public void stop(MinecraftServer server, String reason) {
    broadcast(server, reason);
    clear();
  }

  public void clear() {
    if (bossBar != null) {
      bossBar.removeAllPlayers();
    }
    config = null;
    targetItem = null;
    bossBar = null;
    endingTicks = -1;
    claimsInFlight.clear();
  }

  public void tick(MinecraftServer server) {
    startFromEnvironment(server);
    if (config == null) {
      return;
    }

    if (endingTicks >= 0) {
      if (--endingTicks <= 0) {
        boolean shutdown = config.shutdownOnEnd();
        clear();
        if (shutdown) {
          server.halt(false);
        }
      }
      return;
    }

    int elapsed = server.getTickCount() - startedTick;
    bossBar.setProgress(Math.max(0.0f, 1.0f - (float) elapsed / Math.max(1, config.timeoutTicks())));
    if (elapsed >= config.timeoutTicks()) {
      finish(server, null);
    }
  }

  public void onPlayerJoin(ServerPlayer player) {
    startFromEnvironment(player.level().getServer());
    if (config == null) {
      return;
    }
    if (!isAllowed(player)) {
      player.connection.disconnect(Component.literal("You are not assigned to this match."));
      return;
    }
    bossBar.addPlayer(player);
    player.sendSystemMessage(title("Current Item: " + config.targetItem()));
    onInventoryChanged(player);
  }

  public void onPlayerLeave(ServerPlayer player) {
    if (bossBar != null) {
      bossBar.removePlayer(player);
    }
    MinecraftServer server = player.level().getServer();
    if (config != null && config.shutdownOnEnd() && endingTicks < 0 && noAssignedPlayersOnline(server)) {
      finish(server, null);
    }
  }

  public void onInventoryChanged(ServerPlayer player) {
    MinecraftServer server = player.level().getServer();
    startFromEnvironment(server);
    if (config != null && endingTicks < 0 && isAllowed(player) && hasTargetItem(player)) {
      claim(server, player);
    }
  }

  private void startFromEnvironment(MinecraftServer server) {
    if (checkedEnvironment) {
      return;
    }
    checkedEnvironment = true;
    MatchConfig envConfig = MatchConfig.fromEnvironment();
    if (envConfig != null && !start(server, envConfig)) {
      Sisr.LOGGER.error("Invalid TARGET_ITEM: {}", envConfig.targetItem());
      server.halt(false);
    }
  }

  private boolean isAllowed(ServerPlayer player) {
    if (config.allowedPlayers().length == 0) {
      return true;
    }
    UUID uuid = player.getUUID();
    for (UUID allowedPlayer : config.allowedPlayers()) {
      if (allowedPlayer.equals(uuid)) {
        return true;
      }
    }
    return false;
  }

  private boolean hasTargetItem(ServerPlayer player) {
    return player.getInventory().contains(stack -> !stack.isEmpty() && stack.getItem() == targetItem);
  }

  private void claim(MinecraftServer server, ServerPlayer player) {
    UUID uuid = player.getUUID();
    if (!claimsInFlight.add(uuid)) {
      return;
    }

    if (config.apiBase().isBlank()) {
      finish(server, uuid);
      return;
    }

    try {
      String body = GSON.toJson(new ClaimRequest(uuid.toString()));
      HttpRequest.Builder request = HttpRequest.newBuilder(claimUri())
          .timeout(Duration.ofSeconds(4))
          .header("content-type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body));
      if (!config.apiToken().isBlank()) {
        request.header("authorization", "Bearer " + config.apiToken())
            .header("x-service-token", config.apiToken());
      }

      HTTP.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString())
          .whenComplete((response, error) -> server.executeIfPossible(() -> handleClaimResponse(server, uuid, response, error)));
    } catch (IllegalArgumentException error) {
      claimsInFlight.remove(uuid);
      Sisr.LOGGER.warn("Invalid API_BASE for match {}: {}", config.matchId(), config.apiBase(), error);
    }
  }

  private void handleClaimResponse(MinecraftServer server, UUID claimant, HttpResponse<String> response, Throwable error) {
    if (config == null) {
      return;
    }
    if (error != null || response == null || response.statusCode() / 100 != 2) {
      claimsInFlight.remove(claimant);
      Sisr.LOGGER.warn("Claim failed for {} in match {}", claimant, config.matchId(), error);
      return;
    }

    UUID winner = parseWinner(response.body());
    finish(server, winner == null ? claimant : winner);
  }

  private void finish(MinecraftServer server, UUID winner) {
    if (endingTicks >= 0) {
      return;
    }

    if (winner == null) {
      bossBar.setName(title("Match timed out. Current Item: " + config.targetItem()));
      broadcast(server, "Random Item Race timed out.");
    } else {
      ServerPlayer player = server.getPlayerList().getPlayer(winner);
      String name = player == null ? winner.toString() : player.getName().getString();
      bossBar.setName(title("Winner: " + name + " - Item: " + config.targetItem()));
      broadcast(server, name + " found " + config.targetItem() + "!");
    }
    bossBar.setProgress(0.0f);
    endingTicks = RESULT_TICKS;
  }

  private boolean noAssignedPlayersOnline(MinecraftServer server) {
    for (ServerPlayer player : server.getPlayerList().getPlayers()) {
      if (isAllowed(player)) {
        return false;
      }
    }
    return true;
  }

  private void pregenerateSpawn(MinecraftServer server, int radius) {
    if (radius <= 0) {
      return;
    }

    ChunkPos center = ChunkPos.ZERO;
    for (int x = center.x() - radius; x <= center.x() + radius; x++) {
      for (int z = center.z() - radius; z <= center.z() + radius; z++) {
        server.overworld().getChunk(x, z, ChunkStatus.FULL, true);
      }
    }
    Sisr.LOGGER.info("Pregenerated {} chunk radius for match {}", radius, config.matchId());
  }

  private URI claimUri() {
    String base = config.apiBase().endsWith("/") ? config.apiBase().substring(0, config.apiBase().length() - 1) : config.apiBase();
    String matchId = URLEncoder.encode(config.matchId(), StandardCharsets.UTF_8);
    return URI.create(base + "/api/match/" + matchId + "/claim");
  }

  private void notifyReady() {
    if (config.apiBase().isBlank()) {
      return;
    }

    try {
      HttpRequest.Builder request = HttpRequest.newBuilder(matchUri("ready"))
          .timeout(Duration.ofSeconds(4))
          .header("content-type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(readyBody()));
      if (!config.apiToken().isBlank()) {
        request.header("authorization", "Bearer " + config.apiToken())
            .header("x-service-token", config.apiToken());
      }

      HTTP.sendAsync(request.build(), HttpResponse.BodyHandlers.discarding())
          .whenComplete((response, error) -> {
            if (error != null || response == null || response.statusCode() / 100 != 2) {
              Sisr.LOGGER.warn("Ready notification failed for match {}", config.matchId(), error);
            }
          });
    } catch (IllegalArgumentException error) {
      Sisr.LOGGER.warn("Invalid API_BASE for ready notification in match {}: {}", config.matchId(), config.apiBase(), error);
    }
  }

  private URI matchUri(String action) {
    String base = config.apiBase().endsWith("/") ? config.apiBase().substring(0, config.apiBase().length() - 1) : config.apiBase();
    String matchId = URLEncoder.encode(config.matchId(), StandardCharsets.UTF_8);
    return URI.create(base + "/api/match/" + matchId + "/" + action);
  }

  private String readyBody() {
    List<String> players = Arrays.stream(config.allowedPlayers()).map(UUID::toString).toList();
    return GSON.toJson(new ReadyRequest(config.matchId(), config.targetItem(), config.serverAddress(), players));
  }

  private static Identifier normalizeItemId(String raw) {
    String value = raw.trim().toLowerCase(Locale.ROOT);
    if (value.isBlank()) {
      return null;
    }
    return value.indexOf(':') < 0 ? Identifier.withDefaultNamespace(value) : Identifier.tryParse(value);
  }

  private static UUID parseWinner(String json) {
    if (json == null || json.isBlank()) {
      return null;
    }
    try {
      ClaimResponse response = GSON.fromJson(json, ClaimResponse.class);
      if (response == null) {
        return null;
      }
      String value = response.winnerUuid();
      if (value == null || value.isBlank()) {
        value = response.winner();
      }
      return parseUuid(value);
    } catch (JsonParseException ignored) {
      return null;
    }
  }

  private static UUID parseUuid(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return UndashedUuid.fromStringLenient(value);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private static void broadcast(MinecraftServer server, String message) {
    server.getPlayerList().broadcastSystemMessage(title(message), false);
  }

  private static Component title(String text) {
    return Component.literal(text);
  }

  private record ClaimRequest(String uuid) {}

  private record ReadyRequest(String matchId, String targetItem, String serverAddress, List<String> players) {}

  private record ClaimResponse(String winnerUuid, String winner) {}
}
