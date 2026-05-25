package org.adhiadhi.sisr;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;
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
import net.minecraft.world.item.ItemStack;
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
    bossBar = new ServerBossEvent(UUID.randomUUID(), currentItemTitle("Current Item: "),
        BossEvent.BossBarColor.BLUE, BossEvent.BossBarOverlay.PROGRESS);
    bossBar.setProgress(1.0f);

    pregenerateSpawn(server, config.pregenRadius());
    notifyReady();
    broadcast(server, currentItemTitle("Random Item Race started. Current Item: "));
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

    String apiBase = config.apiBase();
    String apiToken = config.apiToken();
    String matchId = config.matchId();
    if (apiBase.isBlank()) {
      finish(server, uuid);
      return;
    }

    try {
      String body = GSON.toJson(new ClaimRequest(uuid.toString()));
      HttpRequest.Builder request = HttpRequest.newBuilder(claimUri(apiBase, matchId))
          .timeout(Duration.ofSeconds(4))
          .header("content-type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body));
      if (!apiToken.isBlank()) {
        request.header("authorization", "Bearer " + apiToken)
            .header("x-service-token", apiToken);
      }

      HTTP.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString())
          .whenComplete((response, error) -> server.executeIfPossible(() -> handleClaimResponse(server, uuid, matchId, response, error)));
    } catch (IllegalArgumentException error) {
      claimsInFlight.remove(uuid);
      Sisr.LOGGER.warn("Invalid API_BASE for match {}: {}", matchId, apiBase, error);
    }
  }

  private void handleClaimResponse(MinecraftServer server, UUID claimant, String matchId, HttpResponse<String> response, Throwable error) {
    if (config == null || !matchId.equals(config.matchId())) {
      claimsInFlight.remove(claimant);
      return;
    }
    if (error != null || response == null || response.statusCode() / 100 != 2) {
      claimsInFlight.remove(claimant);
      Sisr.LOGGER.warn("Claim failed for {} in match {}", claimant, matchId, error);
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
      bossBar.setName(currentItemTitle("Match timed out. Current Item: "));
      broadcast(server, "Random Item Race timed out.");
    } else {
      ServerPlayer player = server.getPlayerList().getPlayer(winner);
      String name = player == null ? winner.toString() : player.getName().getString();
      bossBar.setName(Component.literal("Winner: " + name + " - Item: ").append(targetItemName()));
      broadcast(server, Component.literal(name + " found ").append(targetItemName()).append("!"));
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

  private URI claimUri(String apiBase, String matchId) {
    return matchUri(apiBase, matchId, "claim");
  }

  private void notifyReady() {
    String apiBase = config.apiBase();
    String apiToken = config.apiToken();
    String matchId = config.matchId();
    String targetItem = config.targetItem();
    String serverAddress = config.serverAddress();
    List<String> players = Arrays.stream(config.allowedPlayers()).map(UUID::toString).toList();
    if (apiBase.isBlank()) {
      return;
    }

    try {
      URI readyUri = matchUri(apiBase, matchId, "ready");
      Sisr.LOGGER.info("Sending ready notification for match {} to {} with server {} and {} players", matchId, readyUri,
          serverAddress, players.size());
      HttpRequest.Builder request = HttpRequest.newBuilder(readyUri)
          .timeout(Duration.ofSeconds(4))
          .header("content-type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(readyBody(matchId, targetItem, serverAddress, players)));
      if (!apiToken.isBlank()) {
        request.header("authorization", "Bearer " + apiToken)
            .header("x-service-token", apiToken);
      }

      HTTP.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString())
          .whenComplete((response, error) -> {
            if (error != null) {
              Sisr.LOGGER.warn("Ready notification failed for match {}", matchId, error);
              return;
            }
            if (response == null || response.statusCode() / 100 != 2) {
              Sisr.LOGGER.warn("Ready notification failed for match {} with HTTP {}: {}", matchId,
                  response == null ? "unknown" : response.statusCode(), response == null ? "" : response.body());
              return;
            }
            Sisr.LOGGER.info("Ready notification accepted for match {} with HTTP {}", matchId, response.statusCode());
          });
    } catch (IllegalArgumentException error) {
      Sisr.LOGGER.warn("Invalid API_BASE for ready notification in match {}: {}", matchId, apiBase, error);
    }
  }

  private URI matchUri(String apiBase, String matchId, String action) {
    String base = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
    String encodedMatchId = URLEncoder.encode(matchId, StandardCharsets.UTF_8);
    return URI.create(base + "/api/match/" + encodedMatchId + "/" + action);
  }

  private String readyBody(String matchId, String targetItem, String serverAddress, List<String> players) {
    return GSON.toJson(new ReadyRequest(matchId, targetItem, serverAddress, players));
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
      return UUID.fromString(value.trim());
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private static void broadcast(MinecraftServer server, String message) {
    broadcast(server, title(message));
  }

  private static void broadcast(MinecraftServer server, Component message) {
    server.getPlayerList().broadcastSystemMessage(message, false);
  }

  private static Component title(String text) {
    return Component.literal(text);
  }

  private Component currentItemTitle(String prefix) {
    return Component.literal(prefix).append(targetItemName());
  }

  private Component targetItemName() {
    return targetItem.getName(new ItemStack(targetItem));
  }

  private record ClaimRequest(String uuid) {}

  private record ReadyRequest(String matchId, String targetItem, String serverAddress, List<String> players) {}

  private record ClaimResponse(String winnerUuid, String winner) {}
}
