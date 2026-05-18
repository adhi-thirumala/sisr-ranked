package org.adhiadhi.sisr.mixin;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import org.adhiadhi.sisr.Sisr;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Inventory.class)
public class InventoryMixin {
  @Shadow @Final public Player player;

  @Inject(method = "add(ILnet/minecraft/world/item/ItemStack;)Z", at = @At("RETURN"))
  private void sisr$add(int slot, ItemStack stack, CallbackInfoReturnable<Boolean> cir) {
    if (cir.getReturnValueZ() && player instanceof ServerPlayer serverPlayer) {
      Sisr.onInventoryChanged(serverPlayer);
    }
  }
}
