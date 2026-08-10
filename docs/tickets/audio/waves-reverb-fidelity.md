# Stop the music reverb darkening the spectral balance

**Area:** audio · **Priority:** P2

The A/B review this ticket asked for has happened, and it inverts the ticket's original premise.
Against the soundtrack reference for `Mission_AddOn_Franken2_Standard`, human review ranked the
Freeverb approximation above both the dry render and the native Waves Reverb DMO oracle, calling the
DMO the most fatiguing of the three. Reverb quantity is therefore not the defect: gap-filling already
matches the reference (15.1 dB of short-window dynamic range for both, against 14.3 dB for the DMO
and 15.9 dB dry), and stereo width already exceeds it (side/mid -3.3 dB against -3.9 dB).

What remains is spectral tilt. The render carries roughly 1.3 dB too much energy at 0.5-1 kHz and
too little at 1-4 kHz. `stages/music/reverb.ts` fixes its comb damping at the dark extreme because
every segment authors the 0.001 high-frequency decay ratio, so the wet path adds low-mid energy the
reference does not have.

## Scope

- Retune the damping and high-frequency decay law in `stages/music/reverb.ts` so the wet path stops
  tilting the balance downward, keeping the authored mix and decay time as its inputs.
- Recheck every distinct authored reverb parameter tuple in the owned segment corpus instead of
  tuning only the Franken2 example.
- Keep the implementation deterministic and offline; do not add a Windows or Wine runtime
  dependency to the asset pipeline.
- Do not commit DMO binaries, impulse captures, game audio, or fitted sample tables.

## Verify

- Synthetic unit tests pin dry/wet gain, stereo decorrelation, parameter scaling, and the tail
  envelope without embedding captured samples.
- `npm run test:pipeline` renders the owned corpus without clipping or failures.
- Band-energy comparison against the reference is diagnostic only; human A/B review decides fidelity.
