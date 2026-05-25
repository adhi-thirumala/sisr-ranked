package org.adhiadhi.sisrProxy;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import com.google.inject.Inject;
import com.velocitypowered.api.event.EventTask;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.player.KickedFromServerEvent;
import com.velocitypowered.api.event.player.PlayerChooseInitialServerEvent;
import com.velocitypowered.api.event.player.ServerConnectedEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.slf4j.Logger;

public class SisrProxy {
  private static final Component NO_MATCH_MESSAGE = Component.text("match not found or match container not ready spawning");
  private static final Duration ROUTE_TIMEOUT = Duration.ofMillis(1200);
  private static final Gson GSON = new Gson();

  @Inject
  private Logger logger;

  @Inject
  private ProxyServer proxy;

  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(ROUTE_TIMEOUT)
      .build();
  private final Map<String, Route> dynamicServers = new ConcurrentHashMap<>();
  private String apiBase;
  private String apiToken;
  private String eventsUrl;
  private volatile boolean reconnectScheduled;

  @Subscribe
  public void onProxyInitialization(ProxyInitializeEvent event) {
    apiBase = firstEnv("RIR_API_BASE", "API_BASE");
    apiToken = firstEnv("RIR_API_TOKEN", "API_TOKEN");
    if (apiBase == null || apiBase.isBlank()) {
      logger.warn("RIR router disabled: set RIR_API_BASE or API_BASE to route players to matches");
    } else {
      apiBase = stripTrailingSlash(apiBase);
      eventsUrl = firstEnv("RIR_EVENTS_WS", "EVENTS_WS");
      if (eventsUrl == null || eventsUrl.isBlank()) {
        eventsUrl = eventSocketUrl(apiBase);
      }
      if (apiToken == null || apiToken.isBlank()) {
        logger.warn("RIR router has no service token; route requests will be unauthenticated");
      }
      logger.info("RIR router initialized with API base {}", apiBase);
      connectEventSocket();
    }
  }

  @Subscribe
  public EventTask onPlayerChooseInitialServer(PlayerChooseInitialServerEvent event) {
    if (apiBase == null || apiBase.isBlank()) {
      return null;
    }

    UUID uuid = event.getPlayer().getUniqueId();
    logger.info("Player {} ({}) is choosing initial server", event.getPlayer().getUsername(), uuid);
    String currentApiBase = apiBase;
    String currentApiToken = apiToken;
    CompletableFuture<Void> routeSelection = fetchRouteAsync(uuid, currentApiBase, currentApiToken).thenAccept(route -> {
      if (route == null) {
        logger.info("No ready match route found for {} ({}), disconnecting", event.getPlayer().getUsername(), uuid);
        event.getPlayer().disconnect(NO_MATCH_MESSAGE);
        return;
      }

      try {
        RegisteredServer server = registerRoute(route);
        logger.info("Routing {} ({}) to match server {}", event.getPlayer().getUsername(), uuid, route.serverAddress());
        event.setInitialServer(server);
      } catch (RuntimeException ex) {
        logger.warn("Failed to register route {} for {}", route.serverAddress(), uuid, ex);
        event.getPlayer().disconnect(NO_MATCH_MESSAGE);
      }
    });
    return EventTask.resumeWhenComplete(routeSelection);
  }

  @Subscribe
  public void onServerConnected(ServerConnectedEvent event) {
    event.getPreviousServer().ifPresent(previous -> cleanupIfEmpty(previous.getServerInfo().getName()));
  }

  @Subscribe
  public void onDisconnect(DisconnectEvent event) {
    cleanupDynamicServers();
  }

  @Subscribe
  public void onKickedFromServer(KickedFromServerEvent event) {
    String serverName = event.getServer().getServerInfo().getName();
    if (!dynamicServers.containsKey(serverName)) {
      return;
    }

    event.setResult(KickedFromServerEvent.DisconnectPlayer.create(NO_MATCH_MESSAGE));
    cleanupIfEmpty(serverName);
  }

  private CompletableFuture<Route> fetchRouteAsync(UUID uuid, String apiBase, String apiToken) {
    try {
      HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(apiBase + "/api/route/" + uuid))
          .timeout(ROUTE_TIMEOUT)
          .GET();
      if (apiToken != null && !apiToken.isBlank()) {
        request.header("Authorization", "Bearer " + apiToken);
        request.header("x-service-token", apiToken);
      }

      return http.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString())
          .handle((response, error) -> parseRouteResponse(uuid, response, error));
    } catch (RuntimeException ex) {
      logger.warn("Route lookup for {} returned invalid data", uuid, ex);
      return CompletableFuture.completedFuture(null);
    }
  }

  private Route parseRouteResponse(UUID uuid, HttpResponse<String> response, Throwable error) {
    if (error != null) {
      logger.warn("Route lookup for {} failed", uuid, error);
      return null;
    }

    try {
      if (response.statusCode() == 404 || response.statusCode() == 204 || response.body() == null || response.body().isBlank()) {
        return null;
      }
      if (response.statusCode() < 200 || response.statusCode() >= 300) {
        logger.warn("Route lookup for {} failed with HTTP {}", uuid, response.statusCode());
        return null;
      }

      RouteResponse routeResponse = GSON.fromJson(response.body(), RouteResponse.class);
      if (routeResponse == null) {
        return null;
      }
      String serverAddress = routeResponse.serverAddress();
      if (serverAddress == null) {
        serverAddress = routeResponse.address();
      }
      if (Boolean.FALSE.equals(routeResponse.ready())) {
        logger.info("Route for {} exists but match {} is not ready yet at {}", uuid, routeResponse.matchId(), serverAddress);
        return null;
      }
      if (routeResponse.matchId() == null || routeResponse.matchId().isBlank() || serverAddress == null || serverAddress.isBlank()) {
        return null;
      }
      return new Route(routeResponse.matchId(), serverAddress);
    } catch (RuntimeException ex) {
      logger.warn("Route lookup for {} returned invalid data", uuid, ex);
      return null;
    }
  }

  private void connectEventSocket() {
    if (eventsUrl == null || eventsUrl.isBlank()) {
      return;
    }

    try {
      WebSocket.Builder builder = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5));
      if (apiToken != null && !apiToken.isBlank()) {
        builder.header("Authorization", "Bearer " + apiToken);
        builder.header("x-service-token", apiToken);
      }
      builder.buildAsync(URI.create(eventsUrl), new EventSocketListener())
          .whenComplete((socket, error) -> {
            if (error != null) {
              logger.warn("Velocity event socket failed to connect", error);
              scheduleEventReconnect();
              return;
            }
            logger.info("Connected Velocity event socket to {}", eventsUrl);
          });
    } catch (RuntimeException ex) {
      logger.warn("Velocity event socket URL is invalid: {}", eventsUrl, ex);
      scheduleEventReconnect();
    }
  }

  private void scheduleEventReconnect() {
    if (reconnectScheduled || apiBase == null || apiBase.isBlank()) {
      return;
    }
    reconnectScheduled = true;
    proxy.getScheduler().buildTask(this, () -> {
      reconnectScheduled = false;
      connectEventSocket();
    }).delay(5, TimeUnit.SECONDS).schedule();
  }

  private void handleEvent(String message) {
    ReadyEventMessage eventMessage;
    try {
      eventMessage = GSON.fromJson(message, ReadyEventMessage.class);
    } catch (JsonParseException ex) {
      logger.warn("Ignoring invalid match_ready event: {}", message);
      return;
    }
    if (eventMessage == null || !"match_ready".equals(eventMessage.type())) {
      return;
    }

    String serverAddress = eventMessage.serverAddress();
    if (serverAddress == null) {
      serverAddress = eventMessage.address();
    }
    List<UUID> players = eventMessage.players();
    if (eventMessage.matchId() == null || eventMessage.matchId().isBlank() || serverAddress == null || serverAddress.isBlank()
        || players == null || players.isEmpty()) {
      logger.warn("Ignoring invalid match_ready event: {}", message);
      return;
    }

    ReadyEvent event = new ReadyEvent(eventMessage.matchId(), serverAddress, players);
    proxy.getScheduler().buildTask(this, () -> moveReadyPlayers(event)).schedule();
  }

  private void moveReadyPlayers(ReadyEvent event) {
    RegisteredServer matchServer;
    try {
      matchServer = registerRoute(new Route(event.matchId(), event.serverAddress()));
    } catch (RuntimeException ex) {
      logger.warn("Failed to register ready match server {}", event.serverAddress(), ex);
      return;
    }

    for (UUID uuid : event.players()) {
      proxy.getPlayer(uuid).ifPresent(player -> {
        player.createConnectionRequest(matchServer).connect().whenComplete((result, error) -> {
          if (error != null) {
            logger.warn("Failed to move {} to match {}", uuid, event.matchId(), error);
          } else if (!result.isSuccessful()) {
            logger.warn("Failed to move {} to match {}: {}", uuid, event.matchId(), result.getStatus());
          }
        });
      });
    }
  }

  private RegisteredServer registerRoute(Route route) {
    String name = serverName(route);
    Optional<RegisteredServer> existing = proxy.getServer(name);
    if (existing.isPresent()) {
      dynamicServers.putIfAbsent(name, route);
      return existing.get();
    }

    ServerInfo info = new ServerInfo(name, parseAddress(route.serverAddress()));
    RegisteredServer registered = proxy.registerServer(info);
    dynamicServers.put(name, route);
    logger.info("Registered match server {} at {}", name, route.serverAddress());
    return registered;
  }

  private void cleanupDynamicServers() {
    for (String serverName : dynamicServers.keySet()) {
      cleanupIfEmpty(serverName);
    }
  }

  private void cleanupIfEmpty(String serverName) {
    if (!dynamicServers.containsKey(serverName)) {
      return;
    }

    Optional<RegisteredServer> server = proxy.getServer(serverName);
    if (server.isEmpty()) {
      dynamicServers.remove(serverName);
      return;
    }
    if (!server.get().getPlayersConnected().isEmpty()) {
      return;
    }

    proxy.unregisterServer(server.get().getServerInfo());
    dynamicServers.remove(serverName);
    logger.info("Unregistered idle match server {}", serverName);
  }

  private static InetSocketAddress parseAddress(String address) {
    int split = address.lastIndexOf(':');
    if (split <= 0 || split == address.length() - 1) {
      throw new IllegalArgumentException("expected host:port address: " + address);
    }
    String host = address.substring(0, split);
    int port = Integer.parseInt(address.substring(split + 1));
    return InetSocketAddress.createUnresolved(host, port);
  }

  private static String serverName(Route route) {
    String host = route.serverAddress();
    int split = host.lastIndexOf(':');
    if (split > 0) {
      host = host.substring(0, split);
    }
    if (host.startsWith("match-")) {
      return sanitizeName(host);
    }
    return sanitizeName("match-" + route.matchId());
  }

  private static String sanitizeName(String name) {
    return name.replaceAll("[^A-Za-z0-9_.-]", "-");
  }

  private static String firstEnv(String first, String second) {
    String value = System.getenv(first);
    return value == null || value.isBlank() ? System.getenv(second) : value;
  }

  private static String stripTrailingSlash(String value) {
    while (value.endsWith("/")) {
      value = value.substring(0, value.length() - 1);
    }
    return value;
  }

  private static String eventSocketUrl(String apiBase) {
    String base = stripTrailingSlash(apiBase);
    if (base.startsWith("https://")) {
      base = "wss://" + base.substring("https://".length());
    } else if (base.startsWith("http://")) {
      base = "ws://" + base.substring("http://".length());
    }
    return base + "/api/velocity/events";
  }

  private record Route(String matchId, String serverAddress) {}

  private record RouteResponse(String matchId, String serverAddress, String address, Boolean ready) {}

  private record ReadyEvent(String matchId, String serverAddress, List<UUID> players) {}

  private record ReadyEventMessage(String type, String matchId, String serverAddress, String address, List<UUID> players) {}

  private final class EventSocketListener implements WebSocket.Listener {
    private final StringBuilder message = new StringBuilder();

    @Override
    public void onOpen(WebSocket webSocket) {
      webSocket.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      message.append(data);
      if (last) {
        handleEvent(message.toString());
        message.setLength(0);
      }
      webSocket.request(1);
      return null;
    }

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
      logger.warn("Velocity event socket closed: {} {}", statusCode, reason);
      scheduleEventReconnect();
      return null;
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
      logger.warn("Velocity event socket errored", error);
      scheduleEventReconnect();
    }
  }
}
