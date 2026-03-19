#!/usr/bin/env python3
"""Extract cmd-api.py from provision-droplet.sh and write to /opt/cmd-api.py"""
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
provision_path = os.path.join(script_dir, "provision-droplet.sh")

lines = open(provision_path).readlines()
start = None
end = None
for i, line in enumerate(lines):
    if "cat > /opt/cmd-api.py" in line:
        start = i + 1
    if start and line.strip() == "PYEOF":
        end = i
        break

if start and end:
    with open("/opt/cmd-api.py", "w") as f:
        f.writelines(lines[start:end])
    print(f"Wrote {end - start} lines to /opt/cmd-api.py")
else:
    print("ERROR: Could not find cmd-api.py block in provision script")
    exit(1)
