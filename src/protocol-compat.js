'use strict';

/**
 * Minecraft 26.3 validates movement packets using client_tick_end sent after
 * each client tick. Pinned mineflayer@4.39.0 does not send this packet, so a
 * 26.1 -> ViaProxy -> 26.3 bot gets kicked shortly after spawn.
 *
 * This compatibility shim is ONLY for the pinned mineflayer 4.39.0, the 26.1
 * protocol and an unbuffered outbound packet path. If you install a newer
 * Mineflayer that emits tick_end itself, REMOVE this shim to avoid duplicates.
 * Do not add any write throttling/queuing between this shim and the socket.
 */
function installTickEndCompatibility(client, onWarning = ()=>{}) {
  if (!client || typeof client.write !== 'function') {
    throw new TypeError('Expected an initialized Minecraft protocol client');
  }
  const rawWrite = client.write.bind(client);
  let warned = false;
  client.write = (packetName, packet) => {
    const result = rawWrite(packetName, packet);
    if (packetName === 'position' || packetName === 'position_look') {
      try {
        // Emit immediately after the position packet on the same write path.
        rawWrite('tick_end', {});
      } catch (error) {
        if (!warned) {
          warned = true;
          onWarning(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return result;
  };
  return () => { client.write = rawWrite; };
}

function plainKickReason(component) {
  if (component == null) return '';
  if (typeof component === 'string') {
    try { return plainKickReason(JSON.parse(component)); }
    catch { return component; }
  }
  if (Array.isArray(component)) return component.map(plainKickReason).filter(Boolean).join(' ');
  if (typeof component === 'object') {
    return [
      component.text,
      component.translate,
      ...(Array.isArray(component.with) ? component.with : []),
      ...(Array.isArray(component.extra) ? component.extra : [])
    ].map(plainKickReason).filter(Boolean).join(' ');
  }
  return String(component);
}

module.exports = { installTickEndCompatibility, plainKickReason };
