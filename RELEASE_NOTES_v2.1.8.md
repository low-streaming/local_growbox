# 🇩🇪 Deutsch
**Release v2.1.8 - Dynamic Hysteresis & Config Fix 🔄**

Dieses Update macht die Visualisierungen im Dashboard konsistent mit deinen Einstellungen und schaltet fehlende Konfigurationsoptionen frei.

**Das ist neu in v2.1.8:**
- **🔄 Dynamische Zielzone:** Der helle Bereich im Feuchtigkeitsbalken im Dashboard ist nun nicht mehr auf feste 5% hardcodiert, sondern passt sich symmetrisch (+/-) an deine eingestellte **Hysterese** an.
- **⚙️ Volle Kontrolle:** Die Hysterese und alle Zielwerte (Temperatur, Feuchte, VPD-Zonen) können nun auch über den offiziellen **Home Assistant Konfigurations-Dialog** (Einstellungen -> Integrationen -> Konfigurieren) geändert werden.
- **📊 Verbesserte Skalierung:** Der Feuchtigkeitsbalken wurde für einen größeren Bereich (20-90%) optimiert, um auch extreme Einstellungen korrekt darzustellen.
- **📖 Hilfe-Update:** Die Info-Texte wurden korrigiert und erklären nun die dynamische Zielzonen-Visualisierung.

---

# 🇬🇧 English
**Release v2.1.8 - Dynamic Hysteresis & Config Fix 🔄**

This update aligns the dashboard visualizations with your actual settings and unlocks missing configuration options.

**What's new in v2.1.8:**
- **🔄 Dynamic Target Zone:** The highlighted area in the humidity bar is no longer hardcoded to 5%. It now adjust symmetrically (+/-) based on your custom **hysteresis** setting.
- **⚙️ Full Control:** Hysteresis and all target values (Temperature, Humidity, VPD zones) can now be edited via the official **Home Assistant Configuration Dialog** (Settings -> Integrations -> Configure).
- **📊 Improved Scaling:** The humidity bar range has been expanded (20-90%) to better represent extreme target settings.
- **📖 Help Update:** Help texts have been corrected to accurately describe the dynamic target zone visualization.
