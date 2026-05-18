package org.adhiadhi.sisr;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ModInitializer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.permissions.PermissionLevel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Sisr implements ModInitializer {
  public static final Logger LOGGER = LoggerFactory.getLogger("sisr");
  private static final MatchGame GAME = new MatchGame();

  @Override
  public void onInitialize() {
    LOGGER.info("SISR server mod initialized");
  }

  public static void registerCommands(CommandDispatcher<CommandSourceStack> dispatcher) {
    dispatcher.register(Commands.literal("rir")
        .requires(Sisr::canManageRace)
        .then(Commands.literal("start")
            .then(Commands.argument("item", StringArgumentType.word())
                .executes(context -> startManual(context.getSource(), StringArgumentType.getString(context, "item")))))
        .then(Commands.literal("stop")
            .executes(context -> stopManual(context.getSource()))));
  }

  public static void tick(MinecraftServer server) {
    GAME.tick(server);
  }

  public static void onPlayerJoin(ServerPlayer player) {
    GAME.onPlayerJoin(player);
  }

  public static void onPlayerLeave(ServerPlayer player) {
    GAME.onPlayerLeave(player);
  }

  public static void onInventoryChanged(ServerPlayer player) {
    GAME.onInventoryChanged(player);
  }

  public static boolean startMatch(MinecraftServer server, MatchConfig config) {
    return GAME.start(server, config);
  }

  public static void shutdown() {
    GAME.clear();
  }

  private static int startManual(CommandSourceStack source, String itemId) {
    MatchConfig config = MatchConfig.manual(source.getServer(), itemId);
    if (!startMatch(source.getServer(), config)) {
      source.sendFailure(Component.literal("Unknown item: " + itemId));
      return 0;
    }

    source.sendSuccess(() -> Component.literal("Started Random Item Race for " + config.targetItem()), true);
    return 1;
  }

  private static int stopManual(CommandSourceStack source) {
    if (!GAME.isRunning()) {
      source.sendFailure(Component.literal("No Random Item Race is running"));
      return 0;
    }

    GAME.stop(source.getServer(), "Match stopped by command");
    source.sendSuccess(() -> Component.literal("Stopped Random Item Race"), true);
    return 1;
  }

  private static boolean canManageRace(CommandSourceStack source) {
    if (!source.isPlayer()) {
      return true;
    }
    if (source.permissions() instanceof LevelBasedPermissionSet permissions) {
      return permissions.level().isEqualOrHigherThan(PermissionLevel.GAMEMASTERS);
    }
    return false;
  }
}
