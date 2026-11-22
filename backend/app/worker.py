"""Run the standalone background worker."""

import argparse
import logging
import os
import time
from getpass import getpass

logger = logging.getLogger(__name__)


def ask_openai(prompt: str, model: str) -> str:
    """Send a prompt to OpenAI and return the reply text.

    Args:
        prompt: Message to send to the model.
        model: OpenAI model ID.

    Returns:
        The model's text reply.
    """
    from openai import OpenAI

    with OpenAI(base_url="https://api.openai.com/v1", timeout=30.0) as client:
        response = client.responses.create(model=model, input=prompt, store=False)
        return response.output_text


def chat_with_openai(model: str) -> None:
    """Keep conversation history in memory for a terminal chat session.

    Args:
        model: OpenAI model ID.
    """
    from openai import OpenAI, OpenAIError
    from openai.types.responses import EasyInputMessageParam

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        key = getpass("OpenAI API key: ").strip()
    if not key:
        raise SystemExit("No API key entered.")

    history: list[EasyInputMessageParam] = []
    with OpenAI(
        api_key=key, base_url="https://api.openai.com/v1", timeout=30.0, max_retries=0
    ) as client:
        print("Type a message, or /exit to quit.")
        while True:
            try:
                prompt = input("You: ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return
            if prompt == "/exit":
                return
            if not prompt:
                continue
            message: EasyInputMessageParam = {"role": "user", "content": prompt}
            try:
                reply = client.responses.create(
                    model=model, input=[*history, message], store=False
                ).output_text
            except OpenAIError as exc:
                print(f"OpenAI request failed ({type(exc).__name__}).")
                continue
            if not reply.strip():
                print("OpenAI returned no text.")
                continue
            history.extend([message, {"role": "assistant", "content": reply}])
            print(f"Agent: {reply}")


def main() -> None:
    """Run the heartbeat loop or use OpenAI from the terminal."""
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--once", action="store_true", help="Emit one heartbeat and exit."
    )
    mode.add_argument("--ask", metavar="PROMPT", help="Send one message to OpenAI.")
    mode.add_argument("--chat", action="store_true", help="Start a terminal chat.")
    parser.add_argument("--model", help="OpenAI model ID for --ask or --chat.")
    args = parser.parse_args()
    if (args.ask is not None or args.chat) and not args.model:
        parser.error("--ask and --chat require --model")
    if args.chat:
        chat_with_openai(args.model)
        return
    if args.ask is not None:
        print(ask_openai(args.ask, args.model))
        return

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    try:
        while True:
            logger.info("Worker heartbeat")
            if args.once:
                return
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Worker stopped")


if __name__ == "__main__":
    main()
