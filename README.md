# Local Grow Box Integration 🌿

The **Local Grow Box** integration turns your Home Assistant instance into a fully automated Grow Room controller. It manages light cycles, climate (VPD), watering, and tracking of growth phases through a dedicated, beautiful dashboard panel.

---

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
-   **Daily Snapshots:** *Currently in development.*

---

## 🚀 Installation

### Option 1: HACS (Recommended)
1.  Add this repository as a **Custom Repository** in HACS.
2.  Search for "Local Grow Box" and install.
3.  Restart Home Assistant.

### Option 2: Manual Check
1.  Copy the `custom_components/local_grow_box` folder into your Home Assistant `/config/custom_components/` directory.
2.  Restart Home Assistant.

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

### **Geräte & Config Tab**
Here you map your Home Assistant entities to the Grow Box features.
-   **Sensors:** Select your Temperature, Humidity, and Soil Moisture sensors.
-   **Actuators:** Select your Light Switch, Fan Switch, and Pump Switch.
-   **Settings:** Define Target Temperature, Max Humidity, and Pump Duration.
-   **Light Start Hour:** Define when the "Day" begins (e.g., `18` for 6 PM).

### **Phasen Tab**
Customize the duration of light for each phase (standard: 18h for Veg, 12h for Flower). You can also define custom phases here.

---

## 🛠️ Logic Details

-   **Light Logic:** Checks every minute. Uses your `Start Hour` and `Phase Duration` to calculate if the light should be ON. E.g., if Start is 18:00 and Duration is 18h, light is ON from 18:00 to 12:00 next day.
-   **Pump Logic:** Checks every 5 seconds. If moisture < target AND pump has been off for >15 minutes -> Turns ON for `Pump Duration` seconds.
-   **Fan Logic:** Turns ON if Temp > Target OR Humidity > Max. Turns OFF if conditions are well below targets (hysteresis included).

---

## ❓ Troubleshooting

-   **"Light flickers on/off":** Check if you accidentally assigned the same switch entity to both "Light" and "Fan".
-   **"Phase didn't change":** Refresh the browser page. The dashboard prioritizes configuration over sensor data for immediate feedback.
-   **"Pump keeps running":** Ensure your pump entity supports status reporting. The system relies on the entity state to track run time.

---

*Made with ❤️ for happy plants.*
