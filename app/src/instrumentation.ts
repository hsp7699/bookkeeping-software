// Background jobs (recurring transactions, overdue reminders) run inside the
// app server every 15 minutes. An advisory lock keeps it to one run at a time.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.JOBS === "off") return;
  const { runJobs } = await import("@/lib/recurring/run");
  const tick = () =>
    runJobs()
      .then((r) => r && (r.created || r.reminders || r.failed) && console.log("jobs:", r))
      .catch((e) => console.error("jobs failed", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
}
