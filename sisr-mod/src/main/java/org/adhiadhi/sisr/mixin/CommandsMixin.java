package org.adhiadhi.sisr.mixin;

import net.minecraft.commands.CommandBuildContext;
import net.minecraft.commands.Commands;
import org.adhiadhi.sisr.Sisr;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Commands.class)
public class CommandsMixin {
  @Inject(method = "<init>", at = @At("TAIL"))
  private void sisr$registerCommands(Commands.CommandSelection selection, CommandBuildContext context, CallbackInfo ci) {
    Sisr.registerCommands(((Commands) (Object) this).getDispatcher());
  }
}
