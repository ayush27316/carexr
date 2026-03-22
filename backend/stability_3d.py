"""Stability AI text-to-3D pipeline.

Two-step process:
1. Generate a 2D image from text using Stable Image Core
2. Convert the image to a 3D GLB model using Stable Fast 3D

Total time: ~5-10 seconds (vs Meshy's 2-5 minutes)
Total cost: 5 credits per generation (3 image + 2 3D)
"""

import os
import struct
import uuid

import httpx
from loguru import logger

IMAGE_GEN_URL = "https://api.stability.ai/v2beta/stable-image/generate/core"
SF3D_URL = "https://api.stability.ai/v2beta/3d/stable-fast-3d"

MODELS_DIR = os.path.join(os.path.dirname(__file__), "generated_models")
os.makedirs(MODELS_DIR, exist_ok=True)


async def generate_3d_object(prompt: str) -> str:
    """Generate a 3D GLB model from a text prompt and return the model ID.

    Args:
        prompt: Text description of the 3D object to generate.

    Returns:
        Model ID string. The GLB file is served at /models/{id}.glb

    Raises:
        RuntimeError: If STABILITY_API_KEY is missing or either API call fails.
    """
    api_key = os.getenv("STABILITY_API_KEY")
    if not api_key:
        raise RuntimeError("STABILITY_API_KEY is not set in environment.")

    model_id = uuid.uuid4().hex[:12]

    async with httpx.AsyncClient(timeout=60) as client:
        image_bytes = await _text_to_image(client, api_key, prompt)
        glb_bytes = await _image_to_3d(client, api_key, image_bytes)

    raw_path = os.path.join(MODELS_DIR, f"{model_id}_raw.glb")
    glb_path = os.path.join(MODELS_DIR, f"{model_id}.glb")

    with open(raw_path, "wb") as f:
        f.write(glb_bytes)

    _fix_glb_indices(raw_path, glb_path)
    os.remove(raw_path)

    logger.info(f"SF3D: Generated model {model_id} ({os.path.getsize(glb_path)} bytes)")
    return model_id


async def _text_to_image(
    client: httpx.AsyncClient, api_key: str, prompt: str
) -> bytes:
    """Generate a PNG image from a text prompt using Stable Image Core."""
    logger.info(f"SF3D: Generating image for prompt: {prompt!r}")

    enhanced_prompt = (
        f"{prompt}, 3D render, centered object on plain white background, "
        "studio lighting, high quality, clean isolated object"
    )

    response = await client.post(
        IMAGE_GEN_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "image/*",
        },
        files={
            "prompt": (None, enhanced_prompt),
            "output_format": (None, "png"),
        },
    )
    response.raise_for_status()
    logger.info(f"SF3D: Image generated ({len(response.content)} bytes)")
    return response.content


async def _image_to_3d(
    client: httpx.AsyncClient, api_key: str, image_bytes: bytes
) -> bytes:
    """Convert a PNG image to a GLB 3D model using Stable Fast 3D."""
    logger.info("SF3D: Converting image to 3D model...")

    response = await client.post(
        SF3D_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        files={"image": ("object.png", image_bytes, "image/png")},
        data={
            "texture_resolution": "1024",
            "foreground_ratio": "0.85",
            "remesh": "triangle",
            "vertex_count": "8000",
        },
    )
    response.raise_for_status()
    logger.info(f"SF3D: 3D model generated ({len(response.content)} bytes)")
    return response.content


def _fix_glb_indices(input_path: str, output_path: str):
    """Re-export GLB via pygltflib to ensure Lens Studio compatibility.

    Converts 32-bit indices (UNSIGNED_INT) to 16-bit (UNSIGNED_SHORT) if the
    vertex count allows it, since Spectacles doesn't support 32-bit indices.
    """
    from pygltflib import GLTF2
    import numpy as np

    glb = GLTF2.load(input_path)

    for mesh in glb.meshes:
        for prim in mesh.primitives:
            if prim.indices is not None:
                accessor = glb.accessors[prim.indices]
                # 5125 = UNSIGNED_INT (32-bit), convert to 5123 = UNSIGNED_SHORT (16-bit)
                if accessor.componentType == 5125:
                    bv = glb.bufferViews[accessor.bufferView]
                    blob = glb.binary_blob()
                    start = bv.byteOffset
                    end = start + bv.byteLength

                    # Read 32-bit indices
                    indices_32 = np.frombuffer(blob[start:end], dtype=np.uint32)
                    max_index = int(indices_32.max())

                    if max_index <= 65535:
                        indices_16 = indices_32.astype(np.uint16)
                        new_bytes = indices_16.tobytes()

                        # Replace in binary blob
                        blob_array = bytearray(blob)
                        blob_array[start:end] = new_bytes + b'\x00' * (len(blob[start:end]) - len(new_bytes))

                        # Update accessor and buffer view
                        accessor.componentType = 5123  # UNSIGNED_SHORT
                        bv.byteLength = len(new_bytes)

                        glb.set_binary_blob(bytes(blob_array))
                        logger.info(f"SF3D: Converted indices from 32-bit to 16-bit (max={max_index})")
                    else:
                        logger.warning(f"SF3D: Cannot convert indices, max={max_index} > 65535")

    glb.save(output_path)
