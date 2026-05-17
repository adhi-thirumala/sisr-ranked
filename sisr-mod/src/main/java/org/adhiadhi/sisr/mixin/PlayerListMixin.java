package org.adhiadhi.sisr.mixin;

import net.minecraft.network.Connection;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.players.PlayerList;
import org.adhiadhi.sisr.Sisr;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerList.class)
public class PlayerListMixin {
  @Inject(method = "placeNewPlayer", at = @At("TAIL"))
  private void sisr$placeNewPlayer(Connection connection, ServerPlayer player, CommonListenerCookie cookie, CallbackInfo ci) {
    Sisr.onPlayerJoin(player);
  }

  @Inject(method = "remove", at = @At("TAIL"))
  private void sisr$remove(ServerPlayer player, CallbackInfo ci) {
    Sisr.onPlayerLeave(player);
  }
}
