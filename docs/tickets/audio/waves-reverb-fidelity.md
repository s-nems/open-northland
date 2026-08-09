# Match the DirectSound Waves Reverb response

**Area:** audio · **Priority:** P1

Music segments route the synthesized DLS mix through an authored DirectSound Waves Reverb DMO.
The pipeline's Freeverb approximation has the right parameter inputs but the wrong mix and decay:
for `Mission_AddOn_Franken2_Standard`, it scores worse against the supplied soundtrack reference
than the dry SpessaSynth render. A local synthetic impulse probe of the Microsoft DMO confirms that
the authored `-4.8 dB` mix attenuates the direct path and keeps substantially more energy after
100 ms than the approximation.

## Scope

- Replace `stages/music/reverb.ts` with an independent cross-platform response whose dry/wet law,
  early reflections, stereo spread, and decay follow the published Waves Reverb parameters.
- Use synthetic impulses through a locally installed DMO only as a validation oracle. Do not commit
  DMO binaries, impulse captures, game audio, or fitted sample tables.
- Keep the implementation deterministic and offline; do not add a Windows or Wine runtime
  dependency to the asset pipeline.
- Recheck every distinct authored reverb parameter tuple in the owned segment corpus instead of
  tuning only the Franken2 example.

## Verify

- Synthetic unit tests pin dry/wet gain, stereo decorrelation, parameter scaling, and the tail
  envelope without embedding captured samples.
- `npm run test:pipeline` renders the owned corpus without clipping or failures.
- A local A/B page compares the dry render, the approximation, the native-DMO oracle, and the
  soundtrack reference. Human review decides fidelity; similarity measurements are diagnostic only.
