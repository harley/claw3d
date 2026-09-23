# Grab & Glide experiment

An isolated alternative to compare with Cloud Claw on a real webcam. The player positions, grabs, carries and deliberately releases the toy. No physical acceptance or enjoyment claim is made.

## Checkout and launch

- Owner: this Grab & Glide implementation task.
- Baseline: `origin/main` at `9b2b7639de74ef5dfb8cfb8a9b7a9e10e6974b66`.
- Branch: `experiment/grab-and-glide`.
- Worktree: `/Users/qron/code/claw3d-grab-and-glide`.
- Preview port: `4211` (strict; do not stop another preview if occupied).

```sh
cd /Users/qron/code/claw3d-grab-and-glide
npm ci
npm run build
npx vite preview --host 127.0.0.1 --port 4211 --strictPort
```

Open [Grab & Glide](http://127.0.0.1:4211/grab-and-glide.html). Click **Play with camera**, grant camera access and hold one open hand still. Use **Build & controls** to check the exact build. For development, use `npm run dev -- --port 4211`; `?input=pointer` is available only on the development server. Move the pointer, hold the primary button to grab and release it to open. Synthetic input does not validate webcam recognition.

The unchanged Cloud Claw entry remains at [/](http://127.0.0.1:4211/?setup=manual). The experiment imports neither the session/score API nor production telemetry. Run data stays in memory under its own game instance and clears on reload; it does not touch baseline local storage or shared runs.

## Controls and rules

- One hand, either left or right. Hand displacement maps directly onto a fixed screen-aligned plane; no depth or camera rotation. Acquisition anchors the current claw pose.
- Open to position; close for 180 ms to grab; move while closed to carry; open for 220 ms to release. The last intentional claw pose freezes during confirmation. These values, the 260 ms rearm and 300 ms freshness limit live in `src/grab-and-glide/game.js`.
- Exactly three attempts, each with 15 seconds of active positioning/carrying. A miss, early release or timeout ends that attempt. Dropped and banked toys leave the available pool; a missed grab leaves its toys available.
- Two plush toys earn 100 points; the smaller star earns 200 and uses a tighter visible opening. The claw's cyan opening fits the nearest available toy. Pickup requires the complete circular footprint inside that opening; neither claw nor toy snaps into alignment.
- Release with the whole footprint inside the amber tray to bank. Take the clear lower route or carry left-to-right through the upper gate. A clean full traversal earns 50 extra points only on banking, once per attempt. Contact with either rail crosses out the gate, forfeits the bonus and keeps the toy. Swept collision prevents jumping through a rail between samples.
- Missing, stale, ambiguous ownership, duplicate or out-of-order evidence freezes the interaction and active clock. With cargo, show an open hand to reacquire ownership, then hold closed to rearm. Opening during reacquisition cannot release cargo. Without cargo, hold open to rearm. Camera restart follows the same recovery rules.
- Brief unclassified hand shapes freeze motion/time and clear confirmation; uncertainty beyond 180 ms requires rearming. The existing recognizer observes up to two hands, but only one can control.
- Replay resets all game and gesture evidence. Sound preference survives replay. OS reduced-motion preference initializes the control; the control suppresses cargo sway and long drop/bank animation.

## Verification and limits

The focused unit tests cover geometry, scoring, timestamp validation, confirmation, gesture boundaries and the inherited camera ownership path for both hands. The rendered browser suite exercises banking, missed grabs, early release, clean/failed gate routes, repeated gestures, loss/recovery, exactly three attempts, replay, mute, reduced motion, narrow layout and absence of network writes. It runs in the existing sequential browser runner:

```sh
npm run check
node scripts/check-browser.mjs --only grab-and-glide,camera,arcade
```

Screenshots are in locally ignored `.screenshots/grab-glide-*.png`. They use synthetic evidence, never recorded webcam frames. Original camera and arcade regression results, exact final commit and PR are reported in the task handoff.

Known limits: webcam feel is untested; conservative evidence handling can demand extra rearming when recognition flickers. Recovery anchors the frozen claw to the reacquired hand, so camera reach may require recentering and another rearm. Toy contact uses visible conservative circular footprints and exact swept contact against the rectangular rails, not rigid-body physics. Sway is bounded authored displacement; toys are reused Cloud Claw artwork. Narrow portrait screens render but desktop/laptop is the intended comparison surface. Menus require a click; there are no persistent scores or prizes.

## Physical comparison script

Use the same camera, display, browser, lighting and player distance for both versions. Record BUILD, hardware, hand and whether instructions were needed. Close the first camera tab before using the other.

1. Play one complete baseline run at `/`. Note accidental actions, responsiveness, time spent waiting and how much control you feel after pickup.
2. In Grab & Glide, choose a 100-point toy. Close while aligned, carry along the clear lower route, and open over the tray. Confirm the toy follows immediately and only banks when fully inside.
3. Miss once, then grab and open away from the tray. Both must end exactly one attempt with visible feedback. Confirm three outcomes lead to results and immediate replay.
4. Replay. Carry through the gate cleanly and bank for 150; touch a rail on another attempt and bank for 100. The toy must stay attached after rail contact.
5. While carrying, hide the hand for two seconds. Cargo and timer must freeze. Return open: no release. Close to rearm, carry again, then deliberately open. Repeat near expiry and with the other hand. Check mute and reduced motion.

The next question: **Does controlling the carry make a successful pickup more satisfying, without making rearming and deliberate release frustrating?**

## Delivery boundary

Draft experiment only. No merge, production deployment or live-data authority. Before publishing, GitHub workflow inspection confirmed production deployment is restricted to `main`; authenticated Railway inspection showed the production service's direct GitHub source disconnected (`source.repo: null`). Publishing this experiment does not change those settings. PR checks are synthetic engineering evidence, not physical acceptance.
