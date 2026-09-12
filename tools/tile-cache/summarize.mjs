import { readFile } from "node:fs/promises";

function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    min: sorted[0],
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1),
  };
}

for (const file of process.argv.slice(2)) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const groups = {};
  for (const run of report.runs || []) {
    (groups[run.configuration.name] ||= []).push(run);
  }
  console.log(
    JSON.stringify(
      {
        file,
        error: report.error || null,
        conditions: Object.fromEntries(
          Object.entries(groups).map(([name, runs]) => [
            name,
            {
              returnMs: distribution(runs.map((run) => run.visits[2].settleMs)),
              returnRequests: runs.map(
                (run) => run.visits[2].serverRequests.length,
              ),
              journeyRequests: runs
                .filter((run) => run.journey)
                .map((run) => run.journey.at(-1).serverRequests.length),
              restartRequests: runs
                .filter((run) => run.restart)
                .map((run) => run.restart.serverRequests.length),
              decodedHits: runs
                .filter((run) => run.visits[2].decoded)
                .map((run) => run.visits[2].decoded.hits),
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}
