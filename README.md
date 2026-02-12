# Local Grow Box für Home Assistant
buymeacoffee.com/lowstreaming
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![github_release](https://img.shields.io/github/v/release/low-streaming/local_growbox?style=for-the-badge)](https://github.com/low-streaming/local_growbox/releases)
[![github_license](https://img.shields.io/github/license/low-streaming/local_growbox?style=for-the-badge)](https://github.com/low-streaming/local_growbox/blob/master/LICENSE)

[English Version below](#local-grow-box-for-home-assistant)

**Eine datenschutzfreundliche, lokale Integration zur Verwaltung von Indoor-Grow-Umgebungen mit eigenem Dashboard.**

Verwandeln Sie Ihre vorhandenen Sensoren und intelligenten Steckdosen in einen vollautomatischen Grow-Box-Controller mit professionellem Dashboard. Jetzt mit **deutscher Benutzeroberfläche** und **einfacher Konfiguration**.

## 🌟 Funktionen

- **100% Lokal**: Keine Cloud. Volle Privatsphäre.
- **Grow Room Dashboard**: Ein spezielles Panel in der Seitenleiste für die Übersicht aller Grow-Boxen.
- **Automatisierte Lichtzyklen**: 
  - *Keimling/Wachstum*: 18/6h
  - *Blüte*: 12/12h
- **Klimasteuerung**: Automatische Lüftersteuerung basierend auf Temperatur & Feuchtigkeit (VPD-optimiert).
- **VPD Berechnung**: Echtzeit-Berechnung des Dampfdruckdefizits.
- **Kamera & Bilder**: 
  - Live-Ansicht Ihrer Pflanzen (falls Kamera vorhanden).
  - **Neu:** Hochladen eigener Bilder für jede Box per Klick/Tap.
- **Einfache Konfiguration**:
  - **Neu:** Eigener "Einstellungen"-Tab im Dashboard.
  - Zuweisen von Lampen, Lüftern, Pumpen und Sensoren direkt über Dropdown-Menüs.

## 🚀 Installation

### HACS (Empfohlen)
1.  HACS > Integrationen > 3 Punkte > Benutzerdefinierte Repositories.
2.  URL dieses Repositories hinzufügen.
3.  **Local Grow Box** installieren und Home Assistant neu starten.

## ⚙️ Einrichtung

1.  Gehen Sie zu **Einstellungen > Geräte & Dienste**.
2.  **Integration hinzufügen** > **Local Grow Box**.
3.  Geben Sie der Box einen Namen (z.B. "Tomaten Zelt").
4.  (Optional) Wählen Sie erste Entitäten aus. Sie können alle Entitäten später bequem im Dashboard ändern.

## 🖥️ Dashboard (Grow Room)

Die Integration installiert automatisch ein **"Grow Room"** Panel in Ihrer Seitenleiste.

### Übersicht
*   **Status auf einen Blick**: Visuelle Balken für Temperatur, Feuchtigkeit und Licht.
*   **Steuerung**: Schalten Sie Master-Switch, Pumpe oder Licht direkt.
*   **Phase wählen**: Ändern Sie die Wachstumsphase (Keimling, Wachstum, Blüte, Trocknen, Veredelung) per Dropdown.
*   **Bild anpassen**: Klicken Sie auf das Stift-Symbol im Bild, um ein aktuelles Foto Ihrer Pflanze hochzuladen.

### Einstellungen (Neu!)
*   Klicken Sie oben auf den Tab **"Einstellungen"**.
*   Hier können Sie für jede Box die zugehörigen Geräte auswählen:
    *   Licht-Steuerung (Schalter/Licht)
    *   Abluft-Ventilator (Schalter/Ventilator)
    *   Wasserpumpe
    *   Kamera
    *   Temperatur- & Feuchtigkeitssensoren
    *   Zielwerte für Temperatur und Feuchtigkeit

---

# Local Grow Box for Home Assistant

**A privacy-first, local integration for managing indoor grow environments with a custom dashboard.**

Turn your existing sensors and smart plugs into a fully automated Grow Box controller. Now with **German UI** and **easy configuration**.

## 🌟 Features

- **100% Local**: No cloud dependencies.
- **Grow Room Dashboard**: A dedicated sidebar panel to monitor all your grow boxes.
- **Automated Light Cycles**:
  - *Seedling/Vegetative*: 18/6h
  - *Flowering*: 12/12h
- **Climate Control**: Automated fan control based on temp & humidity target (VPD optimized).
- **VPD Calculation**: Real-time Vapor Pressure Deficit calculation.
- **Camera & Images**:
  - Live view of your plants (if camera configured).
  - **New:** Upload custom images for each box directly from the dashboard.
- **Easy Configuration**:
  - **New:** Dedicated "Settings" tab in the dashboard.
  - Assign lights, fans, pumps, and sensors via dropdown menus.

## 🚀 Installation

### HACS (Recommended)
1.  HACS > Integrations > Custom Repositories.
2.  Add this repository URL.
3.  Install **Local Grow Box** and restart Home Assistant.

## ⚙️ Setup

1.  Go to **Settings > Devices & Services**.
2.  **Add Integration** > **Local Grow Box**.
3.  Give your box a name (e.g., "Tomato Tent").
4.  (Optional) Select initial entities. You can change all entities later comfortably in the dashboard.

## 🖥️ Dashboard (Grow Room)

The integration automatically adds a **"Grow Room"** panel to your sidebar.

### Overview
*   **Status at a glance**: Visual bars for temperature, humidity, and light.
*   **Control**: Toggle master switch, pump, or light directly.
*   **Select Phase**: Change growth phase (Seedling, Vegetative, Flowering, Drying, Curing) via dropdown.
*   **Customize Image**: Click the pencil icon on the image to upload a current photo of your plant.

### Settings (New!)
*   Click the **"Settings"** tab at the top.
*   Here you can configure the devices for each box:
    *   Light Control (Switch/Light)
    *   Exhaust Fan (Switch/Fan)
    *   Water Pump
    *   Camera
    *   Temperature & Humidity Sensors
    *   Target values for Temperature and Humidity
