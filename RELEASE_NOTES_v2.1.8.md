# 🇩🇪 Deutsch
**Release v2.1.8 - Dynamic Hysteresis & Config Fix 🔄**

Dieses Update macht die Visualisierungen im Dashboard konsistent mit deinen Einstellungen und schaltet fehlende Konfigurationsoptionen frei.

**Das ist neu in v2.1.8:**
- **🌡️ Universelle Hysterese:** Du hast nun die volle Kontrolle! Sowohl für die **Temperatur** als auch für die **Luftfeuchtigkeit** und die **Abluft** können nun eigene Hysteresen eingestellt werden.
- **🎯 Symmetrische Zielzonen:** Die visuellen Balken im Dashboard zeigen nun automatisch eine symmetrische "Wohlfühlzone" (+/- deine Hysterese) an.
- **🎨 Optimale UI-Struktur:** Die Einstellungen im Dashboard wurden logisch neu gruppiert (Sollwert + Hysterese direkt untereinander).
- **🛡️ Master Kill Switch:** (Aus v2.1.7) Maximale Sicherheit: Wenn der Master-Schalter auf AUS steht, werden alle Geräte (Licht, Pumpe, Befeuchter, Abluft) aktiv ausgeschaltet und bleiben aus.
- **⚙️ HA-Konfigurations-Sync:** Alle Hysterese- und Zielwerte sind jetzt auch über den offiziellen Home Assistant Konfigurations-Dialog erreichbar.
- **📊 Verbesserte Skalierung:** Der Feuchtigkeitsbalken wurde für einen größeren Bereich (20-90%) optimiert, um auch extreme Einstellungen korrekt darzustellen.
- **📖 Hilfe-Update:** Die Info-Texte wurden korrigiert und erklären nun die dynamische Zielzonen-Visualisierung.

---

# 🇬🇧 English
**Release v2.1.8 - Dynamic Hysteresis & Config Fix 🔄**

This update aligns the dashboard visualizations with your actual settings and unlocks missing configuration options.

**What's new in v2.1.8:**
- **🌡️ Universal Hysteresis:** Full control unlocked! Configure individual hysteresis for **Temperature**, **Humidity**, and **Exhaust Fan**.
- **🎯 Symmetric Target Zones:** Visual bars on the dashboard now automatically display a symmetric "Comfort Zone" (+/- your custom hysteresis).
- **🎨 Refined UI Layout:** Settings are now logically grouped (Target value followed by its Hysteresis) for a better user experience.
- **🛡️ Master Kill Switch:** (From v2.1.7) Maximum safety: When Master is OFF, all devices (Light, Pump, Humidifier, Fan) are actively turned off and stay off.
- **⚙️ HA Options Sync:** All target and hysteresis values are now exposed in the official Home Assistant configuration dialog.
- **📊 Improved Scaling:** The humidity bar range has been expanded (20-90%) to better represent extreme target settings.
- **📖 Help Update:** Help texts have been corrected to accurately describe the dynamic target zone visualization.
