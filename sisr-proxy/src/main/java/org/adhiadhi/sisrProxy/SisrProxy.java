package org.adhiadhi.sisrProxy;

import com.google.inject.Inject;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.Subscribe;
import org.slf4j.Logger;

public class SisrProxy {

  @Inject
  private Logger logger;

  @Subscribe
  public void onProxyInitialization(ProxyInitializeEvent event) {
    // Plugin initialization logic goes here
  }
}
