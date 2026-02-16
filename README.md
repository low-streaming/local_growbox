# Local Grow Box Integration 🌿

**[🇩🇪 Deutsch](#-deutsch) | [🇬🇧 English](#-english)**

---

# 🇩🇪 Deutsch

Die **Local Grow Box** Integration verwandelt dein Home Assistant in eine vollautomatische Grow-Room-Steuerung. Sie verwaltet Lichtzyklen, Klima (VPD), Bewässerung und verfolgt die Wachstumsphasen über ein schickes, modernes Dashboard.

## ✨ Hauptfunktionen

### 1. **Phasen-Management** 🌱
Verfolge den Lebenszyklus deiner Pflanze vom Keimling bis zur Veredelung (Curing).
-   **Automatischer Tageszähler:** Setzt sich automatisch auf 0 zurück, wenn du die Phase wechselst.
-   **Phasen-Profile:** Vorkonfigurierte Lichtstunden für jede Phase (z.B. 18/6 für Wachstum, 12/12 für Blüte).
-   **Eigene Phasen:** Erstelle benutzerdefinierte Phasen mit eigenen Namen und Lichtzeiten.

### 2. **Smarter Lichtzyklus** 💡
-   **Automatische Steuerung:** Schaltet dein Licht basierend auf der aktuellen Phase AN/AUS.
-   **Flexible Startzeit:** Lege fest, wann der "Tag" beginnt (z.B. 18:00 Uhr), um Stromkosten zu sparen oder Hitze zu vermeiden.
-   **Timer-Anzeige:** Zeigt im Dashboard exakt an, wie lange das Licht noch an bleibt oder wann es wieder angeht.

### 3. **Klima-Kontrolle (VPD)** 🌪️
-   **Vapor Pressure Deficit (VPD):** Berechnet den VPD-Wert in Echtzeit aus Temperatur und Luftfeuchtigkeit.
-   **Smarte Abluft:** Steuert deinen Lüfter automatisch, um optimale Bedingungen zu schaffen.
-   **Visuelles Feedback:** Farbige Balken zeigen sofort, ob sich deine Werte im "grünen Bereich" befinden.

### 4. **Intelligentes Bewässerungssystem** 💧
-   **Bodenfeuchte-Trigger:** Aktiviert die Pumpe nur, wenn die Erde zu trocken ist.
-   **Präzise Dosierung:** Die Pumpe läuft für exakt die eingestellte Zeit (z.B. 5 Sekunden).
-   **Anti-Staunässe (Einwirkzeit):** Nach dem Gießen macht das System zwingend **15 Minuten Pause**. Erst wenn das Wasser verteilt ist und der Sensor immer noch "trocken" meldet, wird erneut gegossen.

### 5. **Kamera Integration** 📷
-   **Live-Ansicht:** Beobachte deine Pflanze direkt im Dashboard.
-   **Zoom-Popup:** Klicke auf das Kamerabild für eine Vollbild-Ansicht.

---

## 🚀 Installation & Einrichtung

1.  Kopiere den Ordner `custom_components/local_grow_box` in dein Home Assistant `/config/custom_components/` Verzeichnis.
2.  Starte Home Assistant neu.
3.  Gehe zu **Einstellungen -> Geräte & Dienste**.
4.  Klicke auf **Integration hinzufügen** und suche nach **"Local Grow Box"**.
5.  Ein neuer Menüpunkt **"Grow Room"** erscheint in deiner Seitenleiste.

---

## 🖥️ Das Dashboard

### **Übersicht (Overview)**
Deine Kommandozentrale.
-   **Live Status:** Temperatur, RLF, VPD, Bodenfeuchte und Licht-Status auf einen Blick.
-   **Schnellzugriff:** Manuelles Schalten von Licht, Pumpe oder Lüfter.
-   **Phasen-Wähler:** Ändere die Wachstumsphase direkt über das Dropdown-Menü im Bild.

### **Geräte & Config**
Hier verknüpfst du deine Home Assistant Geräte mit der Box.
-   **Sensoren:** Wähle deine Temperatur-, Feuchte- und Boden-Sensoren.
-   **Aktoren:** Wähle die Schalter (Switch) für Licht, Lüfter und Pumpe.
-   **Einstellungen:** Definiere Ziel-Temperatur, Max-RLF und Pumpdauer.
-   **Licht Startstunde:** Wann soll der Tag beginnen? (z.B. `18` für 18:00 Uhr).

### **Phasen**
Passe die Lichtdauer für jede Phase an (Standard: 18h Wachstum, 12h Blüte) oder erstelle eigene Phasen.

---

## 🛠️ Logik Details

-   **Licht:** Prüft jede Minute. Nutzt `Startstunde` und `Phasendauer`. Beispiel: Start 18:00, Dauer 12h -> Licht AN von 18:00 bis 06:00.
-   **Pumpe:** Prüft alle 5 Sekunden. Wenn Feuchtigkeit < Zielwert UND Pumpe war >15 Minuten aus -> Pumpe AN für X Sekunden.

---
---

# 🇬🇧 English

The **Local Grow Box** integration turns your Home Assistant instance into a fully automated Grow Room controller. It manages light cycles, climate (VPD), watering, and tracking of growth phases through a dedicated, beautiful dashboard panel.

## ✨ Key Features

### 1. **Phase Management** 🌱
Track your plant's lifecycle from Seedling to Curing.
-   **Automated Day Counter:** Resets automatically when you switch phases.
-   **Phase Profiles:** Pre-configured light hours for each phase (e.g., 18/6 for Veg, 12/12 for Flower).
-   **Custom Phases:** Define your own phases and durations.

### 2. **Smart Light Cycle** 💡
-   **Automated Control:** Turns your light entity ON/OFF based on the current phase.
-   **Flexible Start Time:** Set a "Start Hour" (e.g., 18:00) so the "Day" aligns with off-peak electricity or your schedule.
-   **Timer Display:** See exactly how long the light will remain ON or when it will turn ON again.

### 3. **Climate Control (VPD)** 🌪️
-   **Vapor Pressure Deficit (VPD):** Calculates VPD in real-time based on Temperature and Humidity.
-   **Smart Ventilation:** Automatically controls your exhaust fan to maintain optimal conditions.
-   **Visual Feedback:** Color-coded bars show if your environment is in the "green zone".

### 4. **Intelligent Watering System** 💧
-   **Soil Moisture Trigger:** Activates the pump precisely when the soil is too dry.
-   **Precision Dosing:** Run the pump for exact seconds (e.g., 5s).
-   **Anti-Short-Cycle (Soak Time):** Prevents overwatering by enforcing a **15-minute wait time** after watering to allow moisture to disperse before re-measuring.

### 5. **Camera Integration** 📷
-   **Live Feed:** View your plant directly in the dashboard.
-   **Zoom Popup:** Click the camera image to view a large, detailed live stream.

---

## ⚙️ Configuration

1.  Go to **Settings -> Devices & Services**.
2.  Click **Add Integration** and search for **"Local Grow Box"**.
3.  Follow the setup wizard to name your box.
4.  A new item **"Grow Room"** will appear in your sidebar.

---

## 🖥️ Using the Dashboard

### **Overview Tab**
This is your main command center.
-   **Live Status:** See Temp, Humidity, VPD, Soil Moisture, and Light status at a glance.
-   **Quick Actions:** Manually toggle Light (Master), Pump, or Fan.
-   **Phase Selector:** Change the current growth phase directly from the dropdown.

### **Settings Tab**
Here you map your Home Assistant entities to the Grow Box features.
-   **Sensors:** Select your Temperature, Humidity, and Soil Moisture sensors.
-   **Actuators:** Select your Light Switch, Fan Switch, and Pump Switch.
-   **Settings:** Define Target Temperature, Max Humidity, and Pump Duration.
-   **Light Start Hour:** Define when the "Day" begins (e.g., `18` for 6 PM).

---

## 🛠️ Logic Details

-   **Light Logic:** Checks every minute. Uses your `Start Hour` and `Phase Duration` to calculate if the light should be ON.
-   **Pump Logic:** Checks every 5 seconds. If moisture < target AND pump has been off for >15 minutes -> Turns ON for `Pump Duration` seconds.

---

*Made with ❤️ for happy plants.*
