# Proposed VirtualBox performance change

Status: **both settings applied; Windows restarted; direct AMD-V verified**. The user explicitly approved both settings after their purpose and security effects were explained. Windows administrator approval was obtained. The first restart did not disable VBS, so the subsequently approved Memory Integrity toggle was applied. After the second restart, Windows reports no active hypervisor or VBS, and the new VM log confirms direct AMD-V with nested paging. See the follow-up below.

## Evidence and purpose

Windows currently reports an active hypervisor and running Memory Integrity (Device Guard security service 2). Firmware virtualization is enabled on the Ryzen 7 8845HS. The existing investigation confirms that VirtualBox uses its Windows Hypervisor Platform/NEM compatibility backend. The proposed change allows a controlled comparison with VirtualBox's direct AMD-V backend after a Windows restart. Improved performance and disappearance of stalls are not yet verified or guaranteed.

Oracle documents [poor performance with VirtualBox and Hyper-V together](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/Troubleshooting.html). Microsoft documents [the hypervisor launch boot setting](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/bcdedit--set#hypervisor-settings).

## Exact proposed change

Set `hypervisorlaunchtype` to `Off` for the current Windows boot entry. This is a persistent setting, effective only after restarting Windows.

- Memory Integrity and other security protections that depend on the Windows hypervisor cannot run with it disabled. Memory Integrity is currently running; Credential Guard is not reported as running.
- Hyper-V virtual machines, WSL2, Windows Sandbox, and Docker Desktop configurations that depend on Hyper-V/WSL2 will be unavailable until the setting is restored and Windows restarted.
- This helper does not disable Defender, the firewall, Secure Boot, or firmware AMD-V. It does not uninstall Windows features or change security registry configuration.
- Applying this pending boot setting does not stop the current VM, website or six graders. The later Windows restart will cause downtime and must be coordinated separately.

## Preparation and reversal

The reviewed helper is `D:\otog-grader\vm-setup\set-native-amdv-20261012.ps1`. It needs a Windows administrator approval prompt. It checks Windows disk-encryption protection and refuses to change the boot configuration if protection is enabled or cannot be verified. It does not suspend or turn off disk encryption.

Before applying the setting, the helper saves the original setting, boot-entry identifier and a BCD export on D in `D:\otog-grader\vm-setup\native-amdv-20261012`. It verifies the pending setting afterward and does not reboot the PC.

The same helper with `-Mode Restore`, run as administrator, restores only the original hypervisor-launch setting (or removes the explicit override if there was none). It does not import or overwrite the entire boot store. Restoration also requires a Windows restart to take effect.

## After a separately coordinated restart

Start the VM from a complete guest shutdown rather than a saved running state. Verify that Windows no longer reports an active hypervisor and that the new VirtualBox log confirms direct AMD-V instead of NEM fallback. Verify the database, website, ngrok, monitoring and all six graders. Then repeat the same diagnostic workload and compare measured CPU/elapsed times before claiming any improvement.

The original approval attempt was rejected by automatic approval review because general permission to change security did not explicitly authorize this exact persistent boot change and its effects. No Windows settings were changed by that rejected attempt. The later, explicitly authorized application succeeded.

## Application results — 12 October 2026, 10:50 Bangkok

- Original setting: `hypervisorlaunchtype Auto`. Pending verified setting: `hypervisorlaunchtype Off`.
- Windows disk-encryption protection check returned status 0 (protection off). No disk-encryption setting was changed.
- Boot-store export saved on D: `vm-setup/native-amdv-20261012/bcd-before.bak` (45,056 bytes). The original setting and entry identifier are saved in `before.json`.
- The administrator helper completed successfully and exited. Windows was not restarted; the current virtualization backend remains active until reboot.
- API, website, nginx, ngrok and monitoring services are active. All six grader containers are running, PostgreSQL is healthy, and MinIO is running. The website returned HTTP 200.
- Windows antivirus and real-time protection are enabled. Domain, Private and Public firewall profiles are enabled.
- Direct AMD-V and any performance improvement have not yet been verified. Follow the post-restart checks above before making a performance claim.

To restore the original setting, run the following in an administrator PowerShell window and subsequently restart Windows:

```powershell
& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File 'D:\otog-grader\vm-setup\set-native-amdv-20261012.ps1' -Mode Restore
```

For the first restart, wait until grading has finished, shut Ubuntu down normally rather than saving its running state, restart Windows, then start the VM.

## Post-restart check — 12 October 2026, 11:03 Bangkok

Windows restarted at 10:53:20, after the application. The same current boot entry retains `hypervisorlaunchtype Off`, but HypervisorPresent is true and Memory Integrity is still running. The new VM log again confirms NEM fallback rather than direct AMD-V. The predicted disabling of hypervisor-based protection by this single boot flag did not occur on this Windows configuration.

A separate backed-up Memory Integrity toggle was prepared during the read-only investigation. Detailed evidence is in `D:\otog-grader\BEAUTIFUL-NUMBER-377-20261012.md`. No security, grading or worker settings were changed during that investigation.

## Explicit Memory Integrity toggle — 12 October 2026, 11:08:54 Bangkok

The user explicitly approved this additional setting and approved the Windows administrator prompt. `HypervisorEnforcedCodeIntegrity\Enabled` was changed from DWORD 1 to DWORD 0 and read back successfully. The original value is saved in `vm-setup/native-amdv-20261012/memory-integrity-before.json`; the relevant registry export is `memory-integrity-before.reg` (418 bytes). All backups are on D.

Defender antivirus and real-time protection remain enabled, and all three firewall profiles are enabled. The running Windows session still has Memory Integrity active until the next Windows restart. The website returned HTTP 200 and all six graders and supporting services remain running. Windows and the VM were not restarted or stopped.

To restore both original settings, run these in administrator PowerShell, then restart Windows:

```powershell
& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File 'D:\otog-grader\vm-setup\set-memory-integrity-native-amdv-20261012.ps1' -Mode Restore
& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File 'D:\otog-grader\vm-setup\set-native-amdv-20261012.ps1' -Mode Restore
```

These restore Memory Integrity Enabled=1 and the original hypervisorlaunchtype Auto. No full-registry or full-boot-store import is needed.

## Successful backend verification and results

After the Windows restart at 11:30:29 Bangkok, Memory Integrity and VBS were no longer running and HypervisorPresent was false. The new VM log opened at 11:31:49 confirms direct AMD-V with nested paging. Read-only checks of existing regrades found Beautiful Number 377 now AC at 2.128 s, compared with its earlier TLE at 3.070 s; several Omakaza sorting submissions were also substantially faster. Supporting services and all six graders were running. See `D:\otog-grader\NATIVE-AMD-V-RESULTS-20261012.md` for matched-source comparisons and their measurement limits.
