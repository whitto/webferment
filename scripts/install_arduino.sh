#!/usr/bin/env bash
set -euo pipefail
cd /workspace/webferment
mkdir -p /workspace/bin /workspace/.arduino/{data,downloads,user/libraries}
if [[ ! -x /workspace/bin/arduino-cli ]]; then
  task_download_dir=$(mktemp -d /tmp/webferment-cli.XXXXXX)
  trap 'rm -rf "$task_download_dir"' EXIT
  curl --fail --location https://github.com/arduino/arduino-cli/releases/download/v1.2.2/arduino-cli_1.2.2_Linux_64bit.tar.gz -o "$task_download_dir/arduino-cli_1.2.2_Linux_64bit.tar.gz"
  curl --fail --location https://github.com/arduino/arduino-cli/releases/download/v1.2.2/1.2.2-checksums.txt -o "$task_download_dir/checksums.txt"
  (cd "$task_download_dir"; rg ' arduino-cli_1.2.2_Linux_64bit.tar.gz$' checksums.txt | sha256sum --check --strict)
  tar -xzf "$task_download_dir/arduino-cli_1.2.2_Linux_64bit.tar.gz" -C /workspace/bin arduino-cli
fi
/workspace/bin/arduino-cli --config-file scripts/arduino-cli.yaml version | rg 'Version: 1.2.2 '
# Keep dependency checkouts outside the project. Never reset existing files.
ensure_library() {
  local name=$1 remote=$2 revision=$3
  local destination="/workspace/.arduino/user/libraries/$name"
  if [[ ! -e "$destination" ]]; then
    git clone "$remote" "$destination"
    git -C "$destination" checkout --detach "$revision"
  fi
  [[ $(git -C "$destination" rev-parse HEAD) == "$revision" ]] || { echo "Unexpected library revision: $name" >&2; exit 1; }
  [[ -z $(git -C "$destination" status --porcelain) ]] || { echo "Local library changes: $name" >&2; exit 1; }
}
ensure_library ArduinoJson https://github.com/bblanchon/ArduinoJson.git 7abf875071a79e3e506cf8334773d647a5caad98
ensure_library NimBLE-Arduino https://github.com/h2zero/NimBLE-Arduino.git a99c7d6c7de8c582e243d97cd8ec8c8aad4a4687
ensure_library AsyncTCP https://github.com/me-no-dev/AsyncTCP.git ca8ac5f919d02bea07b474531981ddbfd64de97c
ensure_library ESPAsyncWebServer https://github.com/arjenhiemstra/ESPAsyncWebServer.git 43381ab7fb6345aae5f81a06d49747c624406706
# Install the retained upstream libraries through the standard sketchbook path.
for source in /workspace/webferment/lib/* /workspace/webferment/lib-esp32/*; do
  [[ -d "$source" ]] || continue
  destination="/workspace/.arduino/user/libraries/$(basename "$source")"
  if [[ ! -e "$destination" && ! -L "$destination" ]]; then
    ln -s "$source" "$destination"
  else
    [[ $(readlink -f "$destination") == "$source" ]] || { echo "Existing library conflicts with $source" >&2; exit 1; }
  fi
done
# Arduino CLI uses its documented network.proxy setting in cloud environments.
if [[ -n ${HTTPS_PROXY:-} ]]; then export ARDUINO_NETWORK_PROXY="$HTTPS_PROXY"; fi
/workspace/bin/arduino-cli --config-file scripts/arduino-cli.yaml core update-index
/workspace/bin/arduino-cli --config-file scripts/arduino-cli.yaml core install esp32:esp32@2.0.17
