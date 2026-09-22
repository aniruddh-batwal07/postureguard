import subprocess

ps_script = """
Get-PnpDevice -Class Ports | Where-Object { $_.FriendlyName -like "*CH340*" } | Select-Object FriendlyName, InstanceId, Status, Problem | Format-List
"""

out = subprocess.check_output(['powershell', '-Command', ps_script])
print(out.decode('utf-8', errors='ignore'))
