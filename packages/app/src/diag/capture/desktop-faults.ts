import type { ReportError, ReportLog } from '@open-northland/data';
import { routeFor } from '../../routes.js';
import type { DesktopFault, DesktopFaults } from '../../view/platform/desktop-faults.js';
import { errorText } from '../error-text.js';
import { diag } from '../log.js';
import { type Problem, reportProblem } from '../report/problem.js';
import { reportErrorOf } from './report-error.js';

export type ProblemRoute = NonNullable<Problem['earlier']>['route'];

/** What the page itself knew of the moment the shell recorded. */
export interface FaultExtras {
  /** The fault ended a previous page, or happened before this page started. */
  readonly previousSession: boolean;
  readonly log?: ReportLog;
  readonly route?: ProblemRoute;
  readonly facts?: Readonly<Record<string, unknown>>;
}

/** The first line of a stack is its error's `name: message`. */
function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end === -1 ? text : text.slice(0, end);
}

function faultError(fault: DesktopFault): ReportError | undefined {
  switch (fault.trigger) {
    case 'error':
      return reportErrorOf('desktop', {
        name: fault.reason,
        message: fault.stack === null ? fault.reason : firstLine(fault.stack),
        ...(fault.stack === null ? {} : { stack: fault.stack }),
      });
    // The hung page's call stack says where it was stuck, which is what the report groups by.
    case 'renderer-unresponsive':
      return fault.stack === null
        ? undefined
        : reportErrorOf('main', {
            name: 'Unresponsive',
            message: 'the page stopped responding',
            stack: fault.stack,
          });
    case 'renderer-gone':
    case 'gpu-gone':
      return undefined;
  }
}

function routeOfUrl(url: string | null): ProblemRoute {
  if (url === null) return undefined;
  try {
    const params = new URL(url).searchParams;
    return { entry: routeFor(params).id, params: Object.fromEntries(params) };
  } catch {
    return undefined;
  }
}

export function desktopFaultProblem(fault: DesktopFault, extras: FaultExtras): Problem {
  const error = faultError(fault);
  const route = extras.route ?? routeOfUrl(fault.url);
  return {
    trigger: fault.trigger,
    ...(error === undefined ? {} : { error }),
    facts: {
      reason: fault.reason,
      exitCode: fault.exitCode,
      durationMs: fault.durationMs,
      ...(fault.gpuStatus === null ? {} : { gpuStatus: fault.gpuStatus }),
      ...extras.facts,
    },
    earlier: {
      id: fault.id,
      at: fault.at,
      previousSession: extras.previousSession,
      ...(extras.log === undefined ? {} : { log: extras.log }),
      ...(route === undefined ? {} : { route }),
    },
  };
}

/**
 * Hand the faults the shell recorded of one moment to the report flow as one problem, and let the
 * shell forget them: a hang's call stack is what the report groups by, so a fault carrying one leads,
 * and the others' reasons ride along as facts. The report flow keeps its own copy.
 */
export async function reportDesktopFaults(
  faults: DesktopFaults,
  group: readonly DesktopFault[],
  extras: FaultExtras,
): Promise<void> {
  const lead = group.find((fault) => fault.stack !== null) ?? group[0];
  if (lead === undefined) return;
  const others = group.filter((fault) => fault !== lead);
  const alsoRecorded = others.map(({ trigger, reason, exitCode, at }) => ({ trigger, reason, exitCode, at }));
  reportProblem(
    desktopFaultProblem(lead, {
      ...extras,
      ...(alsoRecorded.length === 0 ? {} : { facts: { ...extras.facts, alsoRecorded } }),
    }),
  );
  await clearDesktopFaults(faults, group);
}

/** Let the shell forget `group` unreported. */
export async function clearDesktopFaults(
  faults: DesktopFaults,
  group: readonly DesktopFault[],
): Promise<void> {
  if (group.length === 0) return;
  const ids = group.map((fault) => fault.id);
  try {
    await faults.clear(ids);
  } catch (error) {
    diag.warn('crash', `the desktop shell kept faults ${ids.join(', ')}: ${errorText(error)}`);
  }
}

export async function pendingDesktopFaults(faults: DesktopFaults): Promise<readonly DesktopFault[]> {
  try {
    return await faults.pending();
  } catch (error) {
    diag.warn('crash', `the desktop shell's faults could not be read: ${errorText(error)}`);
    return [];
  }
}
