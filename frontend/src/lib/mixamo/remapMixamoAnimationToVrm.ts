import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { mixamoVRMRigMap } from "./vrmRigMap";

export function remapMixamoAnimationToVrm(
  vrm: VRM,
  asset: THREE.Group
): THREE.AnimationClip | null {
  const clip = THREE.AnimationClip.findByName(asset.animations, "mixamo.com");
  if (!clip) return null;
  const src = clip.clone();

  const tracks: THREE.KeyframeTrack[] = [];

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  const motionHipsHeight = (
    asset.getObjectByName("mixamorigHips") as THREE.Object3D
  ).position.y;
  const vrmHipsY = vrm.humanoid
    ?.getNormalizedBoneNode("hips")
    ?.getWorldPosition(_vec3).y ?? 0;
  const vrmRootY = vrm.scene.getWorldPosition(_vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

  src.tracks.forEach((track) => {
    const trackSplitted = track.name.split(".");
    const mixamoRigName = trackSplitted[0];
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName] as VRMHumanBoneName | undefined;
    const vrmNodeName = vrmBoneName
      ? vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name
      : undefined;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (vrmNodeName != null && mixamoRigNode != null) {
      const propertyName = trackSplitted[1];

      mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
      mixamoRigNode.parent!.getWorldQuaternion(parentRestWorldRotation);

      if (track instanceof THREE.QuaternionKeyframeTrack) {
        for (let i = 0; i < track.values.length; i += 4) {
          const flatQuaternion = track.values.slice(i, i + 4);

          _quatA.fromArray(
            Array.from(flatQuaternion) as [number, number, number, number]
          );

          _quatA
            .premultiply(parentRestWorldRotation)
            .multiply(restRotationInverse);

          _quatA.toArray(flatQuaternion);

          flatQuaternion.forEach((v, index) => {
            track.values[index + i] = v;
          });
        }

        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${vrmNodeName}.${propertyName}`,
            track.times as unknown as number[],
            track.values.map((v, i) =>
              (vrm.meta as any)?.metaVersion === "0" && i % 2 === 0 ? -v : v
            ) as unknown as number[]
          )
        );
      } else if (track instanceof THREE.VectorKeyframeTrack) {
        const value = track.values.map(
          (v, i) =>
            ((vrm.meta as any)?.metaVersion === "0" && i % 3 !== 1 ? -v : v) *
            hipsPositionScale
        );
        tracks.push(
          new THREE.VectorKeyframeTrack(
            `${vrmNodeName}.${propertyName}`,
            track.times as unknown as number[],
            value as unknown as number[]
          )
        );
      }
    }
  });

  return new THREE.AnimationClip("vrmAnimation", src.duration, tracks);
}
