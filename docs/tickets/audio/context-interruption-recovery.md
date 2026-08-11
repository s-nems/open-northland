# Bring audio back after the context is interrupted

**Area:** audio · **Priority:** P2

`startSound` (`packages/app/src/view/sound-start.ts`) unbinds its gesture listeners as soon as
`sound.started` turns true, and nothing else ever calls `resume()`: there is no `statechange` listener
on the `AudioContext` anywhere in `packages/audio/src`. Once the browser or the OS suspends a running
context, `WebAudioEngine.canPlay()` stays false and the session is silent until a page reload.

Reachable on iOS/iPadOS Safari through a phone call or a Siri interruption (the context goes
`interrupted`, then `suspended`), and on the desktop through OS sleep/resume or Chrome suspending a
context it considers idle. One-shot effects made this easy to miss; a soundtrack that stops and never
returns does not.

## Scope

- Listen for `statechange` on the context and recover when it leaves `running`: re-`resume()`, or
  re-bind the gesture listeners so the next click restores audio.
- `canPlay()` already gates on `state === 'running'` and `resume()` already re-asserts the desired
  music through `assertMusic()`, so only the trigger is missing.

## Verify

- Engine test over a fake context: move `state` to `suspended` after a successful resume, fire
  `statechange`, and assert the engine becomes audible again without a page reload.
- Human check on iOS Safari with a real interruption.
