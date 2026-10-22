import "server-only";
import { runJobs } from "@/lib/recurring/run";

export function startJobs() {
  if (process.env.JOBS === "off") return;
  const tick = () =>
    runJobs()
      .then((r) => r && (r.created || r.reminders || r.failed) && console.log("jobs:", r))
      .catch((e) => console.error("jobs failed", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
}
