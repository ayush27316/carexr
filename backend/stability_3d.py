"""Stability AI text-to-3D pipeline.

Two-step process:
1. Generate a 2D image from text using Stable Image Core
2. Convert the image to a 3D GLB model using Stable Fast 3D

Total time: ~5-10 seconds (vs Meshy's 2-5 minutes)
Total cost: 5 credits per generation (3 image + 2 3D)
"""

import os
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

    glb_path = os.path.join(MODELS_DIR, f"{model_id}.glb")
    with open(glb_path, "wb") as f:
        f.write(glb_bytes)

    logger.info(f"SF3D: Generated model {model_id} ({len(glb_bytes)} bytes)")
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
        data={"texture_resolution": "1024", "foreground_ratio": "0.85"},
    )
    response.raise_for_status()
    logger.info(f"SF3D: 3D model generated ({len(response.content)} bytes)")
    return response.content
