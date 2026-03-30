# 🇩🇪 Deutsch
**Release v2.1.5 - Smart Humidifier Pulse & UI Refinements 🚀**

Dieses Update bringt bedeutende Verbesserungen für die Luftfeuchtigkeitssteuerung und die Benutzererfahrung im Dashboard.

**Das ist neu in v2.1.5:**
- **💦 Befeuchter-Impuls (Pulse Logic):** Der Luftbefeuchter kann nun mit einer festen Laufzeit (Dauer) konfiguriert werden. Nach jedem Impuls wartet das System 10 Minuten, damit sich die Feuchtigkeit verteilen kann. Das verhindert ein Überfeuchten durch träge Sensoren.
- **🔌 Dedizierter Befeuchter-Schalter:** Ein neuer Schalter für den Luftbefeuchter wurde direkt in Home Assistant hinzugefügt. So hast du die volle manuelle Kontrolle und siehst den Automatik-Status auf einen Blick.
- **📊 Verbessertes Dashboard:** 
    * Der Balken für die Luftfeuchte zeigt nun grafisch die Ziel-Zone (+/- 5%) an.
    * Ein neuer Button zur manuellen Steuerung des Befeuchters wurde hinzugefügt.
    * Das Protokoll (Logs) flackert nicht mehr bei Sensor-Updates und hat ein frisches Design mit Aktualisierungs-Button erhalten.
- **🛠️ Logik-Fix:** Die Klimasteuerung für den Befeuchter funktioniert nun auch dann korrekt, wenn kein Abluft-Ventilator konfiguriert ist.

*Viel Spaß beim Growen! 🌿*

---

# 🇬🇧 English
**Release v2.1.5 - Smart Humidifier Pulse & UI Refinements 🚀**

This update brings significant improvements to humidity control and the dashboard user experience.

**What's new in v2.1.5:**
- **💦 Humidifier Pulse Logic:** You can now configure a fixed run duration for the humidifier. After each pulse, the system waits for 10 minutes to allow the moisture to distribute. This prevents over-humidification caused by sensor lag.
- **🔌 Dedicated Humidifier Switch:** A new switch entity for the humidifier has been added directly to Home Assistant, giving you full manual control and a clear view of the automated state.
- **📊 Dashboard Enhancements:** 
    * The humidity bar now visually displays the target zone (+/- 5%).
    * A new manual control button for the humidifier has been added to the quick actions.
    * The logs tab no longer flickers on sensor updates and features a fresh design with a refresh button.
- **🛠️ Logic Fix:** Climate automation for the humidifier now works correctly even if no exhaust fan is configured.

*Happy Growing! 🌿*
