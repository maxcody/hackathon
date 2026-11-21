"""Verify that this machine can reach the OpenAI Responses API."""

import os
from getpass import getpass

from openai import OpenAI, OpenAIError


def main() -> None:
    """Read an API key and request a short reply from OpenAI."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        key = getpass("OpenAI API key: ").strip()
    if not key:
        raise SystemExit("No API key entered.")

    try:
        with OpenAI(
            api_key=key, base_url="https://api.openai.com/v1", timeout=30.0
        ) as client:
            response = client.responses.create(
                model="gpt-5-mini",
                input="Reply with exactly: Agent online.",
                store=False,
            )
    except OpenAIError as exc:
        message = f"OpenAI connection test failed: {type(exc).__name__}"
        raise SystemExit(message) from None

    if not response.output_text.strip():
        raise SystemExit("OpenAI returned no text.")
    print(response.output_text)


if __name__ == "__main__":
    main()
