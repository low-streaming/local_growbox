# Local Grow Box für Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![github_release](https://img.shields.io/github/v/release/low-streaming/local_growbox?style=for-the-badge)](https://github.com/low-streaming/local_growbox/releases)
[![github_license](https://img.shields.io/github/license/low-streaming/local_growbox?style=for-the-badge)](https://github.com/low-streaming/local_growbox/blob/master/LICENSE)

[English Version below](#local-grow-box-for-home-assistant)

**Eine Cloud-freie, lokale Integration zur Verwaltung von Indoor-Grow-Umgebungen mit eigenem Dashboard.**

Verwandeln Sie Ihre vorhandenen Sensoren und intelligenten Steckdosen in einen vollautomatischen Grow-Box-Controller mit professionellem Dashboard.

## 🌟 Funktionen

- **100% Lokal**: Keine Cloud. Volle Privatsphäre.
- **Automatisierte Lichtzyklen**: 
  - *Keimling/Vegetativ*: 18/6h
  - *Blüte*: 12/12h
- **Klimasteuerung**: Automatische Lüftersteuerung basierend auf Temperatur & Feuchtigkeit (VPD-optimiert).
- **VPD Berechnung**: Echtzeit-Berechnung des Dampfdruckdefizits.
- **Bewässerung**: Optionale Steuerung einer Wasserpumpe.
- **Kamera-Integration**: Live-Ansicht Ihrer Pflanzen direkt im Dashboard.
- **Grow Room Dashboard**: Ein spezielles Panel in der Seitenleiste für die Übersicht aller Grow-Boxen.

## 🚀 Installation

### HACS (Empfohlen)
1.  HACS > Integrationen > 3 Punkte > Benutzerdefinierte Repositories.
2.  URL dieses Repositories hinzufügen.
3.  **Local Grow Box** installieren und Home Assistant neu starten.

## ⚙️ Konfiguration

1.  Gehen Sie zu **Einstellungen > Geräte & Dienste**.
2.  **Integration hinzufügen** > **Local Grow Box**.
3.  Konfigurieren Sie Ihre Geräte:
    -   **Name**: z.B. "Tomaten Zelt"
    -   **Licht & Lüfter**: Ihre Smart Plugs.
    -   **Sensoren**: Temperatur & Feuchtigkeit.
    -   **Pumpe (Optional)**: Für automatische Bewässerung.
    -   **Kamera (Optional)**: Für Live-Überwachung.
    -   **Zielwerte**: Temperatur und max. Feuchtigkeit einstellen.

## 🖥️ Dashboard (Grow Room)

Die Integration installiert automatisch ein **"Grow Room"** Panel in Ihrer Seitenleiste.
-   **Übersicht**: Alle Ihre Grow-Boxen auf einen Blick.
-   **Steuerung**: Phase wählen, Master-Switch, Pumpe.
-   **Kamera**: Live-Bild direkt auf der Karte.
-   **Daten**: Visuelle Balken für Temperatur, Feuchtigkeit und VPD.

---

# Local Grow Box for Home Assistant

**A cloud-free, local integration for managing indoor grow environments with a custom dashboard.**

Turn your existing sensors and smart plugs into a fully automated Grow Box controller.

## 🌟 Features

- **100% Local**: No cloud dependencies.
- **Automated Light Cycles**:
  - *Seedling/Vegetative*: 18/6h
  - *Flowering*: 12/12h
- **Climate Control**: Automated fan control based on temp & humidity target.
- **VPD Calculation**: Real-time Vapor Pressure Deficit calculation.
- **Watering**: Optional water pump control.
- **Camera Support**: Live view of your plants in the dashboard.
- **Grow Room Dashboard**: A dedicated sidebar panel to monitor all your grow boxes.

## 🚀 Installation

### HACS (Recommended)
1.  HACS > Integrations > Custom Repositories.
2.  Add this repository URL.
3.  Install **Local Grow Box** and restart Home Assistant.

## ⚙️ Configuration

1.  Go to **Settings > Devices & Services**.
2.  **Add Integration** > **Local Grow Box**.
3.  Configure your hardware:
    -   **Name**: e.g. "Tomato Tent"
    -   **Light & Fan**: Select your smart switches.
    -   **Sensors**: Select your thermometer/hygrometer.
    -   **Pump (Optional)**: For irrigation.
    -   **Camera (Optional)**: For live monitoring.
    -   **Targets**: Set target temp and max humidity.

## 🖥️ Dashboard (Grow Room)

The integration automatically adds a **"Grow Room"** panel to your sidebar.
-   **Overview**: See all your grow boxes in one place.
-   **Control**: Change phases, toggle master switch or pump.
-   **Camera**: Live feed directly on the card.
-   **Data**: Visual bars for Temp, Humidity, and VPD.
