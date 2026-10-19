# FlowLite focused-field reader (Windows). Reads ONLY the currently focused UI
# Automation element — the app name, any selected text, and the text just before
# the caret. It does not enumerate other windows, read input, or touch the
# clipboard. Prints one compact JSON line, or {} if nothing is readable.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes | Out-Null
  $fe = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $fe) { '{}'; return }

  $out = [ordered]@{}
  try { $out.app = (Get-Process -Id $fe.Current.ProcessId -ErrorAction Stop).ProcessName } catch {}

  try {
    $tp = $fe.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    if ($null -ne $tp) {
      $sel = $tp.GetSelection()
      if ($sel -and $sel.Length -gt 0) {
        $selText = $sel[0].GetText(2000)
        if ($selText) { $out.selectedText = $selText }

        # Text from the document start up to the selection start = what's before the caret.
        $pre = $tp.DocumentRange.Clone()
        $pre.MoveEndpointByRange(
          [System.Windows.Automation.TextPatternRangeEndpoint]::End,
          $sel[0],
          [System.Windows.Automation.TextPatternRangeEndpoint]::Start)
        $preText = $pre.GetText(-1)
        if ($preText) {
          if ($preText.Length -gt 300) { $preText = $preText.Substring($preText.Length - 300) }
          $out.precedingText = $preText
        }
      }
    }
  } catch {}

  ($out | ConvertTo-Json -Compress)
} catch {
  '{}'
}
