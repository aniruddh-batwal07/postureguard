Import("env")
import os

local_temp = r"C:\tmp"
os.makedirs(local_temp, exist_ok=True)

os.environ["TMP"] = local_temp
os.environ["TEMP"] = local_temp
os.environ["TMPDIR"] = local_temp

env["ENV"]["TMP"] = local_temp
env["ENV"]["TEMP"] = local_temp
env["ENV"]["TMPDIR"] = local_temp
