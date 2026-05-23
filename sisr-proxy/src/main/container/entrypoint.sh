#!/usr/bin/env sh
set -eu

mkdir -p plugins
cp /opt/velocity/plugins/sisr-proxy.jar plugins/sisr-proxy.jar

if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then
  exec java ${JAVA_OPTS:-} -jar /opt/velocity/velocity.jar "$@"
fi

exec "$@"
