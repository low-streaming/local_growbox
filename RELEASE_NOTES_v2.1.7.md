# 🇩🇪 Deutsch
**Release v2.1.7 - Hotfix: Master Switch & Logic 🛠️**

Dieses Update behebt einen kritischen Fehler, der die Steuerung über den Master-Switch blockiert hat.

**Das ist neu in v2.1.7:**
-   **Status-Badges:** Sofortige Rückmeldung, ob das System online ist oder die Automatik pausiert wurde.
-   **Master Kill Switch (Neu in v2.1.7):** Der Master-Schalter deaktiviert nicht nur die Automatik, sondern schaltet alle Geräte aktiv aus, solange er auf AUS steht.
- **🛡️ Master Kill Switch:** Der Master-Schalter fungiert nun als echter Sicherheitsschalter. Wenn er auf AUS steht, werden alle Geräte (Licht, Pumpe, Befeuchter, Abluft) sofort ausgeschaltet und bleiben auch aus.
- **🛠️ Bugfix (Master Control):** Behebt den Fehler `name 'CONF_TARGET_HUMIDITY' is not defined`.
- **🛡️ Stabilitäts-Fix (Dashboard):** (Aus v2.1.6) Das Dashboard verschwindet nicht mehr nach längerer Laufzeit.
- **⚡ Performance-Boost:** Optimiertes Rendering für statische Tabs.

---

# 🇬🇧 English
**Release v2.1.7 - Hotfix: Master Switch & Logic 🛠️**

This update fixes a critical bug that blocked control via the Master Switch.

**What's new in v2.1.7:**
-   **Visual Feedback:** High-contrast status badges for system and automation status.
-   **Master Kill Switch (New in v2.1.7):** The Master Switch now actively turns off all devices and keeps them off while deactivated.
- **🛠️ Master Kill Switch:** The Master Switch now acts as a true safety switch. When OFF, all managed devices (Light, Pump, Humidifier, Fan) are actively turned off and kept off.
- **🛠️ Bugfix (Master Control):** Fixed the error `name 'CONF_TARGET_HUMIDITY' is not defined`.
- **🛡️ Dashboard Stability Fix:** (From v2.1.6) Resolved the issue where the dashboard could "disappear" after long periods.
- **⚡ Performance Boost:** Optimized rendering for static tabs.
