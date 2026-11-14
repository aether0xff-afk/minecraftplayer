# Verification and White-PC integration

## Current boundary

Public GitHub-hosted Actions run **syntax and unit tests only**. They cannot attest to gameplay on the owner's Minecraft 26.3 server. The existing RTX 5080 machine already hosts the live server and runs the headless agent through ViaProxy. **Never execute an unreviewed pull request on that live host.**

## Safe integration-test topology

1. Switch the repository to **private** before configuring a GitHub **self-hosted runner**. Public repositories with powerful on-premise runners create remote-code-execution exposure from external contributors.
2. Create a **separate Windows standard user** for CI. Do not give it administrator privileges, access to Minecraft production world files or Microsoft session credentials.
3. Create a **separate test Minecraft world/server** and test account (or an approved nonproduction setup). Never run destructive learning agents against the production world.
4. Restrict the runner to a dedicated label such as `minecraft-test`. Review workflow changes on GitHub before allowing them to execute on the runner.
5. Test locally accessible ViaProxy 26.1 → Minecraft 26.3, with account auth stored only under the dedicated user profile. Do not upload session tokens to Actions artifacts.
6. Capture machine-readable results and redact names, coordinates and account information before upload; report measured p50/p95 motor tick latency, tick jitter, TPS, reconnect success, waypoint error, crafting success and PvP policy controls.

No runner is registered by this repository initialization. Avoid any "automatic server test" claims until a run ID and logs from this setup exist.

## Minimum integration gates

| Category | Gate |
|---|---|
| Login | Spawn and survive 10 minutes without disconnect |
| 20-Hz motor | Input frame + feedback processed every physics tick with measured p95 latency |
| Concurrent controls | Move + look + use, move + attack, turn while maintaining world-space motion |
| Survival | Gather wood, craft tools, eat food; verify real inventory and world effects |
| Planning | Continue a multistep task while responding to unrelated chat, then resume |
| Social | Generate trade offers, handle refusals and later encounters using persistent memories |
| Recovery | Death, restart and disconnect do not erase durable plans and relationship events |
| Safety/fairness | No OP/world-file reads; PvP and raiding conform to server policy |

**Do not treat a synthetic single-function test as a substitute for gameplay tests.**
