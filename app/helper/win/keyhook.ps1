# FlowLite native dictation-key hook (Windows).
# Installs a low-level keyboard hook (WH_KEYBOARD_LL) and prints one line per event
# to stdout: "down"/"up" for the configured dictation key, and "other" for any other
# key going down. It SWALLOWS the dictation key (so e.g. Caps Lock won't toggle) and
# passes every other key through untouched. It reports WHICH key only for the
# dictation key; other keys are reported anonymously. Injected (synthetic) events are
# ignored, so the app's own paste keystroke cannot trigger it.
#
# Usage: powershell -File keyhook.ps1 -Vk 20   (20 = 0x14 = Caps Lock)
param([int]$Vk = 0x14)
$ErrorActionPreference = 'Stop'

$code = @"
using System;
using System.Runtime.InteropServices;

public static class FlowLiteHook {
  const int WH_KEYBOARD_LL = 13;
  const int WM_KEYDOWN = 0x0100;
  const int WM_KEYUP = 0x0101;
  const int WM_SYSKEYDOWN = 0x0104;
  const int WM_SYSKEYUP = 0x0105;
  const uint LLKHF_INJECTED = 0x10;

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptx; public int pty; }

  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", SetLastError=true)] static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);

  static IntPtr _hook = IntPtr.Zero;
  static HookProc _proc;   // kept in a static field so the GC never collects the delegate
  static uint _target;
  static bool _down = false;

  static void Emit(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      bool injected = (k.flags & LLKHF_INJECTED) != 0;
      if (!injected) {
        int msg = (int)wParam;
        bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
        bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);
        if (k.vkCode == _target) {
          if (isDown) { if (!_down) { _down = true; Emit("down"); } }
          else if (isUp) { _down = false; Emit("up"); }
          return (IntPtr)1; // swallow the dictation key
        } else if (isDown) {
          Emit("other");
        }
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }

  public static void Run(uint target) {
    _target = target;
    _proc = Callback;
    _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
    if (_hook == IntPtr.Zero) { Console.Error.WriteLine("hook-failed"); return; }
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    UnhookWindowsHookEx(_hook);
  }
}
"@

Add-Type -TypeDefinition $code -Language CSharp | Out-Null
[FlowLiteHook]::Run([uint32]$Vk)
