import { expect, it } from 'vitest';
import { bcp47Tag } from '../../../src/i18n/index.js';
import { schoolChoices, schoolGroups } from '../../../src/view/unit-controls/panels/school-dialog.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

it.skipIf(!hasRealIr())('lists discovered-capable methods under the profession that uses them', async () => {
  const { merge } = await loadContentUnderTest();
  const content = merge.content;
  const tribe = content.tribes.find((row) => row.id === 'viking');
  if (tribe === undefined) throw new Error('missing viking tribe');
  const groups = schoolGroups(content, tribe.typeId);
  const goodIds = (jobId: string): string[] => {
    const job = content.jobs.find((row) => row.id === jobId);
    const group = groups.find((row) => row.jobType === job?.typeId);
    return (
      group?.courses
        .filter((course) => course.target === 'good')
        .map((course) => content.goods.find((good) => good.typeId === course.typeId)?.id ?? '') ?? []
    );
  };
  expect(goodIds('collector')).toEqual(['iron', 'gold']);
  expect(goodIds('joiner').slice(0, 3)).toEqual(['tool_wooden', 'tool_iron', 'furniture']);
  expect(goodIds('smith')).toEqual(expect.arrayContaining(['armor_chain', 'armor_plate']));
  const compare = new Intl.Collator(bcp47Tag(), { sensitivity: 'base' }).compare;
  const labels = groups.map((group) => group.label);
  expect(labels).toEqual([...labels].sort(compare));
  const smith = content.jobs.find((row) => row.id === 'smith');
  const joiner = content.jobs.find((row) => row.id === 'joiner');
  const plate = content.goods.find((row) => row.id === 'armor_plate');
  if (smith === undefined || joiner === undefined || plate === undefined)
    throw new Error('missing school choice content');
  const visible = schoolChoices(
    groups,
    (course) =>
      (course.target === 'good' && course.typeId === plate.typeId) ||
      (course.target === 'job' && course.typeId === joiner.typeId),
  );
  expect(visible.find((group) => group.jobType === smith.typeId)?.courses).toEqual([
    expect.objectContaining({ target: 'good', typeId: plate.typeId }),
  ]);
  expect(visible.map((group) => group.jobType)).toEqual(
    expect.arrayContaining([joiner.typeId, smith.typeId]),
  );
});
