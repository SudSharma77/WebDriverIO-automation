/**
 * One writer at a time per client project.
 *
 * The client's project is a shared mutable thing: `catalog.json`,
 * `specs.json` and the page-object files are all read-modify-write, and
 * nothing about that pattern is atomic across an await. Two writers finishing
 * close together each read the same starting state and the second one's write
 * wins, silently discarding the first's locators.
 *
 * That is not hypothetical. `orchestrator.ts` runs the web, Android and iOS
 * lanes of a single run *in parallel*, and all three call `recordSuccess`
 * against the same project. Multiple people driving one client at once only
 * widens the same window.
 *
 * In-process is the right scope today: there is one server process, and the
 * contention it has to survive is its own parallel lanes. The moment this runs
 * as more than one process against a shared clients directory, this becomes a
 * lock file with a stale timeout instead — the call sites would not change,
 * only this module.
 */

/**
 * Tail of each client's queue. A key is present only while work is queued or
 * running, so this never grows past the number of clients being written to
 * right now.
 */
const chains = new Map<string, Promise<void>>();

/**
 * Run `work` once every earlier caller for this client has finished.
 *
 * A failing job releases the lock like any other — the chain is joined on
 * settlement, not on success, so one bad save cannot wedge every later save
 * for that client. The caller still sees its own rejection.
 */
export function withClientLock<T>(clientId: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(clientId) ?? Promise.resolve();

  // `previous` is always a settled-swallowing tail (below), so it never
  // rejects and `work` is therefore always reached.
  const result = previous.then(work);

  const release = () => {
    // Only the current tail clears the entry. A later caller has already
    // replaced it, and deleting theirs would let the next arrival start
    // concurrently with work still in flight.
    if (chains.get(clientId) === tail) chains.delete(clientId);
  };
  const tail: Promise<void> = result.then(release, release);

  chains.set(clientId, tail);
  return result;
}

/** Whether anything is queued or running for this client. Tests and diagnostics. */
export function isLocked(clientId: string): boolean {
  return chains.has(clientId);
}
