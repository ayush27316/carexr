import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils, VRM } from "@pixiv/three-vrm";

const EXPRESSION_MAP: Record<string, string> = {
  neutral: "neutral",
  joy: "happy",
  happy: "happy",
  angry: "angry",
  sorrow: "sad",
  sad: "sad",
  fun: "relaxed",
  relaxed: "relaxed",
  surprised: "surprised",
};

export interface VRMSceneHandle {
  setMouthValue: (value: number) => void;
  setExpression: (name: string, duration?: number) => void;
}

const VRMScene = forwardRef<VRMSceneHandle>((_props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const currentExprRef = useRef<string | null>(null);
  const exprTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouthRef = useRef(0);
  const targetMouthRef = useRef(0);

  useImperativeHandle(ref, () => ({
    setMouthValue(value: number) {
      targetMouthRef.current = Math.max(0, Math.min(1, value));
    },
    setExpression(name: string, duration = 4) {
      const vrm = vrmRef.current;
      if (!vrm?.expressionManager) return;

      if (currentExprRef.current && currentExprRef.current !== "neutral") {
        vrm.expressionManager.setValue(currentExprRef.current, 0);
      }

      const mapped = EXPRESSION_MAP[name] ?? "neutral";
      if (mapped !== "neutral") {
        vrm.expressionManager.setValue(mapped, 1);
        currentExprRef.current = mapped;
        if (exprTimerRef.current) clearTimeout(exprTimerRef.current);
        exprTimerRef.current = setTimeout(() => {
          vrm.expressionManager?.setValue(mapped, 0);
          currentExprRef.current = null;
        }, duration * 1000);
      } else {
        currentExprRef.current = null;
      }
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);

    const camera = new THREE.PerspectiveCamera(
      30,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 1.4, 2.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(1, 3, 2);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.8);
    fillLight.position.set(-2, 1, -1);
    scene.add(fillLight);

    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    loader.load("/avatar.vrm", (gltf) => {
      const vrm = gltf.userData.vrm as VRM;
      if (!vrm) return;
      VRMUtils.rotateVRM0(vrm);
      scene.add(vrm.scene);
      vrmRef.current = vrm;

      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (head) {
        const pos = new THREE.Vector3();
        head.getWorldPosition(pos);
        camera.position.set(0, pos.y + 0.05, 2.0);
        controls.target.set(0, pos.y - 0.05, 0);
        controls.update();
      }
      if (vrm.lookAt) vrm.lookAt.target = camera;
    });

    const clock = new THREE.Clock();
    let breathPhase = 0;
    let blinkTimer = 2 + Math.random() * 4;
    let animId = 0;

    function animate() {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      controls.update();

      const vrm = vrmRef.current;
      if (vrm) {
        // Breathing
        breathPhase += delta * 1.8;
        const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
        if (spine) spine.rotation.x = Math.sin(breathPhase) * 0.008;

        // Head sway
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        if (head) {
          head.rotation.y = Math.sin(breathPhase * 0.4) * 0.02;
          head.rotation.z = Math.sin(breathPhase * 0.3) * 0.008;
        }

        // Mouth (smooth lerp toward target)
        mouthRef.current += (targetMouthRef.current - mouthRef.current) * 0.3;
        vrm.expressionManager?.setValue("aa", mouthRef.current);

        // Blink
        blinkTimer -= delta;
        if (blinkTimer <= 0) {
          vrm.expressionManager?.setValue("blink", 1);
          setTimeout(() => vrm.expressionManager?.setValue("blink", 0), 120);
          blinkTimer = 2 + Math.random() * 4;
        }

        vrm.update(delta);
      }

      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }}
    />
  );
});

VRMScene.displayName = "VRMScene";

export default VRMScene;
