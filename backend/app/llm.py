"""LLM helpers on the OpenAI SDK; any OpenAI-compatible provider works.

Set ``LLM_MODEL``, ``LLM_API_KEY`` and (for non-OpenAI providers) ``LLM_BASE_URL``.
"""

import base64
import json
import re

from openai import AsyncOpenAI

from app.config import settings

DELIVERY_NOTE_PROMPT = (
    "Read this delivery note scan. The text may be Chinese, Korean, Polish or "
    "English, and may contain stamps and handwriting. Return JSON only: "
    '{"supplier": ..., "delivery_note": ..., "po_number": ..., "lines": [{"part": '
    '..., "printed_qty": ..., "handwritten_correction": ... or null, "final_qty": '
    "...}]} with one entry per item row. Write every quantity as a string exactly "
    'as it appears on the paper, keeping separators (for example "125.000" or '
    '"8 000"). final_qty is the quantity really delivered: the handwritten '
    "correction if there is one, otherwise the printed quantity."
)
QUANTITY_KEYS = ("printed_qty", "handwritten_correction", "final_qty")


class LLMError(Exception):
    """Raised when the model is not configured or returns unusable output."""


def to_int(value: object) -> int | None:
    """Turn a model-returned quantity (8000, "8 000", "80.000") into an int."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return int(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+[.,]\d{1,2}", text):  # a real decimal such as 12,5
        return round(float(text.replace(",", ".")))
    digits = re.sub(r"\D", "", text)  # "125.000" and "8 000" are thousands
    return int(digits) if digits else None


def _client() -> AsyncOpenAI:
    if not (settings.llm_api_key and settings.llm_model):
        raise LLMError("LLM_API_KEY and LLM_MODEL must be set in backend/.env")
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url or None,
        timeout=90,
        max_retries=4,  # providers return 429/503 under load
    )


async def read_delivery_note(image: bytes, mime: str) -> dict:
    """Read a delivery-note scan and return its fields with quantities as ints.

    Args:
        image: Raw image bytes.
        mime: Image type, for example ``image/jpeg``.

    Returns:
        Dict with supplier, delivery_note, po_number and ``lines``: one dict per
        item row with part, printed_qty, handwritten_correction and final_qty
        (quantities as ints).

    Raises:
        LLMError: If the model is not configured or does not return JSON.
    """
    data_url = f"data:{mime};base64,{base64.b64encode(image).decode()}"
    response = await _client().chat.completions.create(
        model=settings.llm_model,
        max_tokens=800,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": DELIVERY_NOTE_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    )
    try:
        result = json.loads(response.choices[0].message.content)
    except (TypeError, ValueError) as exc:
        raise LLMError("model did not return valid JSON") from exc
    if isinstance(result, list):  # the model answered with the rows only
        result = {"lines": result}
    lines = result.get("lines") or [result]  # a flat single-row answer
    result["lines"] = [
        {**line, **{key: to_int(line.get(key)) for key in QUANTITY_KEYS}}
        for line in lines
        if isinstance(line, dict)
    ]
    return result
