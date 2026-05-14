import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

const SECTIONS = {
  overview: {
    hudTitle: "Whole map",
    note: "Default angle. Orbit with mouse / trackpad.",
    camera: { pos: [10, 7, 12], target: [0, 0.5, 0] },
    highlight: "all",
  },
  path: {
    hudTitle: "Through the switch",
    note: "Highlights links that hit the switch (kinda like watching east-west traffic).",
    camera: { pos: [6, 11, 8], target: [0, 0, 0] },
    highlight: "path",
  },
  sniffer: {
    hudTitle: "TAP leg",
    note: "Pushes the camera toward the tap box + its cable. Still fake data.",
    camera: { pos: [4, 4, 14], target: [-2, 0, 2] },
    highlight: "sniffer",
  },
  defense: {
    hudTitle: "Router side",
    note: "Off-axis shot toward the gateway. Was fiddling with this one the longest.",
    camera: { pos: [-8, 6, 10], target: [1, 0, -1] },
    highlight: "all",
  },
};

const canvas = document.getElementById("webgl");
const logEl = document.getElementById("packet-log");
const hudTitle = document.getElementById("hud-title");
const panelNote = document.getElementById("panel-note");
const encryptToggle = document.getElementById("encrypt-toggle");
const rateSlider = document.getElementById("rate-slider");
const bpfInput = document.getElementById("bpf");
const mPps = document.getElementById("m-pps");
const mBytes = document.getElementById("m-bytes");
const mFlight = document.getElementById("m-flight");
const clockMs = document.getElementById("clock-ms");
const hexDump = document.getElementById("hex-dump");
const logBadge = document.getElementById("log-badge");
const btnToggleRun = document.getElementById("btn-toggle-run");

const pageStart = performance.now();

/** Fake capture on by default; Stop / Start button flips this. */
let simulationOn = true;

let trafficRate = 1;
let highlightMode = "all";
let totalBytes = 0;
let ppsEvents = 0;
let ppsTimer = 0;
let lastHex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141416);
scene.fog = new THREE.FogExp2(0x141416, 0.032);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(10, 7, 12);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "fixed";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
labelRenderer.domElement.style.zIndex = "4";
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

const hemi = new THREE.HemisphereLight(0xd8dce8, 0x1a1a1c, 0.55);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff5eb, 0.55);
dir.position.set(8, 14, 6);
scene.add(dir);
const rim = new THREE.PointLight(0xffc9a8, 0.18, 40, 2);
rim.position.set(-5, 4, 3);
scene.add(rim);

const grid = new THREE.GridHelper(40, 40, 0x3a3a42, 0x2a2a2e);
grid.position.y = -0.01;
scene.add(grid);

const nodeMat = new THREE.MeshStandardMaterial({
  color: 0x5c6470,
  metalness: 0.25,
  roughness: 0.72,
  emissive: 0x101012,
});
const switchMat = new THREE.MeshStandardMaterial({
  color: 0x6b8f7a,
  metalness: 0.2,
  roughness: 0.65,
  emissive: 0x0a120e,
});
const routerMat = new THREE.MeshStandardMaterial({
  color: 0xb8895e,
  metalness: 0.22,
  roughness: 0.68,
  emissive: 0x120c08,
});
const snifferMat = new THREE.MeshStandardMaterial({
  color: 0xb87a7a,
  metalness: 0.28,
  roughness: 0.62,
  emissive: 0x140808,
});

const edgeLineMat = new THREE.LineBasicMaterial({
  color: 0x5a5a62,
  transparent: true,
  opacity: 0.55,
});

function makeNode(id, position, material, scale = 0.55, caption) {
  const geo = new THREE.BoxGeometry(1, 0.45, 1);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(position);
  mesh.scale.setScalar(scale);
  mesh.userData.label = id;
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x888890, transparent: true, opacity: 0.22 })
  );
  mesh.add(wire);

  const div = document.createElement("div");
  div.className = "node-label";
  div.textContent = caption || id;
  const label = new CSS2DObject(div);
  const halfH = 0.225 * scale;
  label.position.set(0, halfH + 0.14, 0);
  mesh.add(label);

  scene.add(mesh);
  return mesh;
}

const hostA = makeNode("pc-a", new THREE.Vector3(-5, 0.3, 2), nodeMat, 0.55, "PC-A");
const hostB = makeNode("pc-b", new THREE.Vector3(-1, 0.3, -3), nodeMat, 0.55, "PC-B");
const hostC = makeNode("pc-c", new THREE.Vector3(3, 0.3, 3), nodeMat, 0.55, "PC-C");
const sw = makeNode("switch", new THREE.Vector3(0, 0.35, 0), switchMat, 0.85, "Switch");
const router = makeNode("router", new THREE.Vector3(6, 0.35, -2), routerMat, 0.9, "Router");
const sniffer = makeNode("tap", new THREE.Vector3(-2.2, 0.35, 1.4), snifferMat, 0.5, "TAP");

const nodes = { hostA, hostB, hostC, sw, router, sniffer };

const edges = [
  { a: hostA, b: sw },
  { a: hostB, b: sw },
  { a: hostC, b: sw },
  { a: sw, b: router },
  { a: sniffer, b: sw },
];

const edgeLines = [];
for (const { a, b } of edges) {
  const geo = new THREE.BufferGeometry().setFromPoints([a.position.clone(), b.position.clone()]);
  const line = new THREE.Line(geo, edgeLineMat.clone());
  scene.add(line);
  edgeLines.push({ line, a, b });
}

const packetGeo = new THREE.IcosahedronGeometry(0.16, 0);
const packetMat = new THREE.MeshStandardMaterial({
  color: 0xe8a654,
  emissive: 0x1a1208,
  metalness: 0.15,
  roughness: 0.55,
});

const packets = [];
const maxPackets = 56;

function randomEdge() {
  return edges[(Math.random() * edges.length) | 0];
}

function spawnPacket() {
  const { a, b } = randomEdge();
  const mesh = new THREE.Mesh(packetGeo, packetMat.clone());
  mesh.userData.t = Math.random();
  mesh.userData.speed = 0.14 + Math.random() * 0.14;
  mesh.userData.a = a;
  mesh.userData.b = b;
  mesh.userData.proto = ["TCP", "UDP", "ICMP", "TLS"][Math.floor(Math.random() * 4)];
  mesh.userData.sport = 40000 + (Math.floor(Math.random() * 20000) | 0);
  mesh.userData.dport = [80, 443, 53, 22, 3389][Math.floor(Math.random() * 5)];
  mesh.userData.len = 64 + ((Math.random() * 1400) | 0);
  if (simulationOn) {
    totalBytes += mesh.userData.len;
  }
  if (encryptToggle.checked) {
    mesh.material.color.setHex(0xa890c8);
    mesh.material.emissive.setHex(0x100818);
  }
  scene.add(mesh);
  packets.push(mesh);
  while (packets.length > maxPackets) {
    const old = packets.shift();
    scene.remove(old);
    const m = old.material;
    if (m) m.dispose();
  }
}

function setSection(id) {
  const s = SECTIONS[id];
  if (!s) return;
  hudTitle.textContent = s.hudTitle;
  panelNote.textContent = s.note;
  highlightMode = s.highlight;
  document.querySelectorAll(".tabs__btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === id);
  });
}

document.querySelectorAll(".tabs__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.section;
    setSection(id);
    startCameraTransition(id);
  });
});

function syncRunUi() {
  const on = simulationOn;
  logBadge.textContent = on ? "running" : "paused";
  logBadge.classList.toggle("is-on", on);
  if (btnToggleRun) {
    btnToggleRun.textContent = on ? "Stop" : "Start";
    btnToggleRun.dataset.running = on ? "true" : "false";
    btnToggleRun.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

btnToggleRun.addEventListener("click", () => {
  simulationOn = !simulationOn;
  syncRunUi();
});

encryptToggle.addEventListener("change", () => syncPacketMaterials());

rateSlider.addEventListener("input", () => {
  trafficRate = parseFloat(rateSlider.value);
});

setSection("overview");
syncRunUi();

const logLines = [];

function bpfMatch(line) {
  const q = (bpfInput.value || "").trim().toLowerCase();
  if (!q) return true;
  return line.toLowerCase().includes(q);
}

function pushLogLine(text) {
  if (!bpfMatch(text)) return;
  const li = document.createElement("li");
  const ts = new Date().toLocaleTimeString(undefined, { hour12: false });
  li.innerHTML = `<span class="t">${ts}</span>${text}`;
  logEl.prepend(li);
  logLines.unshift(li);
  while (logLines.length > 48) {
    const old = logLines.pop();
    old.remove();
  }
}

function formatPayload() {
  if (encryptToggle.checked) {
    return `len=0x${(64 + ((Math.random() * 200) | 0)).toString(16)} [encrypted]`;
  }
  const samples = [
    "PSH ACK seq=0x" + Math.random().toString(16).slice(2, 10),
    "DNS QRY A api.internal",
    "HTTP/2 HEADERS stream=7",
    "ICMP echo id=0x" + ((Math.random() * 0xffff) | 0).toString(16),
  ];
  return samples[(Math.random() * samples.length) | 0];
}

let camFrom = camera.position.clone();
let camTo = camera.position.clone();
let tgtFrom = controls.target.clone();
let tgtTo = controls.target.clone();
let camLerp = 1;

function startCameraTransition(sectionId) {
  const s = SECTIONS[sectionId];
  if (!s || !s.camera) return;
  camFrom.copy(camera.position);
  tgtFrom.copy(controls.target);
  camTo.set(...s.camera.pos);
  tgtTo.set(...s.camera.target);
  camLerp = 0;
}

function syncPacketMaterials() {
  const encrypted = encryptToggle.checked;
  for (const p of packets) {
    p.material.color.setHex(encrypted ? 0xa890c8 : 0xe8a654);
    p.material.emissive.setHex(encrypted ? 0x100818 : 0x1a1208);
  }
}

function updateHighlights() {
  const sniff = highlightMode === "sniffer";
  const path = highlightMode === "path";

  sniffer.material.emissiveIntensity = sniff ? 0.35 : 0.12;
  sniffer.scale.setScalar(sniff ? 0.56 : 0.5);

  edgeLines.forEach(({ line, a, b }) => {
    const isSniffLink = a === sniffer || b === sniffer;
    const mat = line.material;
    if (sniff && isSniffLink) {
      mat.color.setHex(0xc49a9a);
      mat.opacity = 0.9;
    } else if (path && (a === sw || b === sw)) {
      mat.color.setHex(0xc4a574);
      mat.opacity = 0.85;
    } else {
      mat.color.setHex(0x5a5a62);
      mat.opacity = 0.5;
    }
  });

  Object.entries(nodes).forEach(([key, mesh]) => {
    if (key === "sniffer") return;
    mesh.material.emissiveIntensity = path && (key === "sw" || key.startsWith("host")) ? 0.12 : 0.06;
  });
}

function refreshHex() {
  const cols = 16;
  let out = "";
  for (let r = 0; r < 2; r++) {
    const off = (r * 16).toString(16).padStart(4, "0");
    out += off + "  ";
    for (let c = 0; c < cols; c++) {
      out += ((Math.random() * 256) | 0).toString(16).padStart(2, "0") + " ";
    }
    out += "\n";
  }
  hexDump.textContent = out.trimEnd();
}

const clock = new THREE.Clock();
let spawnAcc = 0;
let logAcc = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  const sec = ((performance.now() - pageStart) / 1000).toFixed(0);
  clockMs.textContent = `${sec}s`;

  if (camLerp < 1) {
    camLerp = Math.min(1, camLerp + dt * 0.55);
    const e = 1 - Math.pow(1 - camLerp, 3);
    camera.position.lerpVectors(camFrom, camTo, e);
    controls.target.lerpVectors(tgtFrom, tgtTo, e);
  }

  controls.update();
  updateHighlights();

  mFlight.textContent = String(packets.length);

  if (simulationOn) {
    spawnAcc += dt * trafficRate * 2.4;
    while (spawnAcc > 1) {
      spawnAcc -= 1;
      spawnPacket();
    }
    logAcc += dt * trafficRate;
    while (logAcc > 0.42) {
      logAcc -= 0.42;
      const p = packets[(Math.random() * packets.length) | 0];
      if (!p) continue;
      const src = Math.random() > 0.5 ? "10.0.0.12" : "10.0.0.55";
      const dst = "10.0.0.1";
      const line = `${p.userData.proto} ${src}:${p.userData.sport} → ${dst}:${p.userData.dport} len=${p.userData.len} ${formatPayload()}`;
      pushLogLine(line);
      ppsEvents += 1;
    }
  } else {
    spawnAcc = 0;
    logAcc = 0;
  }

  ppsTimer += dt;
  if (ppsTimer >= 0.4) {
    mPps.textContent = String(Math.round(ppsEvents / 0.4));
    ppsEvents = 0;
    ppsTimer = 0;
  }
  mBytes.textContent = totalBytes.toLocaleString("en-US");

  if (performance.now() - lastHex > 900) {
    lastHex = performance.now();
    refreshHex();
  }

  for (const mesh of packets) {
    const { speed } = mesh.userData;
    let tt = mesh.userData.t + dt * speed * trafficRate;
    if (tt >= 1) {
      tt = 0;
      const edge = randomEdge();
      mesh.userData.a = edge.a;
      mesh.userData.b = edge.b;
    }
    mesh.userData.t = tt;
    const a = mesh.userData.a;
    const b = mesh.userData.b;
    mesh.position.lerpVectors(a.position, b.position, tt);
    mesh.position.y += 0.38 + Math.sin(tt * Math.PI) * 0.16;
    mesh.rotation.x += dt * 2.2;
    mesh.rotation.y += dt * 1.65;
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

refreshHex();
for (let i = 0; i < 22; i++) spawnPacket();
animate();
