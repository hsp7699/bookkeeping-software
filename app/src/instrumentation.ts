// Background jobs (recurring transactions, overdue reminders) run inside the
// app server every 15 minutes. An advisory lock keeps it to one run at a time.
// The import sits inside the NEXT_RUNTIME check so the edge build leaves it out.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobs } = await import("./jobs");
    startJobs();
  }
}
