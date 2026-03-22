"""Meshy AI text-to-3D pipeline.

Calls the Meshy v2 API to generate a 3D GLB model from a text prompt:
1. Create a preview task (mesh generation)
2. Poll until preview completes
3. Create a refine task (texturing with PBR)
4. Poll until refine completes
5. Return the Meshy CDN URL for the GLB file
"""

import asyncio
import os

import httpx
from loguru import logger

MESHY_BASE_URL = "https://api.meshy.ai/openapi/v2"
POLL_INTERVAL = 5  # seconds between status checks


async def generate_3d_object(prompt: str) -> str:
    """Generate a 3D GLB model and return its Meshy CDN download URL.

    Args:
        prompt: Text description of the 3D object to generate.

    Returns:
        URL string pointing to the generated .glb file on Meshy's CDN.

    Raises:
        RuntimeError: If MESHY_API_KEY is missing or the Meshy pipeline fails.
        httpx.HTTPStatusError: If any Meshy API call returns an error status.
    """
    api_key = os.getenv("MESHY_API_KEY")
    if not api_key:
        raise RuntimeError("MESHY_API_KEY is not set in environment.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        logger.info(f"Meshy: creating preview task for prompt: {prompt!r}")
        preview_res = await client.post(
            f"{MESHY_BASE_URL}/text-to-3d",
            headers=headers,
            json={
                "mode": "preview",
                "prompt": prompt,
                "ai_model": "meshy-6",
                "should_remesh": True,
            },
        )
        preview_res.raise_for_status()
        preview_task_id = preview_res.json()["result"]
        logger.info(f"Meshy: preview task created: {preview_task_id}")

        await _poll_task(client, headers, preview_task_id, "preview")

        logger.info(f"Meshy: creating refine task for preview {preview_task_id}")
        refine_res = await client.post(
            f"{MESHY_BASE_URL}/text-to-3d",
            headers=headers,
            json={
                "mode": "refine",
                "preview_task_id": preview_task_id,
                "enable_pbr": True,
            },
        )
        refine_res.raise_for_status()
        refine_task_id = refine_res.json()["result"]
        logger.info(f"Meshy: refine task created: {refine_task_id}")

        task_data = await _poll_task(client, headers, refine_task_id, "refine")

        glb_url = task_data["model_urls"]["glb"]
        logger.info(f"Meshy: generation complete, GLB URL: {glb_url}")
        return glb_url


async def _poll_task(
    client: httpx.AsyncClient,
    headers: dict,
    task_id: str,
    stage: str,
) -> dict:
    """Poll a Meshy task until it succeeds or fails."""
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        res = await client.get(
            f"{MESHY_BASE_URL}/text-to-3d/{task_id}",
            headers=headers,
        )
        res.raise_for_status()
        data = res.json()
        status = data["status"]
        progress = data.get("progress", 0)
        logger.info(f"Meshy: {stage} {task_id}: {status} ({progress}%)")

        if status == "SUCCEEDED":
            return data
        if status in ("FAILED", "CANCELED"):
            error_msg = data.get("task_error", {}).get("message", "unknown error")
            raise RuntimeError(f"Meshy {stage} task {status}: {error_msg}")
