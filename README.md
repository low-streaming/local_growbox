# Local Grow Box für Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

[English Version below](#local-grow-box-for-home-assistant)

**Eine Cloud-freie, lokale Integration zur Verwaltung von Indoor-Grow-Umgebungen.**

Diese benutzerdefinierte Komponente ermöglicht es Ihnen, Ihre vorhandenen Sensoren und intelligenten Steckdosen in einen vollautomatischen Grow-Box-Controller zu verwandeln.

## Funktionen

- **100% Lokal**: Keine Cloud-Abhängigkeiten. Läuft vollständig auf Ihrer Home Assistant-Instanz.
- **Automatisierte Lichtzyklen**: Schaltet das Licht basierend auf der ausgewählten Wachstumsphase automatisch.
  - *Keimling (Seedling)*: 18h AN / 6h AUS (Startet um 06:00)
  - *Vegetativ*: 18h AN / 6h AUS (Startet um 06:00)
  - *Blüte (Flowering)*: 12h AN / 12h AUS (Startet um 06:00)
- **VPD Funktionalität**: Berechnet das Dampfdruckdefizit (Vapour Pressure Deficit - VPD) in Echtzeit.
- **Hauptschalter**: Ein einziger Schalter zum Aktivieren/Deaktivieren der gesamten Automatisierung.

## Installation

### HACS (Empfohlen)
1.  Gehen Sie zu HACS > Integrationen > 3 Punkte > Benutzerdefinierte Repositories.
2.  Fügen Sie diese Repository-URL hinzu.
3.  Installieren Sie **Local Grow Box**.
4.  Starten Sie Home Assistant neu.

### Manuell
1.  Kopieren Sie den Ordner `custom_components/local_grow_box` in Ihr `config/custom_components/` Verzeichnis.
2.  Starten Sie Home Assistant neu.

## Konfiguration

1.  Gehen Sie zu **Einstellungen > Geräte & Dienste**.
2.  Klicken Sie auf **Integration hinzufügen** und suchen Sie nach **Local Grow Box**.
3.  Folgen Sie dem Einrichtungsassistenten:
    -   **Name**: Benennen Sie Ihre Grow-Box.
    -   **Licht-Entität**: Wählen Sie den Schalter, der Ihre Pflanzenlampe steuert.
    -   **Lüfter-Entität**: Wählen Sie den Schalter, der Ihren Lüfter steuert.
    -   **Temperatursensor**: Wählen Sie Ihr Thermometer.
    -   **Feuchtigkeitssensor**: Wählen Sie Ihr Hygrometer.

## Verwendung

Nach der Installation erhalten Sie ein neues Gerät mit den folgenden Entitäten:

-   **Sensor**: Dampfdruckdefizit (kPa)
-   **Auswahl (Select)**: Wachstumsphase (Keimling, Vegetativ, Blüte, Trocknung)
-   **Schalter (Switch)**: Hauptschalter

Ändern Sie die **Wachstumsphase**, um den Lichtplan automatisch anzupassen.
Schalten Sie den **Hauptschalter** um, um die Automatisierung zu pausieren/fortzusetzen.

## Roadmap

-   [ ] Anpassbare Lichtpläne pro Phase.
-   [ ] Lüftergeschwindigkeitssteuerung basierend auf VPD / Temperaturzielen.
-   [ ] Unterstützung für mehrere Licht-/Lüfter-Entitäten.

---

# Local Grow Box for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

**A cloud-free, local integration for managing indoor grow environments.**

This custom component allows you to turn your existing sensors and smart plugs into a fully automated Grow Box controller.

## Features

- **100% Local**: No cloud dependencies. Runs entirely on your Home Assistant instance.
- **Automated Light Cycles**: Automatically switches lights based on the selected growth phase.
  - *Seedling*: 18h ON / 6h OFF (Starts at 06:00)
  - *Vegetative*: 18h ON / 6h OFF (Starts at 06:00)
  - *Flowering*: 12h ON / 12h OFF (Starts at 06:00)
- **VPD Functionality**: Calculates Vapor Pressure Deficit (VPD) in real-time.
- **Master Control**: Single switch to enable/disable all automation.

## Installation

### HACS (Recommended)
1.  Go to HACS > Integrations > 3 Dots > Custom Repositories.
2.  Add this repository URL.
3.  Install **Local Grow Box**.
4.  Restart Home Assistant.

### Manual
1.  Copy the `custom_components/local_grow_box` folder to your `config/custom_components/` directory.
2.  Restart Home Assistant.

## Configuration

1.  Go to **Settings > Devices & Services**.
2.  Click **Add Integration** and search for **Local Grow Box**.
3.  Follow the setup wizard:
    -   **Name**: Name your grow box.
    -   **Light Entity**: Select the switch controlling your grow light.
    -   **Fan Entity**: Select the switch controlling your fan.
    -   **Temperature Sensor**: Select your thermometer.
    -   **Humidity Sensor**: Select your hygrometer.

## Usage

After installation, you will get a new device with the following entities:

-   **Sensor**: Vapor Pressure Deficit (kPa)
-   **Select**: Grow Phase (Seedling, Vegetative, Flowering, Drying)
-   **Switch**: Master Control

Change the **Grow Phase** to automatically adjust the light schedule.
Toggle **Master Control** to pause/resume automation.

## Roadmap

-   [ ] Customizable light schedules per phase.
-   [ ] Fan speed control based on VPD / Temp targets.
-   [ ] Support for multiple light/fan entities.
