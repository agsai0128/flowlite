# FlowLite native paste helper (Windows).
# Sends a single Ctrl+V to the current foreground window via Win32 keybd_event.
# It emits exactly one paste chord and exits; it does not read or log any input.
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

[FlowLite.Kbd]::keybd_event($VK_CONTROL, 0, 0, $zero)      # Ctrl down
[FlowLite.Kbd]::keybd_event($VK_V, 0, 0, $zero)            # V down
Start-Sleep -Milliseconds 15
[FlowLite.Kbd]::keybd_event($VK_V, 0, $KEYUP, $zero)       # V up
[FlowLite.Kbd]::keybd_event($VK_CONTROL, 0, $KEYUP, $zero) # Ctrl up
