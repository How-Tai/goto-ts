# Host sleep and guest stall warnings — 12 October 2026

The user reported Windows sleeping and showed Ubuntu RCU/soft-lockup warnings. Read-only checks found a Windows Modern Standby entry at 18:58:32 Bangkok (Idle Timeout), battery-budget events at 19:11:54 and wake at 19:27:30. Host sleep suspends execution needed by a VirtualBox guest; the shown warnings are consistent with that interval. This is not evidence by itself of a renewed awake-state virtualization stall.

The active Acer plan had automatic sleep disabled on charger power but enabled after 180 seconds on battery. Screen-off was Never on charger power and 180 seconds on battery. Hibernate-after timers were 43,200 seconds on charger power and 10,800 seconds on battery. The inspected laptop was currently plugged in and reported 100% battery; that current snapshot does not prove charger status throughout the sleep interval.

After wake, API, website, nginx, ngrok and monitoring services were active, all six graders were running, PostgreSQL was healthy and MinIO was running. The website returned HTTP 200. No VM restart, worker Kill or submission rejudge was performed by this investigation.

The user's earlier requested configuration is Never automatic sleep with the screen turning off after five minutes. A reversible helper was prepared to restore that setting for charger and battery operation, and set the idle hibernate timer to Never. It does not change lid/power-button behavior, critical-battery safeguards, Windows security, firmware, VM settings, fast-startup configuration, or install a keep-awake/background task.

The original power plan and per-setting values will be saved in `D:\otog-grader\vm-setup\no-idle-sleep-20261012` before any setting changes. The helper is `D:\otog-grader\vm-setup\restore-no-idle-sleep-20261012.ps1`, supporting `-Mode Restore`. Windows administrator approval is required for exporting the original plan. The first non-administrator attempt stopped on that backup privilege check before changing settings. An administrator prompt was subsequently launched, but Windows reported that the operation was canceled. The helper never started, no power settings were changed, and no background keep-awake task was installed.

Microsoft describes how [Modern Standby suspends desktop applications](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/integrating-apps-with-modern-standby) and [separate battery/charger sleep timeout settings](https://support.microsoft.com/en-us/windows/experience/power-battery/power-settings-in-windows-11).

## Applied and verified at 19:47 Bangkok

The user approved the second administrator prompt. The helper completed successfully at 12:47:44 UTC. Independent powercfg queries confirmed sleep-after and hibernate-after are zero (Never), and screen-off is 300 seconds (five minutes), for both AC and DC on the same Acer plan. The original plan export and before.json are saved in the backup folder above. A subsequent SSH health check confirmed all five system services active, six graders running, PostgreSQL healthy, MinIO running and website HTTP 200. No Windows or VM restart was performed; no background keep-awake task was installed. Manual Sleep, lid actions and critical-battery safeguards remain unchanged.
