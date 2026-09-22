import subprocess

cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'python|arduino|putty\' } | Select-Object ProcessId, Name, CommandLine | Format-List"'
out = subprocess.check_output(cmd, shell=True).decode('ascii', errors='replace')
print(out)
