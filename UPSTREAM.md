# Upstream provenance

WebFerment is a BrewPiLess derivative targeting ESP32-C3 using the Arduino framework.

- BrewPiLess: https://github.com/vitotai/BrewPiLess
- Imported revision: 165c827eb1b17b8e7f40b338ad7ce0c98c17e76c
- Original copyright and license notices are retained. BrewPi controller files are GPL-3.0-or-later; bundled libraries retain their own licenses.
- Interface styling is inspired by https://github.com/whitto/webbrew/tree/main/web . No kettle control API is used.

The controller, profile engine, device configuration, logging and web protocol remain upstream BrewPiLess. Changes focus on C3 compatibility and presentation.

Arduino packaging: original firmware sources and embedded headers now reside under `WebFerment/src`; `WebFerment.ino` provides the sketch entry. The upstream PlatformIO configuration was removed in favour of Arduino IDE / CLI.
