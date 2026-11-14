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

## Current implementation and test evidence

The **legacy WildPlayer v0.4 prototype is now imported** into this repository: 27 project files, including the headless bot, planner, survival and combat modules, parallel motor controller, scripts and tests. Previous ZIP-based development artifacts are superseded by the GitHub sources.

- GitHub Actions import run [#43586054540](https://github.com/aether0xff-afk/minecraftplayer/actions/runs/43586054540): **success**, with **32/32 tests passed** on Ubuntu and the source syntax check passed.
- These are **unit tests and static checks**. No automatic live Minecraft 26.3 server tests have been performed in GitHub; a passing build does not establish human-level autonomous gameplay.
- Original chat experiments demonstrated the older headless Mineflayer+ViaProxy setup connecting, chatting and moving on the user's 26.3 server. Subsequent planner, survival and composite motor upgrades remain unverified end-to-end.

### Windows 11 host (white PC)

```powershell
git clone https://github.com/aether0xff-afk/minecraftplayer.git
cd minecraftplayer
Copy-Item .env.example .env
notepad .env  # configure the known local ViaProxy / Ollama environment
npm install
npm run check
npm test
npm start
```

Keep `.env`, authentication sessions, local world files and runtime memory outside Git. The production server must not be used as a self-hosted CI runner. Run gameplay integration checks in a dedicated local test world before changing production behavior.

### Release gate

Do not call this a completed autonomous human-like agent until Minecraft 26.3 integration, long-horizon planning, parallel control, social interaction and reconnect reliability pass repeatable real-world acceptance tests.
