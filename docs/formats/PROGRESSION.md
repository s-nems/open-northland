# Technology and individual qualifications

Technology belongs to a player and tribe. Qualifications belong to an individual worker. Discovering
carpentry does not give every worker the experience needed to become a carpenter.

## Rules and data

The owned CnMod `DataCnmd/tribetypes12/tribetypes.ini` supplies `jobEnables*`, `needfor*`, `trainfor*`,
`toBuildHouseNeedJob` and `toBuildHouseNeedGood`. `Data/logic/humanjobexperiencetypes.ini` identifies
profession-general and product-specific experience tracks. `DataCnmd/types/houses.ini` supplies
`logicSchoolSize`. The pipeline carries the complete lists, including repeated house requirements.

- A worker who qualifies for a profession or product discovers it for that player and tribe.
  Qualifying for a new profession also exposes its basic products, preventing circular prerequisites
  between a workshop and the first product its future worker can make.
- A building requires every listed profession and product discovery. These are capabilities, not
  quantities in storage. Construction materials remain a separate requirement.
- Discoveries persist through retraining, ownership changes, death and save/load. A new owner retains
  its own discoveries and can gain discoveries from the worker it receives.
- Existing buildings keep operating without requiring their construction technology again. New
  professions still require player availability and individual qualifications.
- Catalogs without the optional technology table persist discoveries from their profession edges.
  Their initial reads still support worlds assembled before the first tick. The committed fallback
  catalog is a smaller approximation of the extracted prerequisites.
- Map Allow grants permission; Enable grants availability. Shared gates serve placement, upgrades,
  profession selection, gathering, production, AI and mission goals. EnableGood also enables its
  unique producer where the tribe's good edges identify one unambiguously. House discovery enables
  water for wells, honey for beehives, and meat, leather and wool for animal farms. These bindings
  use owned catalog names at the data boundary.

## Experience and school

Completed gathering and production credit both the general and matching specialization tracks.
Construction swings that actually advance labor credit the builder's general track. Carrying and
combat retain their existing grant triggers. A requirement sums only its explicitly named tracks.
The no-job-experience mission behavior suppresses accrual through the common grant seam.

Saved experience retains the existing factor-scaled encoding: one counted action contributes its
track's `experienceFactor`. Requirement readers divide by that factor. This encoding is an internal
representation, not a claim about the original's in-memory values. Work counters cap at 10,000 counted
actions. Restoring content revisions before 11 into revision 11 or later adds previously accumulated
specialization counts to their general track; re-export uses the current content revision, so this
conversion runs once. Historical discovery events cannot be reconstructed from an old save; current
workers seed discoveries when the simulation resumes.

Right-click a school with selected workers to choose a civilian profession or product. The player must
already know it; a product must belong to the worker's profession. School places are reserved by
active training orders. Reissuing the same course keeps its progress; choosing another starts a new
course. A completed course grants only the chosen qualification, not a general education currency.
Changing profession releases the old workplace. Moving cancels the order; needs can interrupt it
without losing progress. A school lost to demolition or another owner cancels the course. Military
recruitment remains the barracks' responsibility.

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
  The original's exact lesson timing, costs and interruption semantics have not been observed.
- Gathering XP counts extracted units; production XP counts completed batches. Exact original atomic
  triggers and the efficiency curve still require observational comparison. Existing work, combat
  and scout bonus curves remain the documented approximations in the progression helpers.
- Saved natural discoveries use the same monotonic lifetime suggested by the inspected writes.
  Reset behavior across every original map transition has not been observed.
- Enable still overrides a conflicting map ban. Ambiguous producer lookups remain unmodelled; see MISSIONS.md.
- The original distinguishes additional individual equipment qualifications. Existing military and
  equipment rules are retained; this change does not establish complete equipment fidelity.

Tests establish the implemented contract, deterministic continuation and integration. They are not a
claim of complete parity with the original executable.
