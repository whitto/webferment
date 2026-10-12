#!/usr/bin/env bash
set -euo pipefail
cd /workspace/webferment
python3 scripts/build_web.py
/workspace/bin/arduino-cli --config-file scripts/arduino-cli.yaml compile \
  --fqbn esp32:esp32:esp32c3:FlashSize=4M,PartitionScheme=min_spiffs \
  --jobs 2 --output-dir /workspace/webferment/build WebFerment
