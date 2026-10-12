# Changelog

## 0.5

Reimagine WebFerment’s interface while preserving BrewPiLess’s firmware engine.

- Add a dashboard with temperature/gravity metric cards, recorded-history chart ranges, controller activity and a saved-profile summary.
- Add direct temperature mode/target controls using the existing BrewPiLess protocol. Enforce controller limits, wait for acknowledgement and disable writes when readings are stale or the connection is lost.
- Redesign the fermentation profile editor, retaining ramp/hold stages, gravity and stability conditions, save/load and activation.
- Apply shared responsive navigation, typography and panels across the existing controller tools, including PID tuning, sensors, hydrometers, logs and backups.
- Retain visible BrewPiLess by vitotai attribution and original copyright/licence notices.
- Keep the Arduino ESP32-C3 sketch and PID/control sources unchanged. Firmware compilation and hardware testing are deferred.

Validated through a browser integration suite with simulated device responses and the retained binary log parser. Screenshots in the README show simulated data.
