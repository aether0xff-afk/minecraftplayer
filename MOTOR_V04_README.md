# WildPlayer v0.4 — 20Hz Parallel Motor Frame (experimental)

This upgrade preserves the v0.3.1 headless Mineflayer + ViaProxy Minecraft 26.3 connection.
It adds `src/motor.js` as an **optional** motor interface. The Minecraft server and
ViaProxy configuration are unchanged.

## What works in code

- One **composite frame** includes movement keys, jump, sprint, sneak, yaw/pitch or
  world-space gaze target, held item use, attack, and hotbar selection.
- The controller applies the frame from each Mineflayer `physicsTick`. In normal
  20TPS simulation, this is nominally one application every ~50ms; **actual
  timing has not been verified on the user's server**.
- World-space movement can be maintained while facing a different direction.
- Bow draw blocks sprint inputs but not walking, strafing, or head turning.
- Use has press/hold/release semantics. Attack respects cooldown and PvP allowlist.
- Manual commands age out after 5 seconds (`MOTOR_FRAME_TTL_MS`).
- The controller has `setPolicy((bot, now) => frame)` for a future learned 20Hz policy.

## What is *not* implemented

- This release does NOT give JevK5 or Qwen continuous 20Hz inference. Model-to-frame
  autonomous decisions still need a trained fast policy and runtime integration.
- This motor mode is an isolated test. Turning it on pauses normal autonomy and
  hands you the low-level control, to prevent pathfinder conflicts.
- The bot's complex survival/planning code remains the previous implementation.
- True PvP skills, human-like timing, and 26.3 end-to-end motor tests are not verified.

## Install on White PC (PowerShell)

Back up the Minecraft world first. Stop the old WildPlayer process (leave your
Minecraft 26.3 server and ViaProxy running). Extract this ZIP and open PowerShell
inside the folder containing `package.json`.

```powershell
Copy-Item 'C:\path\to\previous\WildPlayer\.env' '.\.env'
npm install
npm run check
npm test
npm start
```

Copy the real `.env` from the working previous project. Do NOT copy the
`.env.example` over your known-working connection configuration.

Once the bot spawns, for a flat, safe area:

```text
movement on
motor on
motor frame {"forward":true,"left":true,"jump":false,"look":{"yaw":0.5,"pitch":0.0}}
motor status
motor off
```

The frame is applied on each physics tick and automatically becomes neutral
5 seconds after the last manual frame command. Do not assume it will run forever.

Movement independent of camera heading, e.g. **east** in world coordinates
while the camera looks at a block (replace target coordinates as appropriate):

```text
motor on
motor frame {"moveWorld":{"x":1,"z":0},"lookAt":{"x":120,"y":72,"z":-135},"sprint":true}
motor off
```

With a bow in hand and arrows in inventory, a frame may hold use while
walking and tracking. Sprint is suppressed while the bow is drawn:

```text
motor on
motor frame {"forward":true,"left":true,"sprint":true,"use":true,"lookAt":{"x":120,"y":72,"z":-130}}
motor frame {"forward":true,"left":true,"use":false,"lookAt":{"x":120,"y":72,"z":-130}}
motor off
```

`motor off` ends use, clears movement keys and returns to an idle bot. `start`
returns to the **old** high-level autonomous planner after motor is disabled.
`pause` acts as an emergency stop for motor and high-level autonomy.

Attacks require `combat on`; attacking players additionally requires explicit
PvP enable and a target name in `PVP_ALLOWED_PLAYERS`.

## How a fast policy plugs in later

The motor interface accepts **all axes together**. No candidate-action
construction, no argmax, and no single mutually-exclusive behavior name.
A trained/learned or evaluated policy should run on an appropriate thread or
process and supply *the newest complete frame* to the controller, ideally
through a non-blocking, locally buffered interface. The physics tick must
**never await a large language model**.

Runtime module API:

```js
const {MotorController} = require('./src/motor');
const motor = new MotorController(bot, log, config);
motor.enable();
motor.setPolicy((bot, now) => ({
  moveWorld: {x: 0.7, z: 0.3},
  lookAt: {x: 130, y: 70, z: -140},
  jump: false, sprint: true, use: false, attack: false
}));
// Call motor.tick() from bot's physicsTick handler.
```

This is API shape only; sample numbers do not demonstrate autonomy. A fast
policy can replace those numbers on every tick based on perception, objective,
and recent history. It may output any legal combination; only Minecraft
input constraints and safety checks apply.
