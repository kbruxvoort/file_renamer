import os

# The API refuses every request when started without a token. Tests call it
# in-process without one, so opt out explicitly (before src.api is imported).
os.environ.setdefault("SORTIFY_ALLOW_NO_AUTH", "1")
