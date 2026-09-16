# Technology and individual qualifications

Technology belongs to a player and tribe. Qualifications belong to an individual worker. Discovering
carpentry does not give every worker the experience needed to become a carpenter.

## Rules and data

The owned CnMod `DataCnmd/tribetypes12/tribetypes.ini` supplies `jobEnables*`, `needfor*`, `trainfor*`,
`toBuildHouseNeedJob` and `toBuildHouseNeedGood`. `Data/logic/humanjobexperiencetypes.ini` identifies
profession-general and product-specific experience tracks. `DataCnmd/types/houses.ini` supplies
`logicSchoolSize`. The pipeline carries the complete lists, including repeated house requirements.

- A worker who qualifies for a profession or product discovers it for that player and tribe. Merely
  starting a map already assigned to a gated profession does not bypass its experience requirement.
  Qualifying for a new profession also exposes its basic products, preventing circular prerequisites
  between a workshop and the first product its future worker can make.
- A building requires every listed profession and product discovery. These are capabilities, not
  quantities in storage. Construction materials remain a separate requirement.
- Discoveries persist through retraining, ownership changes, death and save/load. A new owner retains
  its own discoveries and can gain discoveries from the worker it receives.
- Existing buildings keep operating without requiring their construction technology again. A new
  profession requires player availability and the individual qualification.
- At the start a job with no `needforjob` row and a good no job produces count as discovered; an AI
  seat skips every discovery requirement and civilian experience gate (authored: the progression
  toggle is a human-player setting and must not handicap the bots). The discovery system records
  discoveries after each tick's commands and mission results, and again after its work.
- Catalogs without the optional technology table persist discoveries from their profession edges. The
  committed fallback catalog is a smaller approximation of the extracted prerequisites.
- Map Allow grants permission; Enable grants availability and never lifts a ban. Shared gates serve
  placement, upgrades, profession selection, gathering, production, AI and mission goals. EnableGood
  leaves the producing job alone (reading; only a chest reward enables it in the original). House
  discovery enables water for wells, honey for beehives, and meat, leather and wool for animal farms
  (reading of `EnableHouse`). These bindings use owned catalog names at the data boundary.

## Experience and school

Completed gathering and production credit both the general and matching specialization tracks.
Construction swings that actually advance labor credit the builder's general track. Carrying and
combat retain their existing grant triggers. A requirement sums only its explicitly named tracks.
The no-job-experience mission behavior suppresses accrual through the common grant seam.

Saved experience uses a factor-scaled encoding: one counted action contributes its track's
`experienceFactor`. Requirement readers divide by that factor. This encoding is an internal
representation, not a claim about the original's in-memory values. Work counters cap at 10,000 counted
actions.

Right-click a school with selected workers to choose a civilian profession or product. The player must
already know it; a product must belong to the worker's profession. School places are reserved by
active training orders, and a course is refused while the school is full, the target already learned
or the school's door out of the worker's reach; the dialog greys such courses with the reason.
Reissuing the same course keeps its progress (the original restarts the count, an approximation);
choosing another starts a new course. A completed course grants only the chosen qualification, not a
general education currency. Changing profession releases the old workplace. Moving cancels the order;
needs can interrupt it without losing progress. A school lost to demolition or another owner cancels
the course. Military recruitment remains the barracks' responsibility.

The qualification lists and active course survive save/load and sub-mission restoration. The
profession picker and production choices read these same qualifications. Discovery notifications
show the local player's newly acquired capabilities; setup discoveries are silent. The details panel
shows the course target and remaining lesson time. `?scene=school` exercises the same course command
and school planner used on custom maps.

## Evidence and fidelity limits

The macOS symbol readings through analysis provide hypotheses about behavior. Relevant functions are
`an original routine`, `DoesExperienceAllowJobChange`, `DoesEducationAllowJobChange`,
`an original routine`, `DoExecuteUserCommand_LearnJob`, `DoExecuteUserCommand_LearnGood`, and
`an original routine`, under their `an original routine` or `an original routine` namespaces.
The owned readable tables confirm the distinct requirements and general/specialized tracks. They do
not independently prove the lifetime of every flag or all scheduling details.

Remaining approximations:

- Schooling serves one second per required lesson point, rounded up to completed exercise animations.
  The original counts completed exercise animations (each adds its atomic event value, one in the
  mod's `viking_civilist_exercise`) against the sum of the paired `trainforjob` and `trainforgood`
  rows, and offers a course as a job with one of its goods rather than the two apart;
  `docs/tickets/features/technology-professions-experience.md` carries both.
- Gathering XP counts extracted units; production XP counts completed batches. Exact original atomic
  triggers and the efficiency curve still require observational comparison. Existing work, combat
  and scout bonus curves remain the documented approximations in the progression helpers.
- Saved natural discoveries use the same monotonic lifetime suggested by the inspected writes.
  Reset behavior across every original map transition has not been observed.
- The original distinguishes additional individual equipment qualifications. The military and
  equipment rules stand apart from this model.

Tests establish the implemented contract, deterministic continuation and integration. They are not a
claim of complete parity with the original executable.
