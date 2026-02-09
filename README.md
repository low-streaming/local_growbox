# Local Grow Box for Home Assistant

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

## Manual Installation

If you prefer not to use HACS, you can install this manually:

1.  Download the `local_grow_box` folder.
2.  Copy the entire folder into your Home Assistant's `config/custom_components/` directory.
3.  Restart Home Assistant.

