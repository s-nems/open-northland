# Decide what the Religia row shows for a trade that never prays

**Area:** app · **Priority:** P3
**Needs user:** check the original's human window for a carpenter or a sewer that has been forging.

The forge clips spend religion on whoever plays them: `viking_carpenter_produce_spear_wooden` and both
`viking_sewer_produce_armor_*` carry `event <at> 4 -1500`. Only `jobtypes.ini`'s `needsReligionFlag` trades
(joiner, armorer, smith) walk to a temple, so a carpenter's or a sewer's bar drains to empty and stays
there, and the details panel shows a stat the player can never move.

## Scope

- Look at the original's window for such a settler: is the religion row shown at all, greyed, or full?
- Match it here: hide the row for a trade with no religion need, or leave it and say in the panel why it
  cannot be served.
- The sim side stays as it is - the drain is the clip's own and faithful.

## Verify

- The details-panel model test for a forging carpenter, and **user's eyes** on the panel.
