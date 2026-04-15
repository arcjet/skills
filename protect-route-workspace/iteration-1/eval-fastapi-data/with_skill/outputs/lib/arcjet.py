import os

from arcjet import Mode, arcjet, shield

aj = arcjet(
    key=os.getenv("ARCJET_KEY"),
    rules=[
        # Base protection against common attacks (SQLi, XSS, etc.)
        shield(mode=Mode.LIVE),
    ],
)
