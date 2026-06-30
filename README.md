# packet — 3D Network Traffic Visualization

A 3D visualization of network traffic built with Three.js and Vite. This project simulates "fake" network traffic flowing between nodes in a stylized 3D environment, complete with a packet log, hex dump decoration, and interactive camera views.

## Features

- **3D Visualization:** Real-time rendering of network "blobs" moving between infrastructure components.
- **Interactive UI:** Switch between different camera perspectives (Whole map, Switch, TAP, Router).
- **Packet Log:** A live-scrolling log of simulated network packets.
- **Traffic Controls:** Adjust the "busyness" of the traffic or pause it entirely.
- **TLS Simulation:** Toggle a "Pretend everything is TLS" mode to hide fake payload text.
- **Responsive Design:** A modern, tech-focused UI overlaying the 3D scene.

## Tech Stack

- [Three.js](https://threejs.org/) - 3D Engine
- [Vite](https://vitejs.dev/) - Frontend Tooling
- Vanilla JavaScript / CSS

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/abhi-byte62/packet-sniffer-3d-.git
   cd packet-sniffer-3d-
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173`.

### Building for Production

To create a production build:
```bash
npm run build
```
The output will be in the `dist` directory.

## License

This project is for demonstration and portfolio purposes.

---
*Note: This is a visualization tool and is not connected to a real Network Interface Card (NIC).*
