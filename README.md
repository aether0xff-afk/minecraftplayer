# MinecraftPlayer — Autonomous Multiplayer Agent

> **Status: research / development. Not a finished human-level player.**  
> Target: Minecraft Java **26.3**, dedicated **headless** agent account on the existing server, Windows 11, RTX 5080 16 GB, 128 GB RAM, local open-weight models.

## Non-negotiable goal

An independent **new survival player** in an existing human multiplayer world, not an obedient assistant or a scripted demonstration bot. It should develop its own goals, plan and adapt over long horizons, and naturally chat, negotiate, trade, ally, compete or raid **only within server rules**. It must retain autobiographical memory across restarts.

### Player fairness

No OP privileges, teleportation, server world-file reads, cheating inventories, privileged coordinates, or special admin-only information. Use what the player legitimately observes through the Minecraft protocol and its own actions. Credentials and local server details stay on the host, never in the repository.

## Architecture and design constraints

- **Headless game I/O:** Mineflayer + ViaProxy (client protocol 26.1 → Minecraft 26.3 server), using the connection previously demonstrated by the user.
- **Long-range cognition:** locally hosted open-weight LLM for independent goal generation, social reasoning, dialogue, plans, counterfactuals, and memory retrieval. Plans persist across movement and combat.
- **Fast motor policy:** at most one **composite control vector per tick** (nominal 20 Hz / 50 ms): forward/back, strafe, jump, sprint, sneak, camera orientation, attack/use, hotbar. Compatible commands execute **concurrently**, rather than choosing one from a fixed high-level action menu.
- **Feedback:** continuous observation, event-triggered replanning, interrupt/resume, world-state verification and recovery from failure. Model latency must not stall local motion.
- **Learning:** experience replay and measurable skill improvements; imitation-learning or video-pretrained policies are research extensions, not currently complete.
- **Social memory:** event provenance, player-specific relationship history and reversible beliefs; no default "owner" privilege for the human player.

## Development / validation contract

A passing syntax/unit test is **not** enough for release. Completion requires repeatable tests of:
1. Windows headless launch and 26.3 authenticated connection;
2. non-serial 20-Hz movement/aim/use combinations with measured tick latency;
3. autonomous survival progression and item/crafting outcome verification;
4. coherent 30+ minute plan execution, interruptions and resumption;
5. dialogue, negotiation and voluntary trade with actual human players;
6. relationship changes following help, rejection, conflict and reconciliation;
7. PvP/raiding ONLY in explicitly permitted scenarios;
8. death and reconnect recovery, memory persistence, stability and server TPS.

**Validated so far in conversation:** headless Minecraft 26.3 server connection via ViaProxy, chat, position and basic waypoint movement. Subsequent motor, planning, crafting and combat code had local unit tests but has **not** been end-to-end verified on the host.

## Repository bootstrap

This repository was empty when selected. Its initial commit establishes the project contract, source-protection rules, and Windows CI conventions. **The prior v0.4 local prototype has not yet been imported into GitHub**; do not interpret a green workflow as gameplay success.

The prior tested project's files are available locally on the white PC as `wildplayer-whitepc-26.3-v0.4-parallel-motor`. They should be imported as source (excluding `.env`, `data/`, account files, `tools/*.jar`), reviewed, and then extended with end-to-end tests. No Minecraft credentials are required in GitHub.

### Local commands once source is imported

```powershell
npm ci
npm run check
npm test
npm start
```

Keep the production Minecraft server isolated from any self-hosted CI runner. Run gameplay integration tests in a dedicated nonproduction world/account before release.
