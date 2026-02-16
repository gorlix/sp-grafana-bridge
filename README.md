# 📊 Grafana Bridge for Super Productivity

**Grafana Bridge** is a powerful plugin for [Super Productivity](https://super-productivity.com/) that exports your task tracking data in real-time to an InfluxDB instance. This enables you to build advanced, beautiful dashboards in Grafana to visualize your productivity, time tracking, and project efficiency.

## 🚀 Features

- **Real-time Sync**: Automatically exports task data on completion, update, or deletion.
- **Bulk Import**: One-click export of your entire task history (active and archived).
- **Rich Metadata**: Captures time spent, estimates, tags, project names, and efficiency ratios.
- **Grafana Templates**: Includes ready-to-use dashboards for Time & Task visualization.

## 📦 Installation

This plugin can be installed as a local extension.

### 1. Download the Plugin
- **Option A (GitHub)**: Download the latest `sp-grafana-bridge-x.x.x.zip` from the **Releases** tab of this repository.

### 2. Load into Super Productivity
1. Open Super Productivity.
2. Go to **Settings** -> **Plugins**.
3. Search for **"Install Plugin"**.
4. Upload the `.zip` file you just downloaded.
5. Toggle the switch to **Enable** the "Grafana Bridge" plugin.

## ⚙️ Configuration

### 1. Setup InfluxDB
You need an InfluxDB instance (v2.x recommended).
1. Create a **Bucket** named `productivity`.
2. Generate an **API Token** with write access to this bucket.

### 2. Configure Plugin
1. In Super Productivity, open the **Grafana Bridge** side panel (look for the extension icon in the sidebar).
2. Enter your connection details:
   - **URL**: `https://your-influxdb-instance.com/api/v2/write?bucket=productivity&org=YOUR_ORG`
   - **Token**: Your InfluxDB API Token.
   - **Measurement**: `superprod_tasks` (default).
3. Click **Save Settings**.
4. Click **Test Connection** to verify everything is working.

## 📊 Grafana Dashboards

We provide pre-built Grafana templates in the `grafana-templates/` directory.

1. **Time Visualization** (`time-visualization.json`): Tracks time spent per day, project distribution, and productivity trends.
2. **Task Visualization** (`task-visualization.json`): Focuses on task completion rates, backlog growth, and efficiency.

**To Import:**
1. Open Grafana -> **Dashboards** -> **Import**.
2. Upload the JSON file from `grafana-templates/`.
3. Select your InfluxDB datasource when prompted.

## 🛠️ Development & Packaging

To develop or modify this plugin:

1. **Edit Code**: Modify `plugin.js`, `index.html`, etc.
2. **Package**:
   - Run `./package_local.sh` to create a testable ZIP in `~/Downloads`.
   - OR push to `main` to trigger the GitHub Action which builds `sp-grafana-bridge-x.x.x.zip`.

## 📝 License

MIT License.
