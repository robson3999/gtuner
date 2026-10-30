if ("serviceWorker" in navigator) {
  const status = document.querySelector("#offline-status");
  status.hidden = false;
  status.textContent = "Preparing for offline use…";

  try {
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    status.textContent = "Ready for offline use.";
  } catch (error) {
    status.textContent = "Offline setup failed. Reopen online to retry.";
    console.warn("Could not prepare Tuner for offline use:", error);
  }
}
