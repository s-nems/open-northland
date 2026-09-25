# Decide what the Religia row shows for a trade that never prays

**Area:** app · **Priority:** P3
**Needs user:** check the original's human window for a carpenter or a sewer that has been forging.

The forge clips spend religion on whoever plays them: `viking_carpenter_produce_spear_wooden` and both
`viking_sewer_produce_armor_*` carry `event <at> 4 -1500`. Only `jobtypes.ini`'s `needsReligionFlag` trades
(joiner, armorer, smith) go to pray on their own, so a carpenter's or a sewer's bar moves only when the
player orders a prayer or when it stands within reach of an undamaged temple of its owner, whose blessing
adds religion every second while the bar is at or below the sated level. Otherwise the bar drains to empty
and stays there, and the details panel shows a stat that looks stuck.

## Scope

- Look at the original's window for such a settler: is the religion row shown at all, greyed, or full?
- Match it here: hide the row for a trade with no religion need, or leave it and say in the panel that an
  ordered prayer or a temple nearby is what fills it.
- The sim side stays as it is - the drain is the clip's own and faithful.

## Verify

- The details-panel model test for a forging carpenter, and **user's eyes** on the panel.
