import json
import os
import time
from openai import OpenAI

client = OpenAI()


def process_task(task: dict) -> dict:
    """Process a single AI content generation task from the queue."""
    user_id = task["user_id"]
    prompt = task["prompt"]
    task_type = task.get("type", "completion")

    if task_type == "summarize":
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Summarize the following text concisely."},
                {"role": "user", "content": prompt},
            ],
        )
    elif task_type == "translate":
        target_lang = task.get("target_language", "Spanish")
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": f"Translate the following to {target_lang}."},
                {"role": "user", "content": prompt},
            ],
        )
    else:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
        )

    return {
        "task_id": task["id"],
        "result": response.choices[0].message.content,
        "tokens_used": response.usage.total_tokens if response.usage else 0,
    }


def poll_queue():
    """Poll for tasks and process them."""
    # Simulated queue polling
    tasks = [
        {"id": "task_1", "user_id": "user_abc", "prompt": "Explain quantum computing", "type": "completion"},
        {"id": "task_2", "user_id": "user_xyz", "prompt": "Summarize this article...", "type": "summarize"},
    ]

    for task in tasks:
        try:
            result = process_task(task)
            print(f"Completed {task['id']}: {result['tokens_used']} tokens")
        except Exception as e:
            print(f"Failed {task['id']}: {e}")


if __name__ == "__main__":
    poll_queue()
