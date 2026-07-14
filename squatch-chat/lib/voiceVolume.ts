export function effectiveUserVolume(preferredVolume = 1, routingMuted = false): number {
  return routingMuted ? 0 : preferredVolume;
}
