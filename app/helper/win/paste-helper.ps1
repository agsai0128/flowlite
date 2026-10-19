# FlowLite persistent ("warm") paste helper (Windows).
# Compiles the keybd_event binding once, prints "ready", then loops on stdin: on a
# "paste" line it sends one Ctrl+V chord to the foreground window and prints "ok".
# Exits when stdin closes. It only emits a synthetic paste chord; it reads and logs
# no keyboard input. Kept warm so insertions don't pay a PowerShell cold-start.
$ErrorActionPreference = 'Stop'
$sig = @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@
Add-Type -MemberDefinition $sig -Name Kbd -Namespace FlowLite | Out-Null

$VK_CONTROL = [byte]0x11
$VK_V       = [byte]0x56
$KEYUP      = [uint32]0x0002
$zero       = [System.UIntPtr]::Zero

function Send-Paste {
  [FlowLite.Kbd]::keybd_event($VK_CONTROL, 0, 0, $zero)      # Ctrl down
  [FlowLite.Kbd]::keybd_event($VK_V, 0, 0, $zero)            # V down
  Start-Sleep -Milliseconds 15
  [FlowLite.Kbd]::keybd_event($VK_V, 0, $KEYUP, $zero)       # V up
  [FlowLite.Kbd]::keybd_event($VK_CONTROL, 0, $KEYUP, $zero) # Ctrl up
}

[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }   # stdin closed -> exit
  if ($line.Trim() -eq 'paste') {
    Send-Paste
    [Console]::Out.WriteLine('ok'); [Console]::Out.Flush()
  }
}
