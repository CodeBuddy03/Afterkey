// AfterKey hero centerpiece: an obsidian vault door in a black studio.
// three.js is served from this domain. No CDN, no external assets, no secrets.
// Falls back to the CSS silhouette when WebGL is unavailable or reduced motion is set.

import * as THREE from "./three.module.min.js";

const stage = document.querySelector("[data-stage]");
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fail() {
  if (stage) stage.classList.add("is-fallback");
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/* Procedural studio: black room, one broad key light, one cool rim.
   Gives the metal believable reflections without shipping an HDR map. */
function studioEnvironment(renderer) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");

  g.fillStyle = "#050505";
  g.fillRect(0, 0, c.width, c.height);

  const blob = (x, y, r, rgb, alpha) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(0.35, `rgba(${rgb},${alpha * 0.55})`);
    grad.addColorStop(0.72, `rgba(${rgb},${alpha * 0.12})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  };

  blob(230, 90, 330, "255,253,247", 1.0);   // key softbox, upper left
  blob(790, 210, 250, "214,222,235", 0.8);  // cool rim, right
  blob(520, 430, 380, "140,134,124", 0.3);  // floor bounce
  blob(60, 330, 160, "255,250,240", 0.45);  // low fill on the left edge

  const horizon = g.createLinearGradient(0, 268, 0, 330);
  horizon.addColorStop(0, "rgba(190,186,176,0)");
  horizon.addColorStop(0.5, "rgba(190,186,176,0.22)");
  horizon.addColorStop(1, "rgba(190,186,176,0)");
  g.fillStyle = horizon;
  g.fillRect(0, 268, c.width, 62);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}

const OBSIDIAN = {
  color: 0x0b0c0e,
  metalness: 1,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.16,
  envMapIntensity: 1.8,
};

const POLISHED = {
  color: 0x2a2c30,
  metalness: 1,
  roughness: 0.09,
  envMapIntensity: 2.2,
};

function buildVault(tier) {
  const root = new THREE.Group();
  const seg = tier === "low" ? 48 : 128;

  // The door plate. The axis is rotated so the face looks down the camera.
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(1.36, 1.36, 0.3, seg),
    new THREE.MeshPhysicalMaterial(OBSIDIAN)
  );
  plate.rotation.x = Math.PI / 2;
  root.add(plate);

  // Outer machined rim: the brightest read on the object.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.36, 0.036, 20, tier === "low" ? 120 : 256),
    new THREE.MeshPhysicalMaterial(POLISHED)
  );
  rim.position.z = 0.02;
  root.add(rim);

  // Recessed inner panel, a shade darker than the plate.
  const panel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.11, 1.11, 0.05, seg),
    new THREE.MeshPhysicalMaterial({ ...OBSIDIAN, color: 0x08090b, roughness: 0.28 })
  );
  panel.rotation.x = Math.PI / 2;
  panel.position.z = 0.15;
  root.add(panel);

  // Hairline seam around the panel.
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(1.11, 0.0045, 8, 220),
    new THREE.MeshBasicMaterial({ color: 0xe8e2d6, transparent: true, opacity: 0.4, depthWrite: false })
  );
  seam.position.z = 0.178;
  root.add(seam);

  // Lock hub and handle spokes.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.1, tier === "low" ? 32 : 64),
    new THREE.MeshPhysicalMaterial(POLISHED)
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.2;
  root.add(hub);

  const hubRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.016, 12, 120),
    new THREE.MeshPhysicalMaterial({ ...POLISHED, roughness: 0.05 })
  );
  hubRing.position.z = 0.25;
  root.add(hubRing);

  const spokeMat = new THREE.MeshPhysicalMaterial({ ...POLISHED, roughness: 0.14 });
  for (let i = 0; i < 3; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.76, 0.045), spokeMat);
    spoke.position.z = 0.24;
    spoke.rotation.z = (i * Math.PI) / 3;
    root.add(spoke);
  }
  const hubCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.06, 32),
    new THREE.MeshPhysicalMaterial({ ...POLISHED, color: 0x4a4c50, roughness: 0.06 })
  );
  hubCap.rotation.x = Math.PI / 2;
  hubCap.position.z = 0.27;
  root.add(hubCap);

  // Eight bolt studs set into the plate.
  const boltGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.05, 24);
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const bolt = new THREE.Mesh(boltGeo, new THREE.MeshPhysicalMaterial({ ...POLISHED, roughness: 0.18 }));
    bolt.position.set(Math.cos(a) * 1.245, Math.sin(a) * 1.245, 0.16);
    bolt.rotation.x = Math.PI / 2;
    root.add(bolt);
  }

  // Back plate so the slow turn still reads on the reverse.
  const back = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, 0.04, seg),
    new THREE.MeshPhysicalMaterial({ ...OBSIDIAN, color: 0x0a0b0d })
  );
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.16;
  root.add(back);

  const backRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.012, 10, 160),
    new THREE.MeshPhysicalMaterial({ ...POLISHED, roughness: 0.12 })
  );
  backRing.position.z = -0.18;
  root.add(backRing);

  // A single thin orbit line for depth. Barely there by design.
  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(1.72, 0.0018, 6, 220),
    new THREE.MeshBasicMaterial({
      color: 0xcfc9bd,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    })
  );
  orbit.rotation.set(1.42, 0.18, 0.05);
  root.add(orbit);

  return { root, orbit };
}

function dust(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 1.9 + Math.random() * 1.7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0x9a958b,
      size: 0.016,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
  );
}

function init() {
  if (!stage || !hasWebGL()) {
    fail();
    return;
  }

  const narrow = window.matchMedia("(max-width: 700px)").matches;
  const tier = narrow ? "low" : "high";

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !narrow,
      alpha: true,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    fail();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.75 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 4.55);

  const key = new THREE.DirectionalLight(0xfffdf7, 2.6);
  key.position.set(-3.4, 3.1, 3.4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xc9d3e2, 1.9);
  rim.position.set(3.9, -1.2, -2.6);
  scene.add(rim);

  const top = new THREE.SpotLight(0xffffff, 6, 9, 0.7, 0.6, 1.4);
  top.position.set(0, 3.4, 2.2);
  scene.add(top);

  scene.add(new THREE.AmbientLight(0xffffff, 0.07));

  const { root, orbit } = buildVault(tier);
  root.rotation.set(0.12, -0.42, 0);
  scene.add(root);

  const motes = dust(narrow ? 40 : 90);
  scene.add(motes);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  if (!REDUCED && !narrow) window.addEventListener("pointermove", onPointer, { passive: true });

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Keep the door inside the frame on short viewports.
    const fit = Math.min(1, Math.max(0.62, h / 460));
    root.scale.setScalar(fit);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let onScreen = true;

  const draw = (dt) => {
    if (!REDUCED) {
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.6);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.6);

      // Slow, continuous turn: a full revolution takes about a minute.
      root.rotation.y += dt * 0.1;
      root.rotation.x = 0.12 + pointer.y * 0.14;
      root.rotation.z = -pointer.x * 0.03;

      camera.position.x = pointer.x * 0.13;
      camera.position.y = -pointer.y * 0.07 + Math.sin(clock.elapsedTime * 0.5) * 0.015;
      camera.lookAt(0, 0, 0);

      orbit.rotation.y += dt * 0.04;
      motes.rotation.y -= dt * 0.01;
    }
    renderer.render(scene, camera);
  };

  const loop = () => {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    draw(dt);
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running) return;
    running = true;
    clock.start();
    stage.classList.add("is-ready");
    raf = requestAnimationFrame(loop);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  // Only animate while the hero is on screen.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0].isIntersecting;
        if (onScreen && !document.hidden) start();
        else stop();
      },
      { threshold: 0.02 }
    );
    io.observe(stage);
  } else {
    start();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (onScreen) start();
  });

  if (REDUCED) {
    draw(0);
    stage.classList.add("is-ready");
  }

  // First frame before the observer settles.
  draw(0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
