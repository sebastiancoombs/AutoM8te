# AirSim Setup Guide

**Goal:** Install AirSim + Unreal Engine for AutoM8te drone simulation.

---

## Prerequisites

- **macOS** (Apple Silicon or Intel)
- **Disk space:** ~50 GB (Unreal Engine + AirSim + environment)
- **RAM:** 16 GB minimum, 32 GB recommended
- **Python:** 3.9+ (check: `python3 --version`)

---

## Installation Steps

### 1. Install Unreal Engine 5

AirSim requires Unreal Engine. We'll use Epic Games Launcher.

1. **Download Epic Games Launcher:**  
   https://www.unrealengine.com/download

2. **Install Unreal Engine 5.x:**
   - Open Epic Games Launcher
   - Go to Unreal Engine tab
   - Click "Install Engine"
   - Select latest UE 5.x version
   - Wait for download (~30-40 GB)

3. **Verify installation:**
   - Launcher should show "Launch" button for UE5

### 2. Build AirSim from Source

AirSim provides prebuilt binaries, but for best results (especially on Apple Silicon), build from source.

```bash
# Clone AirSim repo
cd ~/Documents/Git
git clone https://github.com/Microsoft/AirSim.git
cd AirSim

# Build AirSim
./setup.sh
./build.sh

# This will take 15-30 minutes
# Output: compiled AirSim plugin in Unreal/Plugins/AirSim
```

### 3. Create or Download an Environment

**Option A: Use Blocks Environment (fastest)**

AirSim includes a simple test environment called "Blocks".

```bash
cd AirSim/Unreal/Environments/Blocks

# Generate Xcode project (macOS)
./GenerateProjectFiles.sh

# Open in Unreal Engine
open Blocks.xcworkspace
```

In Unreal Editor:
1. Wait for shaders to compile (5-10 min first launch)
2. Click "Play" to start simulation
3. AirSim should auto-load

**Option B: Download Prebuilt Environment**

Microsoft provides prebuilt environments:
- **AirSimNH** (Neighborhood) — residential area, good for testing
- **Africa** — savanna environment
- **Mountain Landscape** — scenic but heavy

Download from: https://github.com/Microsoft/AirSim/releases

Extract and run the executable.

### 4. Configure AirSim Settings

AirSim reads config from `~/Documents/AirSim/settings.json`.

**Create default multi-drone config:**

```bash
mkdir -p ~/Documents/AirSim
```

Create `~/Documents/AirSim/settings.json`:

```json
{
  "SettingsVersion": 1.2,
  "SimMode": "Multirotor",
  "ClockSpeed": 1,
  "Vehicles": {
    "Drone0": {
      "VehicleType": "SimpleFlight",
      "X": 0, "Y": 0, "Z": 0,
      "Yaw": 0
    },
    "Drone1": {
      "VehicleType": "SimpleFlight",
      "X": 0, "Y": 5, "Z": 0,
      "Yaw": 0
    },
    "Drone2": {
      "VehicleType": "SimpleFlight",
      "X": 5, "Y": 0, "Z": 0,
      "Yaw": 0
    },
    "Drone3": {
      "VehicleType": "SimpleFlight",
      "X": 5, "Y": 5, "Z": 0,
      "Yaw": 0
    }
  },
  "CameraDefaults": {
    "CaptureSettings": [
      {
        "ImageType": 0,
        "Width": 1920,
        "Height": 1080,
        "FOV_Degrees": 90
      }
    ]
  }
}
```

**What this does:**
- Spawns 4 drones in a square pattern (5m apart)
- Each drone has a camera (1080p, 90° FOV)
- Coordinates are in NED (North-East-Down)

### 5. Install Python Client

```bash
# Install AirSim Python API
pip install airsim

# Verify
python3 -c "import airsim; print('AirSim version:', airsim.__version__)"
```

### 6. Test Connection

**Start AirSim:**
1. Launch Unreal Engine environment (Blocks or downloaded)
2. Click "Play" in editor (or run executable)
3. Wait for environment to load

**Test Python connection:**

```bash
cd ~/Documents/Git/AutoM8te
python3 tests/test_airsim_connection.py
```

**Expected output:**
```
[INFO] Connecting to AirSim...
[INFO] ✓ Connected to AirSim
[INFO] Registered Test Drone (ID: Drone0)
[INFO] API control enabled for Drone0
[INFO] Armed Drone0
[INFO] Test Drone took off
[INFO] Test Drone moved to (10.0, 0.0, -10.0)
[INFO] Test Drone landed
[INFO] ✓ Test complete!
```

---

## Troubleshooting

### Connection refused
- Make sure Unreal environment is running and in "Play" mode
- Check AirSim API is listening on port 41451 (default)
- Firewall blocking? Allow connections to localhost:41451

### Drone not moving
- Verify `enableApiControl(True)` was called
- Check `armDisarm(True)` was called
- Look for error messages in Unreal output log

### Poor performance / low FPS
- Lower resolution in settings.json (e.g., 1280x720)
- Reduce Unreal graphics quality (Settings → Quality → Low)
- Close other applications
- Consider using Blocks environment (lighter than photorealistic scenes)

### Build errors on Apple Silicon
- Use latest Xcode Command Line Tools: `xcode-select --install`
- Check AirSim GitHub issues for M1/M2/M3-specific fixes
- Consider using Rosetta 2 if native build fails

---

## Next Steps

Once AirSim is running:
1. Verify test script works (single drone control)
2. Test multi-drone spawn (all 4 drones in settings.json)
3. Capture camera feed (use `simGetImages` API)
4. Integrate with OpenClaw tools (Phase 1 complete)

---

## Resources

- **AirSim Docs:** https://microsoft.github.io/AirSim/
- **Unreal Engine Docs:** https://docs.unrealengine.com/
- **AirSim GitHub:** https://github.com/Microsoft/AirSim
- **Python API Ref:** https://microsoft.github.io/AirSim/api_docs/html/

---

**Status:** Draft — update as installation progresses.
