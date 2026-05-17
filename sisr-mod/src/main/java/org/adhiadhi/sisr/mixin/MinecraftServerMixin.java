package org.adhiadhi.sisr.mixin;

import java.util.function.BooleanSupplier;
import net.minecraft.server.MinecraftServer;
import org.adhiadhi.sisr.Sisr;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftServer.class)
public class MinecraftServerMixin {
  @Inject(method = "tickServer", at = @At("TAIL"))
  private void sisr$tick(BooleanSupplier hasTimeLeft, CallbackInfo ci) {
    Sisr.tick((MinecraftServer) (Object) this);
  }

  @Inject(method = "stopServer", at = @At("HEAD"))
  private void sisr$stop(CallbackInfo ci) {
    Sisr.shutdown();
  }
}
