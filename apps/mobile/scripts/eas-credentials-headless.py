#!/usr/bin/env python3
"""Run an eas-cli command that needs a terminal, from a shell that has none.

eas-cli only creates an iOS distribution certificate interactively: with
--non-interactive it stops at "Credentials are not set up". An agent shell or a
CI runner has no TTY, so the first credentials run for a new Apple team cannot
happen there. This wraps the command in a pseudo-terminal and confirms the
prompts that run asks, and nothing else.

Every prompt it answers is listed in ANSWERS and accepts eas-cli's default,
which is yes. Any other prompt stops the run with exit code 2 and prints it,
so a question nobody expected is never answered by guesswork.

Authenticate with an App Store Connect API key first; the key's environment
variables make eas-cli skip the Apple ID login prompt:

  EXPO_TOKEN, EXPO_APPLE_TEAM_ID, EXPO_APPLE_TEAM_TYPE,
  EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID

Usage, from apps/mobile:

  python3 -I scripts/eas-credentials-headless.py -- \\
    npx eas-cli@latest credentials:configure-build --platform ios --profile production
"""

import os
import pty
import re
import select
import signal
import sys
import time

ANSWERS = [
    re.compile(r"Generate a new Apple Distribution Certificate\?"),
    re.compile(r"Generate a new Apple Provisioning Profile\?"),
    re.compile(r"Reuse this distribution certificate\?"),
    re.compile(r"Would you like to reuse the original profile\?"),
]

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]")
# prompts renders an open question as "? <message> › <hint>" at the start of a
# line, and an answered one as "✔ <message> … <answer>". The message can span
# lines ("Reuse this distribution certificate?" lists the certificate below).
OPEN_PROMPT = re.compile(r"^\?\s+(.+?)\s+›", re.M | re.S)
SETTLE_SECONDS = 0.5


def main(argv):
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 64

    # eas-cli treats CI=1 as --non-interactive, which is the mode this escapes.
    env = {k: v for k, v in os.environ.items() if k != "CI"}
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe(argv[0], argv, env)

    screen = ""
    last_output = time.monotonic()
    while True:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.flush()
            text = ANSI.sub("", chunk.decode("utf-8", "replace"))
            screen += text.replace("\r\n", "\n").replace("\r", "\n")
            last_output = time.monotonic()
            continue

        # Answer only once the prompt has finished drawing.
        if time.monotonic() - last_output < SETTLE_SECONDS:
            continue
        match = OPEN_PROMPT.search(screen)
        if not match:
            continue
        question = match.group(1)
        if not any(pattern.search(question) for pattern in ANSWERS):
            print(f"\n[eas-credentials-headless] unexpected prompt, stopping: {question}", file=sys.stderr)
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
            return 2
        os.write(fd, b"\r")
        # Everything up to this prompt is handled; match only what follows.
        screen = ""

    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
