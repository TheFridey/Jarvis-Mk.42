$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ScreenMetadata {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder text,int length);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle,out uint processId);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
 [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT point,uint flags);
 [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor,int type,out uint x,out uint y);
}
'@
[void][ScreenMetadata]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$window=[ScreenMetadata]::GetForegroundWindow()
$title=New-Object Text.StringBuilder 1024
[void][ScreenMetadata]::GetWindowText($window,$title,$title.Capacity)
[uint32]$foregroundProcessId=0
[void][ScreenMetadata]::GetWindowThreadProcessId($window,[ref]$foregroundProcessId)
$foregroundProcess=Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
$rect=New-Object ScreenMetadata+RECT
[void][ScreenMetadata]::GetWindowRect($window,[ref]$rect)
$cursor=[System.Windows.Forms.Cursor]::Position
$activeMonitor=[System.Windows.Forms.Screen]::FromHandle($window)
$monitors=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
 $centre=New-Object ScreenMetadata+POINT
 $centre.X=$_.Bounds.X+[int]($_.Bounds.Width/2);$centre.Y=$_.Bounds.Y+[int]($_.Bounds.Height/2)
 [uint32]$monitorDpiX=0;[uint32]$monitorDpiY=0
 if([ScreenMetadata]::GetDpiForMonitor([ScreenMetadata]::MonitorFromPoint($centre,2),0,[ref]$monitorDpiX,[ref]$monitorDpiY) -ne 0){throw 'monitor DPI unavailable'}
 @{id=$_.DeviceName;label=$_.DeviceName;x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;scaleFactor=$monitorDpiX/96.0;primary=$_.Primary}
})
$active=@{title=$title.ToString();application=$foregroundProcess.ProcessName;processId=[int]$foregroundProcessId;windowId=$window.ToInt64().ToString();bounds=@{x=$rect.Left;y=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top}}
try { $active.executable=$foregroundProcess.Path } catch { }
@{source='windows';coordinateSpace='physical-pixels';monitors=$monitors;activeMonitorId=$activeMonitor.DeviceName;activeWindow=$active;cursor=@{x=$cursor.X;y=$cursor.Y};observedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 6 -Compress

