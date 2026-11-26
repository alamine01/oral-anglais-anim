"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface CyberShield3DProps {
  /** Proportion of naive "trust" votes, 0 → 1. */
  trustRatio: number;
  /** Total number of votes on the active scenario (a new vote triggers a pulse). */
  totalVotes: number;
  className?: string;
}

const CYAN = new THREE.Color("#00F0FF");
const RED = new THREE.Color("#EF4444");
const BACKGROUND = new THREE.Color("#050811"); // matches the /stage page background
const SHIELD_RADIUS = 1.6;

interface Facet {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  dir: THREE.Vector3; // unit vector from centre to facet centroid
  threshold: number; // trust ratio at which this facet starts breaking
  tiltAxis: THREE.Vector3;
  phase: number;
  breach: number; // smoothed 0 → 1
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Builds a 60-facet geodesic sphere: each of the 20 icosahedron faces is split
 * into 3 triangles around its centroid, which is projected back onto the sphere.
 */
function buildGeodesicTriangles(radius: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
  const ico = new THREE.IcosahedronGeometry(radius, 0); // non-indexed: 20 faces × 3 vertices
  const pos = ico.getAttribute("position");
  const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  for (let f = 0; f < pos.count; f += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, f);
    const b = new THREE.Vector3().fromBufferAttribute(pos, f + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, f + 2);
    const m = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).setLength(radius);
    tris.push([a, b, m.clone()], [b, c, m.clone()], [c, a, m.clone()]);
  }
  ico.dispose();
  return tris;
}

export default function CyberShield3D({ trustRatio, totalVotes, className }: CyberShield3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(clamp01(trustRatio));
  const votesRef = useRef(totalVotes);
  const pulseRef = useRef(0);

  // Feed props into the animation loop without rebuilding the scene.
  useEffect(() => {
    ratioRef.current = clamp01(Number.isFinite(trustRatio) ? trustRatio : 0);
  }, [trustRatio]);

  useEffect(() => {
    if (totalVotes > votesRef.current) pulseRef.current = 1;
    votesRef.current = totalVotes;
  }, [totalVotes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---------- Renderer / scene / camera ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(BACKGROUND, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = BACKGROUND;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 6.2);

    // ---------- Post-processing (bloom for the neon edges) ----------
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.2);
    composer.addPass(bloom);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // ---------- Lights ----------
    const ambient = new THREE.AmbientLight(0x4a6b8a, 0.6);
    const key = new THREE.DirectionalLight(0xbfefff, 1.2);
    key.position.set(4, 5, 6);
    const rim = new THREE.DirectionalLight(0x3355ff, 0.8);
    rim.position.set(-5, -3, -4);
    const coreLight = new THREE.PointLight(CYAN.getHex(), 3, 8, 1.6);
    scene.add(ambient, key, rim, coreLight);

    // ---------- Groups: outer = mouse tilt, inner = continuous rotation ----------
    const tiltGroup = new THREE.Group();
    const spinGroup = new THREE.Group();
    tiltGroup.add(spinGroup);
    scene.add(tiltGroup);

    // ---------- Facets ----------
    const triangles = buildGeodesicTriangles(SHIELD_RADIUS);
    const order = triangles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const facets: Facet[] = triangles.map(([a, b, c], i) => {
      const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
      const geometry = new THREE.BufferGeometry();
      // Shrink slightly toward the centroid so seams read as glowing gaps.
      const shrink = 0.94;
      const local = [a, b, c].map((v) => v.clone().sub(centroid).multiplyScalar(shrink));
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(local.flatMap((v) => [v.x, v.y, v.z]), 3)
      );
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: CYAN.clone(),
        emissive: CYAN.clone(),
        emissiveIntensity: 0.12,
        metalness: 0.55,
        roughness: 0.25,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        flatShading: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(centroid);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: CYAN.clone(), transparent: true, opacity: 0.95 })
      );
      mesh.add(edges);
      spinGroup.add(mesh);

      const dir = centroid.clone().normalize();
      const tiltAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      // Spread thresholds evenly across [0, 0.9] in random order → share of broken facets ≈ trustRatio.
      const threshold = (order[i] / triangles.length) * 0.9;
      return { mesh, edges, dir, threshold, tiltAxis, phase: Math.random() * Math.PI * 2, breach: 0 };
    });

    // ---------- Core ----------
    const coreGeometry = new THREE.IcosahedronGeometry(0.32, 3);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: CYAN.clone() });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);

    const haloGeometry = new THREE.SphereGeometry(0.6, 32, 32);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: CYAN.clone(),
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);

    const innerWireGeometry = new THREE.IcosahedronGeometry(0.9, 1);
    const innerWireMaterial = new THREE.MeshBasicMaterial({
      color: CYAN.clone(),
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const innerWire = new THREE.Mesh(innerWireGeometry, innerWireMaterial);

    const coreGroup = new THREE.Group();
    coreGroup.add(core, halo, innerWire);
    scene.add(coreGroup); // not in tiltGroup so the jitter stays screen-centred

    // ---------- Resize ----------
    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      camera.aspect = w / h;
      // Keep the shield fully visible on narrow containers.
      camera.position.z = camera.aspect < 1 ? 6.2 / Math.max(camera.aspect, 0.55) : 6.2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    // ---------- Mouse reaction ----------
    const mouse = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onPointerLeave = () => {
      mouse.x = 0;
      mouse.y = 0;
    };
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    // ---------- Animation loop ----------
    const timer = new THREE.Timer();
    timer.connect(document); // pauses delta while the tab is hidden
    const tmpColor = new THREE.Color();
    const tmpQuat = new THREE.Quaternion();
    let smoothRatio = ratioRef.current;
    let frameId = 0;

    const animate = (timestamp?: number) => {
      frameId = requestAnimationFrame(animate);
      timer.update(timestamp);
      const dt = Math.min(timer.getDelta(), 0.05);
      const t = timer.getElapsed();

      // Smooth transitions toward the live ratio
      smoothRatio += (ratioRef.current - smoothRatio) * Math.min(1, dt * 2.2);
      pulseRef.current = Math.max(0, pulseRef.current - dt * 1.6);
      const pulse = pulseRef.current;
      const danger = smoothRatio;

      // Rotation + mouse tilt
      spinGroup.rotation.y += dt * (0.18 + danger * 0.25);
      spinGroup.rotation.x = Math.sin(t * 0.25) * 0.12;
      tiltGroup.rotation.y += (mouse.x * 0.45 - tiltGroup.rotation.y) * Math.min(1, dt * 3);
      tiltGroup.rotation.x += (mouse.y * 0.3 - tiltGroup.rotation.x) * Math.min(1, dt * 3);

      // Facets
      for (const f of facets) {
        const target = smoothstep(f.threshold, f.threshold + 0.1, danger);
        f.breach += (target - f.breach) * Math.min(1, dt * 3);
        const b = f.breach;

        const shake = b * (0.025 + danger * 0.03) * Math.sin(t * 18 + f.phase);
        const offset = b * 0.42 + shake + pulse * 0.05;
        f.mesh.position.copy(f.dir).multiplyScalar(SHIELD_RADIUS * 0.94 + offset);
        f.mesh.quaternion.copy(tmpQuat.setFromAxisAngle(f.tiltAxis, b * 0.35 + shake * 2));

        tmpColor.copy(CYAN).lerp(RED, b);
        f.mesh.material.color.copy(tmpColor);
        f.mesh.material.emissive.copy(tmpColor);
        f.mesh.material.emissiveIntensity = 0.08 + b * 0.35 + pulse * 0.2;
        f.mesh.material.opacity = 0.22 + b * 0.3;
        f.edges.material.color.copy(tmpColor);
        f.edges.material.opacity = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t * (2 + b * 10) + f.phase));
      }

      // Core: colour, pulse, vibration proportional to vulnerability
      tmpColor.copy(CYAN).lerp(RED, danger);
      coreMaterial.color.copy(tmpColor);
      haloMaterial.color.copy(tmpColor);
      innerWireMaterial.color.copy(tmpColor);
      coreLight.color.copy(tmpColor);

      const heartbeat = 1 + Math.sin(t * (2.2 + danger * 9)) * (0.04 + danger * 0.08);
      core.scale.setScalar(heartbeat + pulse * 0.35);
      halo.scale.setScalar(1 + pulse * 0.6 + danger * 0.25 + Math.sin(t * 3) * 0.03);
      haloMaterial.opacity = 0.06 + danger * 0.1 + pulse * 0.15;
      innerWire.rotation.y -= dt * (0.4 + danger * 2);
      innerWire.rotation.z += dt * 0.2;

      const jitter = danger * danger * 0.07;
      coreGroup.position.set(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter
      );
      coreLight.intensity = 2.5 + danger * 4 + pulse * 5;
      bloom.strength = 0.55 + danger * 0.35 + pulse * 0.3;

      composer.render(dt);
    };
    animate();

    // ---------- Cleanup (Strict-Mode safe) ----------
    return () => {
      cancelAnimationFrame(frameId);
      timer.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);

      scene.traverse((obj) => {
        const o = obj as THREE.Object3D & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      });
      scene.clear();

      bloom.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={className ?? "h-full w-full"} aria-label="3D cyber shield" role="img" />;
}
