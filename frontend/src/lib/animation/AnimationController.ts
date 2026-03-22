import type { VRM } from "@pixiv/three-vrm";
import {
  AnimationMixer,
  type AnimationAction,
  LoopRepeat,
  LoopOnce,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { remapMixamoAnimationToVrm } from "../mixamo/remapMixamoAnimationToVrm";

export type AnimationState = "idle" | "talking";
export type Emotion = "angry" | "neutral" | "happy" | "funny";

export interface AnimationPaths {
  angry: string[];
  neutral: string[];
  happy: string[];
  funny: string[];
  idle: string[];
}

export class AnimationController {
  private vrm: VRM;
  private mixer: AnimationMixer;
  private fbxLoader: FBXLoader;
  private currentAction: AnimationAction | null = null;
  private currentState: AnimationState = "idle";
  private animationPaths: AnimationPaths;
  private transitionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(vrm: VRM, animationPaths: AnimationPaths) {
    this.vrm = vrm;
    this.mixer = new AnimationMixer(vrm.scene);
    this.fbxLoader = new FBXLoader();
    this.animationPaths = animationPaths;
    this.startIdleAnimation();
  }

  private async startIdleAnimation() {
    try {
      const idlePaths = this.animationPaths.idle;
      if (idlePaths.length > 0) {
        const randomIdlePath =
          idlePaths[Math.floor(Math.random() * idlePaths.length)];
        await this.playAnimation(randomIdlePath, true);
      }
    } catch (error) {
      console.warn(
        "[AnimationController] Failed to start idle animation:",
        error
      );
    }
  }

  private async playAnimation(
    animationPath: string,
    loop = false
  ): Promise<void> {
    try {
      console.log(
        `[AnimationController] Request to play: ${animationPath}, loop: ${loop}`
      );
      const fbxModel = await this.fbxLoader.loadAsync(animationPath);

      if (!fbxModel.animations || fbxModel.animations.length === 0) {
        console.warn(
          `[AnimationController] No animations in FBX: ${animationPath}`
        );
        return;
      }

      const remappedClip = remapMixamoAnimationToVrm(this.vrm, fbxModel);
      if (!remappedClip) {
        console.warn(
          `[AnimationController] Failed to remap: ${animationPath}`
        );
        return;
      }

      const newAction = this.mixer.clipAction(remappedClip);
      if (loop) {
        newAction.setLoop(LoopRepeat, Infinity);
      } else {
        newAction.setLoop(LoopOnce, 1);
        newAction.clampWhenFinished = true;
      }

      const oldAction = this.currentAction;
      this.currentAction = newAction;

      if (oldAction) {
        if (
          oldAction.getClip() === newAction.getClip() &&
          oldAction !== newAction
        ) {
          oldAction.stop();
          this.mixer.uncacheAction(oldAction.getClip(), this.vrm.scene);
          newAction.reset().play();
        } else if (oldAction !== newAction) {
          if (!oldAction.isRunning()) {
            oldAction.reset().play();
          }
          newAction.play();
          oldAction.crossFadeTo(newAction, 0.3, false);

          const toCleanup = oldAction;
          setTimeout(() => {
            toCleanup.stop();
            this.mixer.uncacheAction(toCleanup.getClip(), this.vrm.scene);
          }, 300);
        } else {
          newAction.reset().play();
        }
      } else {
        newAction.reset().play();
      }
    } catch (error) {
      console.error(
        `[AnimationController] Error playing animation ${animationPath}:`,
        error
      );
      if (this.currentAction) {
        this.currentAction.stop();
      }
      this.currentAction = null;
    }
  }

  async startTalking(emotion?: Emotion): Promise<void> {
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }

    if (this.currentState === "talking") return;

    this.currentState = "talking";
    await this.playTalkingAnimation(emotion || "neutral");
  }

  private async playTalkingAnimation(emotion: Emotion): Promise<void> {
    let paths: string[];

    switch (emotion) {
      case "angry":
        paths = this.animationPaths.angry;
        break;
      case "happy":
        paths = this.animationPaths.happy;
        break;
      case "funny":
        paths = this.animationPaths.funny;
        break;
      default:
        paths = this.animationPaths.neutral;
    }

    if (paths.length > 0) {
      const randomPath = paths[Math.floor(Math.random() * paths.length)];
      await this.playAnimation(randomPath, true);
    }
  }

  async stopTalking(): Promise<void> {
    if (this.currentState !== "talking") return;
    if (this.transitionTimeout) return;

    this.transitionTimeout = setTimeout(async () => {
      if (this.currentState === "talking") {
        this.currentState = "idle";
        await this.startIdleAnimation();
      }
      this.transitionTimeout = null;
    }, 200);
  }

  update(deltaTime: number): void {
    this.mixer.update(deltaTime);
  }

  getCurrentState(): AnimationState {
    return this.currentState;
  }

  destroy(): void {
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }
    if (this.currentAction) {
      this.currentAction.stop();
    }
  }
}
